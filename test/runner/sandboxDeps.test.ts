import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import { makeExtensionContext } from '../__mocks__/vscode';
import { ensureSandboxDeps, getSandboxDepsDir } from '../../src/runner/sandbox';

const calls: string[] = [];

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
    spawn: vi.fn(() => {
        calls.push('spawn');
        return {
            stdout: { on: () => {} },
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


describe('ensureSandboxDeps', () => {
    beforeEach(() => {
        calls.length = 0;
    });

    it('clears .deps/ before pip runs when requirements.txt changed', async () => {
        const context = makeExtensionContext({
            asAbsolutePath: (p: string) => path.join('/ext', p),
        });

        const ok = await ensureSandboxDeps(context, 'python3', {
            appendLine: () => {},
            show: () => {},
        } as never, true);

        expect(ok).toBe(true);
        expect(calls).toEqual([
            `rmSync:${getSandboxDepsDir(context)}`,
            `mkdirSync:${getSandboxDepsDir(context)}`,
            'spawn',
        ]);
    });
});
