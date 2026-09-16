import { describe, it, expect } from 'vitest';
import { buildPickerItems, previewBody } from '../../src/testEvents/picker';
import type { TestEventStore } from '../../src/testEvents/store';

// ── previewBody ───────────────────────────────────────────────────

describe('previewBody', () => {
    it('returns JSON for an empty object', () => {
        const result = previewBody({});
        expect(typeof result).toBe('string');
        expect(result.length).toBeLessThanOrEqual(80);
    });

    it('returns a string containing the value for a simple object', () => {
        const result = previewBody({ key: 'value' });
        expect(result).toContain('value');
    });

    it('truncates long JSON to ≤ 80 chars ending with ellipsis', () => {
        const big: Record<string, unknown> = {};
        for (let i = 0; i < 20; i++) {
            big[`key${i}`] = `value${i}`;
        }
        const result = previewBody(big);
        expect(result.length).toBeLessThanOrEqual(80);
        expect(result.endsWith('…')).toBe(true);
    });

    it('returns fallback string for circular references (no throw)', () => {
        const obj: Record<string, unknown> = {};
        obj.self = obj;
        let result: string;
        expect(() => { result = previewBody(obj); }).not.toThrow();
        expect(typeof result!).toBe('string');
        expect(result!.length).toBeGreaterThan(0);
    });
});

// ── buildPickerItems ──────────────────────────────────────────────

describe('buildPickerItems', () => {
    it('returns array with Create action when store is undefined', () => {
        const items = buildPickerItems(undefined, {});
        expect(Array.isArray(items)).toBe(true);
        expect(items.some(i => i.label?.includes('Create new'))).toBe(true);
    });

    it('returns Create action for empty store', () => {
        const store: TestEventStore = { defaultEventName: '', events: {} };
        const items = buildPickerItems(store, {});
        expect(items.some(i => i.label?.includes('Create new'))).toBe(true);
    });

    it('includes event item with label and detail from previewBody', () => {
        const store: TestEventStore = {
            defaultEventName: 'run1',
            events: { run1: { projectId: 'p1' } },
        };
        const items = buildPickerItems(store, {});
        const eventItem = items.find(i => i.label === 'run1');
        expect(eventItem).toBeDefined();
        expect(eventItem!.detail).toContain('p1');
    });

    it('includes default header item when defaultEventName is set and event exists', () => {
        const store: TestEventStore = {
            defaultEventName: 'run1',
            events: { run1: {}, run2: {} },
        };
        const items = buildPickerItems(store, {});
        const defaultItem = items.find(i => i.label?.includes('Default: run1'));
        expect(defaultItem).toBeDefined();
    });

    it('includes all event items for a multi-event store', () => {
        const store: TestEventStore = {
            defaultEventName: '',
            events: { run1: {}, run2: {}, run3: {} },
        };
        const items = buildPickerItems(store, {});
        const eventItems = items.filter(i => i.eventName);
        expect(eventItems.length).toBeGreaterThanOrEqual(3);
    });

    it('excludes action items when eventsOnly:true', () => {
        const store: TestEventStore = {
            defaultEventName: '',
            events: { run1: {} },
        };
        const items = buildPickerItems(store, { eventsOnly: true });
        expect(items.some(i => i.label?.includes('Create new'))).toBe(false);
        expect(items.some(i => i.label?.includes('Edit Test'))).toBe(false);
        expect(items.some(i => i.label?.includes('Delete Test'))).toBe(false);
    });

    it('includes Edit and Delete actions when events exist in non-eventsOnly mode', () => {
        const store: TestEventStore = {
            defaultEventName: '',
            events: { run1: {} },
        };
        const items = buildPickerItems(store, {});
        expect(items.some(i => i.label?.includes('Edit Test'))).toBe(true);
        expect(items.some(i => i.label?.includes('Delete Test'))).toBe(true);
    });
});

/*
 * SKIPPED (D-08): pickTestEvent full QuickPick flow
 * ──────────────────────────────────────────────────────────────────
 * pickTestEvent creates a vscode.QuickPick, wires onDidAccept/onDidHide,
 * and awaits user interaction. This requires a complex QuickPick mock
 * that simulates accept/hide events. Per D-08, skip VS Code-heavy UI flows.
 * The pure item-building logic (buildPickerItems) is tested above.
 */
