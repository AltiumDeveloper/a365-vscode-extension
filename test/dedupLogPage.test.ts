import { describe, it, expect } from 'vitest';
import { dedupLogPage } from '../src/shared/logDedup';

describe('dedupLogPage', () => {
    it('empty first page → no output, count stays 0', () => {
        const r = dedupLogPage([], 0);
        expect(r.fresh).toEqual([]);
        expect(r.newPrintedCount).toBe(0);
    });

    it('first page with 3 lines → all printed, count = 3', () => {
        const r = dedupLogPage(['a', 'b', 'c'], 0);
        expect(r.fresh).toEqual(['a', 'b', 'c']);
        expect(r.newPrintedCount).toBe(3);
    });

    it('second page repeats prefix + adds 2 new → only the new tail emitted', () => {
        const r = dedupLogPage(['a', 'b', 'c', 'd', 'e'], 3);
        expect(r.fresh).toEqual(['d', 'e']);
        expect(r.newPrintedCount).toBe(5);
    });

    it('defensive: server returns fewer lines than printedCount → no output, count unchanged', () => {
        const r = dedupLogPage(['a', 'b'], 5);
        expect(r.fresh).toEqual([]);
        expect(r.newPrintedCount).toBe(5);
    });

    it('final batch after terminal status: full transcript returned → only un-printed tail emitted', () => {
        const r = dedupLogPage(['a', 'b', 'c', 'd', 'e', 'f'], 4);
        expect(r.fresh).toEqual(['e', 'f']);
        expect(r.newPrintedCount).toBe(6);
    });
});
