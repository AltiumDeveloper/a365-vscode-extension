import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as vscode from 'vscode';
import { debugSessionTerminated, Disposable } from '../__mocks__/vscode';
import { registerRunLifecycle } from '../../src/runner';

const unlinked: string[] = [];

vi.mock('fs', () => ({
    unlinkSync: vi.fn((p: string) => {
        unlinked.push(p);
    }),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
}));

const output = { appendLine: () => {}, append: () => {}, show: () => {} } as never;

describe('registerRunLifecycle', () => {
    let lifecycle: vscode.Disposable | undefined;

    beforeEach(() => {
        unlinked.length = 0;
        lifecycle = registerRunLifecycle(output);
    });

    afterEach(() => {
        lifecycle?.dispose();
    });

    it('removes the params file when a debug session terminates', () => {
        debugSessionTerminated.fire({
            configuration: { altium365ParamsPath: '/tmp/altium365-params-1.json' },
        });

        expect(unlinked).toEqual(['/tmp/altium365-params-1.json']);
    });

    it('ignores debug sessions that carry no params path', () => {
        debugSessionTerminated.fire({ configuration: { program: '/tmp/other.py' } });
        debugSessionTerminated.fire({});

        expect(unlinked).toEqual([]);
    });

    it('stops listening for debug terminations once disposed', () => {
        lifecycle?.dispose();
        lifecycle = undefined;

        debugSessionTerminated.fire({
            configuration: { altium365ParamsPath: '/tmp/altium365-params-2.json' },
        });

        expect(unlinked).toEqual([]);
    });

    it('returns a Disposable so shutdown is driven by context.subscriptions', () => {
        expect(lifecycle).toBeInstanceOf(Disposable);
    });
});
