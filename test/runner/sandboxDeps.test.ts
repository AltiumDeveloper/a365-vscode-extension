import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeExtensionContext } from '../__mocks__/vscode';
import { ensureSandboxDeps, getSandboxDepsDir } from '../../src/runner/sandbox';

const calls: string[] = [];
let pythonVersion = '3.12';
let probeHangs = false;
let marker: Record<string, string> = { requirementsSha256: 'stale', installedAt: '' };

vi.mock('fs', () => ({
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => JSON.stringify(marker)),
    writeFileSync: vi.fn(),
    rmSync: vi.fn((target: string) => calls.push(`rmSync:${target}`)),
    mkdirSync: vi.fn((target: string) => calls.push(`mkdirSync:${target}`)),
}));

vi.mock('crypto', () => ({
    createHash: () => ({ update: () => ({ digest: () => 'current' }) }),
}));

vi.mock('child_process', () => ({
    spawn: vi.fn((_python: string, args: string[]) => {
        const isVersionProbe = args[0] === '-c';
        calls.push(isVersionProbe ? 'spawn:version' : 'spawn:pip');
        return {
            stdout: {
                on: (_event: string, cb: (d: Buffer) => void) => {
                    if (isVersionProbe) {
                        cb(Buffer.from(`${pythonVersion}\n`));
                    }
                },
            },
            stderr: { on: () => {} },
            on: (event: string, cb: (code: number) => void) => {
                if (event === 'close' && !(isVersionProbe && probeHangs)) {
                    setImmediate(() => cb(0));
                }
            },
            kill: () => calls.push(isVersionProbe ? 'kill:version' : 'kill:pip'),
        };
    }),
}));

const output = { appendLine: () => {}, show: () => {} } as never;
const context = makeExtensionContext({
    asAbsolutePath: (p: string) => path.join('/ext', p),
});

describe('ensureSandboxDeps', () => {
    beforeEach(() => {
        calls.length = 0;
        pythonVersion = '3.12';
        probeHangs = false;
        marker = { requirementsSha256: 'stale', installedAt: '' };
        vi.mocked(vscode.window.showErrorMessage).mockClear();
        vi.mocked(vscode.window.showInformationMessage).mockReset();
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Install' as never);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears .deps/ before pip runs when requirements.txt changed', async () => {
        const ok = await ensureSandboxDeps(context, 'python3', output, true);

        expect(ok).toBe(true);
        expect(calls).toEqual([
            'spawn:version',
            `rmSync:${getSandboxDepsDir(context)}`,
            `mkdirSync:${getSandboxDepsDir(context)}`,
            'spawn:pip',
        ]);
    });

    it('rejects an interpreter older than 3.10 without touching .deps/', async () => {
        pythonVersion = '3.9';

        const ok = await ensureSandboxDeps(context, 'python3', output, true);

        expect(ok).toBe(false);
        expect(calls).toEqual(['spawn:version']);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('needs Python 3.10 or later to run scripts locally, but python3 is Python 3.9')
        );
    });

    it('rejects an interpreter older than 3.10 even when .deps/ is already installed', async () => {
        marker = { requirementsSha256: 'current', pythonVersion: '3.12', installedAt: '' };
        pythonVersion = '3.9';

        const ok = await ensureSandboxDeps(context, 'python3', output);

        expect(ok).toBe(false);
        expect(calls).toEqual(['spawn:version']);
    });

    it('skips the install when requirements and interpreter version match the marker', async () => {
        marker = { requirementsSha256: 'current', pythonVersion: '3.12', installedAt: '' };

        const ok = await ensureSandboxDeps(context, 'python3', output);

        expect(ok).toBe(true);
        expect(calls).toEqual(['spawn:version']);
    });

    it('reinstalls when the interpreter version differs from the one that installed .deps/', async () => {
        marker = { requirementsSha256: 'current', pythonVersion: '3.12', installedAt: '' };
        pythonVersion = '3.11';

        const ok = await ensureSandboxDeps(context, 'python3', output);

        expect(ok).toBe(true);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            expect.stringContaining('installed for Python 3.12, now running 3.11'),
            expect.anything(),
            'Install',
            'Cancel'
        );
        expect(calls).toContain('spawn:pip');
    });

    it('falls through to the install prompt and pip when the version output is unreadable', async () => {
        pythonVersion = '';

        const ok = await ensureSandboxDeps(context, 'python3', output);

        expect(ok).toBe(true);
        expect(vscode.window.showInformationMessage).toHaveBeenCalled();
        expect(calls).toEqual([
            'spawn:version',
            `rmSync:${getSandboxDepsDir(context)}`,
            `mkdirSync:${getSandboxDepsDir(context)}`,
            'spawn:pip',
        ]);
    });

    it('kills a version probe that does not exit and carries on', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        probeHangs = true;
        marker = { requirementsSha256: 'current', pythonVersion: '3.12', installedAt: '' };

        const pending = ensureSandboxDeps(context, 'python3', output);
        await vi.advanceTimersByTimeAsync(5000);

        expect(await pending).toBe(true);
        expect(calls).toEqual(['spawn:version', 'kill:version']);
    });
});
