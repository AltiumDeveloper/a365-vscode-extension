import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    readStore,
    writeStore,
    deleteEvent,
    listEvents,
    setDefault,
    eventCount,
    isBloatWarned,
    markBloatWarned,
    onDidChangeTestEventStore,
    TEST_EVENT_KEY_PREFIX,
    type TestEventStore,
} from '../../src/testEvents/store';
import { makeExtensionContext } from '../__mocks__/vscode';

let ctx: ReturnType<typeof makeExtensionContext>;

beforeEach(() => {
    ctx = makeExtensionContext();
});

// ── readStore ─────────────────────────────────────────────────────

describe('readStore', () => {
    it('returns undefined for empty globalState', () => {
        expect(readStore(ctx, 'id')).toBeUndefined();
    });

    it('returns undefined when stored value has no events key', async () => {
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', { defaultEventName: '' });
        expect(readStore(ctx, 'id')).toBeUndefined();
    });

    it('returns the TestEventStore when valid shape is stored', async () => {
        const store: TestEventStore = { defaultEventName: 'run1', events: { run1: { x: 1 } } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        expect(readStore(ctx, 'id')).toMatchObject({ defaultEventName: 'run1', events: { run1: { x: 1 } } });
    });
});

// ── writeStore ────────────────────────────────────────────────────

describe('writeStore', () => {
    it('calls globalState.update with the correct key', async () => {
        const store: TestEventStore = { defaultEventName: '', events: { run1: {} } };
        await writeStore(ctx, 'id', store);
        expect(ctx.globalState.update).toHaveBeenCalledWith(TEST_EVENT_KEY_PREFIX + 'id', store);
    });

    it('fires onDidChangeTestEventStore with the identity', async () => {
        const fired: string[] = [];
        const d = onDidChangeTestEventStore(id => fired.push(id));
        try {
            await writeStore(ctx, 'my-id', { defaultEventName: '', events: {} });
            expect(fired).toContain('my-id');
        } finally {
            d.dispose();
        }
    });
});

// ── deleteEvent ───────────────────────────────────────────────────

describe('deleteEvent', () => {
    it('returns undefined when store is missing', async () => {
        expect(await deleteEvent(ctx, 'id', 'missing')).toBeUndefined();
    });

    it('returns store unchanged when event is not in store', async () => {
        const store: TestEventStore = { defaultEventName: '', events: { run1: {} } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        const result = await deleteEvent(ctx, 'id', 'nonexistent');
        expect(result).toMatchObject({ events: { run1: {} } });
    });

    it('removes entire entry when deleting the only event', async () => {
        const store: TestEventStore = { defaultEventName: '', events: { run1: {} } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        const result = await deleteEvent(ctx, 'id', 'run1');
        expect(result).toBeUndefined();
        expect(await ctx.globalState.get(TEST_EVENT_KEY_PREFIX + 'id')).toBeUndefined();
    });

    it('removes only the named event when two events exist', async () => {
        const store: TestEventStore = { defaultEventName: '', events: { run1: {}, run2: {} } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        const result = await deleteEvent(ctx, 'id', 'run1');
        expect(result).toBeDefined();
        expect(result!.events['run1']).toBeUndefined();
        expect(result!.events['run2']).toBeDefined();
    });

    it('clears defaultEventName when deleting the default event', async () => {
        const store: TestEventStore = { defaultEventName: 'run1', events: { run1: {}, run2: {} } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        const result = await deleteEvent(ctx, 'id', 'run1');
        expect(result!.defaultEventName).toBe('');
    });
});

// ── listEvents ────────────────────────────────────────────────────

describe('listEvents', () => {
    it('returns empty array when no store', () => {
        expect(listEvents(ctx, 'id')).toEqual([]);
    });

    it('returns sorted event names', async () => {
        const store: TestEventStore = { defaultEventName: '', events: { b: {}, a: {} } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        expect(listEvents(ctx, 'id')).toEqual(['a', 'b']);
    });
});

// ── setDefault ────────────────────────────────────────────────────

describe('setDefault', () => {
    it('throws when event does not exist', async () => {
        await expect(setDefault(ctx, 'id', 'nonexistent')).rejects.toThrow('No such event: nonexistent');
    });

    it('sets defaultEventName for an existing event', async () => {
        const store: TestEventStore = { defaultEventName: '', events: { run1: {} } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        await setDefault(ctx, 'id', 'run1');
        const updated = readStore(ctx, 'id');
        expect(updated!.defaultEventName).toBe('run1');
    });
});

// ── eventCount ────────────────────────────────────────────────────

describe('eventCount', () => {
    it('returns 0 for missing store', () => {
        expect(eventCount(ctx, 'id')).toBe(0);
    });

    it('returns correct count for 3 events', async () => {
        const store: TestEventStore = { defaultEventName: '', events: { a: {}, b: {}, c: {} } };
        await ctx.globalState.update(TEST_EVENT_KEY_PREFIX + 'id', store);
        expect(eventCount(ctx, 'id')).toBe(3);
    });
});

// ── isBloatWarned / markBloatWarned ───────────────────────────────

describe('isBloatWarned / markBloatWarned', () => {
    it('returns false when no flag is set', () => {
        expect(isBloatWarned(ctx, 'id')).toBe(false);
    });

    it('returns true after markBloatWarned', async () => {
        await markBloatWarned(ctx, 'id');
        expect(isBloatWarned(ctx, 'id')).toBe(true);
    });
});
