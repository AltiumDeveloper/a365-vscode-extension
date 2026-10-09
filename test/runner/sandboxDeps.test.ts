import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeExtensionContext } from '../__mocks__/vscode';
import { ensureSandboxDeps, getSandboxDepsDir } from '../../src/runner/sandbox';

const calls: string[] = [];
let pythonVersion = '3.12';

vi.mock('fs', () => ({
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => JSON.stringify({ requirementsSha256: 'stale', installedAt: '' })),
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
                if (event === 'close') {
                    setImmediate(() => cb(0));
                }
            },
            kill: () => {},
        };
    }),
}));

const output = { appendLine: () => {}, show: () => {} } as never;

describe('ensureSandboxDeps', () => {
    beforeEach(() => {
        calls.length = 0;
        pythonVersion = '3.12';
        vi.mocked(vscode.window.showErrorMessage).mockClear();
    });

    it('clears .deps/ before pip runs when requirements.txt changed', async () => {
        const context = makeExtensionContext({
            asAbsolutePath: (p: string) => path.join('/ext', p),
        });

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
        const context = makeExtensionContext({
            asAbsolutePath: (p: string) => path.join('/ext', p),
        });

        const ok = await ensureSandboxDeps(context, 'python3', output, true);

        expect(ok).toBe(false);
        expect(calls).toEqual(['spawn:version']);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('need Python 3.10 or later, but python3 is Python 3.9')
        );
    });
});
