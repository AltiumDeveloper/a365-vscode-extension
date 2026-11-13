import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeExtensionContext, window } from '../__mocks__/vscode';
import { getScriptSecrets, updateScript } from '../../src/workspace';
import { AltiumRemoteScriptFs, buildScriptUri } from '../../src/scripts/remoteFs';

vi.mock('../../src/auth', () => ({
    readOAuthConfig: () => ({}),
    ensureWorkspaceToken: async () => 'token',
}));

vi.mock('../../src/workspace', () => ({
    GraphQLError: class extends Error {},
    getScript: vi.fn(),
    getScriptSecrets: vi.fn(),
    getWorkspaceApiUrl: () => 'https://example.invalid/graphql',
    getWorkspaceFilesUrl: () => 'https://example.invalid/files',
    resolveWorkspaceFromAuthId: async () => ({ workspaceId: 'ws', authId: 'auth', name: 'WS' }),
    updateScript: vi.fn(async () => ({ scriptVersionId: '2', timestamp: 'now' })),
}));

vi.mock('../../src/scripts/filesService', () => ({
    downloadByToken: vi.fn(),
    uploadAndGetToken: async () => 'file-token',
}));

const SCRIPT_ID = '550e8400-e29b-41d4-a716-446655440000';
const uri = buildScriptUri('auth', SCRIPT_ID, 'Script');
const appendLine = vi.fn();
const publish = () =>
    new AltiumRemoteScriptFs(makeExtensionContext(), () => 'https://example.invalid/graphql', {
        appendLine,
    } as never).writeFile(uri, new TextEncoder().encode('print(1)'), { create: false, overwrite: true });

const declared = (...names: string[]) => names.map((name) => ({ name, isMissing: false }));

describe('publish keeps declared secrets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('warns when the new version declares fewer secrets than the previous one', async () => {
        vi.mocked(getScriptSecrets)
            .mockResolvedValueOnce(declared('API_KEY', 'TOKEN'))
            .mockResolvedValueOnce(declared('API_KEY'));

        await publish();

        expect(getScriptSecrets).toHaveBeenLastCalledWith(expect.any(String), 'token', SCRIPT_ID, '2');
        expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('TOKEN'));
        expect(window.showWarningMessage).not.toHaveBeenCalledWith(expect.stringContaining('API_KEY'));
    });

    it('stays quiet when the declarations carried over', async () => {
        vi.mocked(getScriptSecrets).mockResolvedValue(declared('API_KEY'));

        await publish();

        expect(window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('publishes without checking when the previous declarations cannot be read', async () => {
        vi.mocked(getScriptSecrets).mockRejectedValueOnce(new Error('not authorized'));

        await publish();

        expect(updateScript).toHaveBeenCalled();
        expect(getScriptSecrets).toHaveBeenCalledTimes(1);
        expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('not authorized'));
    });

    it('still succeeds when the new declarations cannot be read', async () => {
        vi.mocked(getScriptSecrets)
            .mockResolvedValueOnce(declared('API_KEY'))
            .mockRejectedValueOnce(new Error('timeout'));

        await expect(publish()).resolves.toBeUndefined();
        expect(window.showWarningMessage).not.toHaveBeenCalled();
    });
});
