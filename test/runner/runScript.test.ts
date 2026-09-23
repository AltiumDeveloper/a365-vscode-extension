import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'events';
import * as path from 'path';
import { makeExtensionContext, window } from '../__mocks__/vscode';
import { registerRunLifecycle, runScriptAtPath } from '../../src/runner';

const unlinked: string[] = [];
const written: string[] = [];
let spawned: FakeProc[] = [];
let cancel: (() => void) | undefined;

class FakeProc extends NodeEventEmitter {
    stdout = new NodeEventEmitter();
    stderr = new NodeEventEmitter();
    killed = false;
    kill() {
        this.killed = true;
        this.emit('close', null);
    }
    exit(code: number) {
        this.emit('close', code);
    }
}

vi.mock('fs', () => ({
    unlinkSync: vi.fn((p: string) => {
        unlinked.push(p);
    }),
    writeFileSync: vi.fn((p: string) => {
        written.push(p);
    }),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ''),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
}));

vi.mock('child_process', () => ({
    spawn: vi.fn(() => {
        const proc = new FakeProc();
        spawned.push(proc);
        return proc;
    }),
}));

vi.mock('../../src/config', () => ({
    resolveConfig: () => ({ graphqlEndpoint: 'https://example.invalid/graphql' }),
}));

vi.mock('../../src/auth', () => ({
    readOAuthConfig: () => ({}),
    getBaseAccessToken: async () => 'token',
    ensureWorkspaceToken: async () => 'token',
}));

vi.mock('../../src/workspace', () => ({
    getSelectedWorkspace: () => ({ workspaceId: 'ws', authId: 'auth', name: 'WS' }),
    getWorkspaceApiUrl: () => 'https://example.invalid/graphql',
    listWorkspaces: async () => [],
    pickWorkspace: async () => undefined,
    setSelectedWorkspace: async () => {},
}));

vi.mock('../../src/runner/sandbox', () => ({
    ensureSandboxDeps: async () => true,
    getSandboxPythonPath: () => [],
}));

vi.mock('../../src/testEvents/identity', () => ({
    resolveScriptIdentity: () => ({ kind: 'local', identity: '/tmp/script.py' }),
}));

vi.mock('../../src/testEvents/resolver', () => ({
    resolveScriptParameters: async () => [{ key: 'projectId', value: 'abc' }],
}));

const output = { appendLine: () => {}, append: () => {}, show: () => {} } as never;

const flush = () => new Promise((r) => setImmediate(r));

describe('runScriptAtPath lifetime', () => {
    beforeEach(() => {
        unlinked.length = 0;
        written.length = 0;
        spawned = [];
        cancel = undefined;
        window.withProgress.mockImplementation(
            async (
                _options: unknown,
                task: (
                    progress: { report: (value: unknown) => void },
                    token: { onCancellationRequested: (cb: () => void) => void },
                ) => Promise<unknown>,
            ) =>
                task(
                    { report: () => {} },
                    { onCancellationRequested: (cb: () => void) => {
                        cancel = cb;
                        return { dispose: () => {} };
                    } },
                ),
        );
    });

    const run = () =>
        runScriptAtPath(makeExtensionContext(), output, path.join('/tmp', 'script.py'));

    it('removes the params file after the script exits', async () => {
        const done = run();
        await flush();
        expect(written).toHaveLength(1);
        spawned[0].exit(0);
        await done;

        expect(unlinked).toEqual(written);
    });

    it('kills the script when the user cancels, and still removes the params file', async () => {
        const done = run();
        await flush();
        expect(cancel).toBeTypeOf('function');

        cancel?.();
        await done;

        expect(spawned[0].killed).toBe(true);
        expect(unlinked).toEqual(written);
    });

    it('removes the params file when python fails to start', async () => {
        const done = run();
        await flush();
        spawned[0].emit('error', new Error('ENOENT'));
        await done;

        expect(unlinked).toEqual(written);
    });

    it('kills a script still running when the lifecycle disposable is disposed', async () => {
        const lifecycle = registerRunLifecycle(output);
        const done = run();
        await flush();
        expect(spawned[0].killed).toBe(false);

        lifecycle.dispose();
        await done;

        expect(spawned[0].killed).toBe(true);
    });
});
