import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'events';
import { debugSessionTerminated, Disposable } from '../__mocks__/vscode';
import { registerRunLifecycle } from '../../src/runner';

const unlinked: string[] = [];
const killed: string[] = [];

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

class FakeProc extends NodeEventEmitter {
    stdout = new NodeEventEmitter();
    stderr = new NodeEventEmitter();
    constructor(private readonly label: string) {
        super();
    }
    kill() {
        killed.push(this.label);
    }
}

vi.mock('child_process', () => ({
    spawn: vi.fn(() => new FakeProc('script')),
}));

const output = { appendLine: () => {}, append: () => {}, show: () => {} } as never;

describe('registerRunLifecycle', () => {
    beforeEach(() => {
        unlinked.length = 0;
        killed.length = 0;
    });

    it('removes the params file when a debug session terminates', () => {
        const lifecycle = registerRunLifecycle(output);

        debugSessionTerminated.fire({
            configuration: { altium365ParamsPath: '/tmp/altium365-params-1.json' },
        });

        expect(unlinked).toEqual(['/tmp/altium365-params-1.json']);
        lifecycle.dispose();
    });

    it('ignores debug sessions that carry no params path', () => {
        const lifecycle = registerRunLifecycle(output);

        debugSessionTerminated.fire({ configuration: { program: '/tmp/other.py' } });
        debugSessionTerminated.fire({});

        expect(unlinked).toEqual([]);
        lifecycle.dispose();
    });

    it('stops listening for debug terminations once disposed', () => {
        const lifecycle = registerRunLifecycle(output);
        lifecycle.dispose();

        debugSessionTerminated.fire({
            configuration: { altium365ParamsPath: '/tmp/altium365-params-2.json' },
        });

        expect(unlinked).toEqual([]);
    });

    it('returns a Disposable so shutdown is driven by context.subscriptions', () => {
        const lifecycle = registerRunLifecycle(output);
        expect(lifecycle).toBeInstanceOf(Disposable);
        lifecycle.dispose();
    });
});
