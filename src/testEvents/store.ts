import * as vscode from 'vscode';

/**
 * Test-event storage layer (Phase 999.3, D-01..D-03).
 *
 * Stores per-script parameter templates in `context.globalState` under
 * the key `altium365.scriptParams.<identity>`. Identity is opaque here —
 * resolution lives in `./identity.ts`. The store is the single touch
 * point for the raw key prefix; no other Phase 999.3 module references
 * `TEST_EVENT_KEY_PREFIX` directly.
 */

export const TEST_EVENT_KEY_PREFIX = 'altium365.scriptParams.';

export interface TestEventStore {
    defaultEventName: string;
    events: Record<string, Record<string, unknown>>;
}

function storeKey(identity: string): string {
    return TEST_EVENT_KEY_PREFIX + identity;
}

export function readStore(
    ctx: vscode.ExtensionContext,
    identity: string,
): TestEventStore | undefined {
    const raw = ctx.globalState.get<TestEventStore>(storeKey(identity));
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    if (typeof raw.events !== 'object' || raw.events === null) {
        return undefined;
    }
    return raw;
}

export async function writeStore(
    ctx: vscode.ExtensionContext,
    identity: string,
    store: TestEventStore,
): Promise<void> {
    await ctx.globalState.update(storeKey(identity), store);
}

export async function deleteEvent(
    ctx: vscode.ExtensionContext,
    identity: string,
    eventName: string,
): Promise<TestEventStore | undefined> {
    const store = readStore(ctx, identity);
    if (!store) {
        return undefined;
    }
    if (!(eventName in store.events)) {
        return store;
    }
    delete store.events[eventName];
    if (store.defaultEventName === eventName) {
        store.defaultEventName = '';
    }
    const remaining = Object.keys(store.events);
    if (remaining.length === 0 && store.defaultEventName === '') {
        await ctx.globalState.update(storeKey(identity), undefined);
        return undefined;
    }
    await writeStore(ctx, identity, store);
    return store;
}

export function listEvents(
    ctx: vscode.ExtensionContext,
    identity: string,
): string[] {
    const store = readStore(ctx, identity);
    if (!store) {
        return [];
    }
    return Object.keys(store.events).sort();
}

export async function setDefault(
    ctx: vscode.ExtensionContext,
    identity: string,
    eventName: string,
): Promise<void> {
    const store = readStore(ctx, identity);
    if (!store || !(eventName in store.events)) {
        throw new Error('No such event: ' + eventName);
    }
    store.defaultEventName = eventName;
    await writeStore(ctx, identity, store);
}

export function eventCount(
    ctx: vscode.ExtensionContext,
    identity: string,
): number {
    return listEvents(ctx, identity).length;
}
