import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeExtensionContext, window } from '../__mocks__/vscode';
import { getScriptSecrets } from '../../src/workspace';
import {
    readLocalSecrets,
    resolveRunSecrets,
    scanSecretNames,
    setLocalSecret,
    writeLocalSecrets,
} from '../../src/secrets';

let source = '';

vi.mock('fs', () => ({
    readFileSync: vi.fn(() => source),
}));

vi.mock('../../src/workspace', () => ({
    getScriptSecrets: vi.fn(),
}));

const appendLine = vi.fn();
const output = { appendLine } as never;
const workspace = { workspaceId: 'grid:global::platform:workspace/ws-1', name: 'WS' };
const remote = { kind: 'remote', identity: 'script-1', workspaceAuthId: 'auth' } as const;
const local = { kind: 'local', identity: '/tmp/script.py' } as const;
const args = (identity: typeof remote | typeof local) => ({
    identity,
    scriptPath: '/tmp/script.py',
    workspace,
    endpoint: 'https://example.invalid/graphql',
    token: 'token',
});

describe('scanSecretNames', () => {
    it('finds literal names passed to get_secret, once each', () => {
        source = [
            'key = context.get_secret("API_KEY")',
            "other = context.get_secret( 'Other' )",
            'again = context.get_secret("API_KEY")',
            'dynamic = context.get_secret(prefix + "_KEY")',
            'not_it = context.forget_secret("NOPE")',
        ].join('\n');

        expect(scanSecretNames(source)).toEqual(['API_KEY', 'Other']);
    });
});

describe('local secret storage', () => {
    it('keeps one map per workspace and deletes the entry once empty', async () => {
        const ctx = makeExtensionContext();
        await writeLocalSecrets(ctx, 'ws-a', { API_KEY: 'a' });
        await writeLocalSecrets(ctx, 'ws-b', { API_KEY: 'b' });

        expect(await readLocalSecrets(ctx, 'ws-a')).toEqual({ API_KEY: 'a' });
        expect(await readLocalSecrets(ctx, 'ws-b')).toEqual({ API_KEY: 'b' });

        await writeLocalSecrets(ctx, 'ws-a', {});
        expect(ctx.secrets.delete).toHaveBeenCalledWith('altium365.localSecrets.ws-a');
        expect(await readLocalSecrets(ctx, 'ws-a')).toEqual({});
    });

    it('saves one value without dropping values written since the caller last read', async () => {
        const ctx = makeExtensionContext();
        await setLocalSecret(ctx, 'ws', 'A', '1');
        await setLocalSecret(ctx, 'ws', 'B', '2');

        expect(await readLocalSecrets(ctx, 'ws')).toEqual({ A: '1', B: '2' });
    });
});

describe('resolveRunSecrets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        source = '';
    });

    it('passes only the declared secrets that still exist, prompting for a missing value', async () => {
        const ctx = makeExtensionContext();
        await writeLocalSecrets(ctx, workspace.workspaceId, { API_KEY: 'stored', UNDECLARED: 'x' });
        vi.mocked(getScriptSecrets).mockResolvedValue([
            { name: 'API_KEY', isMissing: false },
            { name: 'NEW_KEY', isMissing: false },
            { name: 'DELETED', isMissing: true },
        ]);
        window.showInputBox.mockResolvedValueOnce('typed');

        const secrets = await resolveRunSecrets(ctx, output, args(remote));

        expect(secrets).toEqual({ API_KEY: 'stored', NEW_KEY: 'typed' });
        expect(window.showInputBox).toHaveBeenCalledTimes(1);
        expect(window.showInputBox.mock.calls[0]?.[0]).toMatchObject({ password: true });
        expect(await readLocalSecrets(ctx, workspace.workspaceId)).toMatchObject({ NEW_KEY: 'typed' });
        expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('"DELETED"'));
    });

    it('cancels the run when a prompt is dismissed', async () => {
        vi.mocked(getScriptSecrets).mockResolvedValue([{ name: 'API_KEY', isMissing: false }]);
        window.showInputBox.mockResolvedValueOnce(undefined);

        expect(await resolveRunSecrets(makeExtensionContext(), output, args(remote))).toBeUndefined();
    });

    it('falls back to the names in the source and passes every stored secret when the declarations cannot be read', async () => {
        const ctx = makeExtensionContext();
        await writeLocalSecrets(ctx, workspace.workspaceId, { A: '1', B: '2' });
        vi.mocked(getScriptSecrets).mockRejectedValue(new Error('not authorized'));
        source = 'context.get_secret("C")';
        window.showInputBox.mockResolvedValueOnce('3');

        expect(await resolveRunSecrets(ctx, output, args(remote))).toEqual({ A: '1', B: '2', C: '3' });
        expect(window.showInputBox).toHaveBeenCalledTimes(1);
        expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('not authorized'));
    });

    it('prompts for names a local script uses and passes every stored secret', async () => {
        const ctx = makeExtensionContext();
        await writeLocalSecrets(ctx, workspace.workspaceId, { OTHER: 'o' });
        source = 'context.get_secret("API_KEY")';
        window.showInputBox.mockResolvedValueOnce('typed');

        expect(await resolveRunSecrets(ctx, output, args(local))).toEqual({ OTHER: 'o', API_KEY: 'typed' });
        expect(getScriptSecrets).not.toHaveBeenCalled();
    });
});
