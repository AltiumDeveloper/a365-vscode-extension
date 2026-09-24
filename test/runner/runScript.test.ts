import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { debug, debugSessionTerminated, makeExtensionContext, window } from '../__mocks__/vscode';
import { debugScriptAtPath, registerRunLifecycle, runScriptAtPath } from '../../src/runner';

const unlinked: string[] = [];
const written: string[] = [];
let spawned: FakeProc[] = [];
let nextPid = 4000;
let cancel: (() => void) | undefined;

class FakeProc extends NodeEventEmitter {
    stdout = new NodeEventEmitter();
    stderr = new NodeEventEmitter();
    pid = nextPid++;
    exit(code: number | null) {
        this.emit('exit', code);
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
    spawn: vi.fn((command: string) => {
        const proc = new FakeProc();
        if (command !== 'taskkill') {
            spawned.push(proc);
        }
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

const appendLine = vi.fn();
const output = { appendLine, append: () => {}, show: () => {} } as never;

const flush = () => new Promise((r) => setImmediate(r));

const scriptPath = path.join('/tmp', 'script.py');
const run = () => runScriptAtPath(makeExtensionContext(), output, scriptPath);

describe('runScriptAtPath lifetime', () => {
    let killSpy: ReturnType<typeof vi.spyOn>;

    const expectTreeKilled = (proc: FakeProc, signal: NodeJS.Signals) => {
        if (process.platform === 'win32') {
            expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
        } else {
            expect(killSpy).toHaveBeenCalledWith(-proc.pid, signal);
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        unlinked.length = 0;
        written.length = 0;
        spawned = [];
        cancel = undefined;
        killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
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

    afterEach(() => {
        killSpy.mockRestore();
        vi.useRealTimers();
    });

    it('writes the params file readable only by the current user', async () => {
        const done = run();
        await flush();
        spawned[0].exit(0);
        await done;

        expect(vi.mocked(fs.writeFileSync).mock.calls[0]?.[2]).toMatchObject({ mode: 0o600 });
    });

    it('removes the params file after the script exits', async () => {
        const done = run();
        await flush();
        expect(written).toHaveLength(1);
        spawned[0].exit(0);
        await done;

        expect(unlinked).toEqual(written);
    });

    it('finishes when the script exits even if a subprocess still holds its output open', async () => {
        const done = run();
        await flush();
        spawned[0].emit('exit', 0);
        await done;

        expect(unlinked).toEqual(written);
    });

    it('terminates the whole process tree when the user cancels', async () => {
        const done = run();
        await flush();
        expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({
            detached: process.platform !== 'win32',
        });

        cancel?.();
        expectTreeKilled(spawned[0], 'SIGTERM');
        spawned[0].exit(null);
        await done;

        expect(unlinked).toEqual(written);
    });

    it.skipIf(process.platform === 'win32')(
        'escalates to SIGKILL when the process tree ignores SIGTERM',
        async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const done = run();
            await flush();
            const pgid = -spawned[0].pid;

            cancel?.();
            expect(killSpy).toHaveBeenCalledWith(pgid, 'SIGTERM');
            expect(killSpy).not.toHaveBeenCalledWith(pgid, 'SIGKILL');

            vi.advanceTimersByTime(2000);
            expect(killSpy).toHaveBeenCalledWith(pgid, 'SIGKILL');

            spawned[0].exit(null);
            await done;
        },
    );

    it('removes the params file when python fails to start', async () => {
        const done = run();
        await flush();
        spawned[0].emit('error', new Error('ENOENT'));
        await done;

        expect(unlinked).toEqual(written);
    });

    it('kills the process tree and removes the params file when the lifecycle is disposed', async () => {
        const lifecycle = registerRunLifecycle(output);
        const done = run();
        await flush();

        lifecycle.dispose();
        expectTreeKilled(spawned[0], 'SIGKILL');
        expect(unlinked).toEqual(written);
        spawned[0].exit(null);
        await done;
    });

    it('logs when the params file cannot be removed', async () => {
        vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        });
        const done = run();
        await flush();
        spawned[0].exit(0);
        await done;

        expect(appendLine).toHaveBeenCalledWith(
            expect.stringContaining(`Failed to remove ${written[0]}`),
        );
    });
});

describe('debugScriptAtPath lifetime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        unlinked.length = 0;
        written.length = 0;
    });

    it('removes the params file when the debug session ends', async () => {
        const lifecycle = registerRunLifecycle(output);
        await debugScriptAtPath(makeExtensionContext(), output, scriptPath);
        const cfg = debug.startDebugging.mock.calls[0]?.[1];
        expect(unlinked).toEqual([]);

        debugSessionTerminated.fire({ configuration: cfg });
        expect(unlinked).toEqual(written);
        lifecycle.dispose();
    });

    it('removes the params file when the debugger fails to start', async () => {
        debug.startDebugging.mockResolvedValueOnce(false);
        await debugScriptAtPath(makeExtensionContext(), output, scriptPath);

        expect(unlinked).toEqual(written);
    });
});
