import * as vscode from 'vscode';
import { TestEventStore } from './store';

/**
 * Test-event QuickPick (Phase 999.3 Plan 04, RESEARCH §Q3 / D-12).
 *
 * Pure UX module — reads from a passed-in TestEventStore snapshot, does
 * not touch globalState or dispatch commands. Returns a discriminated
 * union describing the user's intent; the caller (commands.ts) is
 * responsible for routing `create` / `empty` / `event` outcomes to the
 * right side-effect (store write, command dispatch, run-with-empty).
 *
 * Cancellation semantics (D-13): `undefined` means the user dismissed
 * the picker via Esc / outside-click. Every caller MUST treat this as
 * abort — the resolver path uses it to silently skip running rather
 * than running with bogus defaults.
 *
 * Layout per RESEARCH §Q3:
 *   [$(star-full) Default: <name>]   ← only if store.defaultEventName set
 *   ─── Saved events ───
 *   <event1>
 *   <event2>
 *   ─── Actions ───
 *   $(add)   Create new event…
 *   $(edit)  Edit current default…
 *   $(close) Run with empty params
 */

export type PickerResult =
    | { kind: 'event'; name: string; body: Record<string, unknown> }
    | { kind: 'create' }
    | { kind: 'edit-default' }
    | { kind: 'empty' };

export interface PickerOptions {
    /** Title shown above the picker; defaults to a generic prompt. */
    headerLabel?: string;
    /** When true, action rows (Create / Edit default / Run empty) are hidden.
     *  Used by Edit / Delete / SetDefault commands which only want to pick
     *  an existing event. */
    eventsOnly?: boolean;
}

type PickerItem = vscode.QuickPickItem & {
    action?: 'create' | 'edit-default' | 'empty' | 'default-header';
    eventName?: string;
};

export async function pickTestEvent(
    identity: string,
    store: TestEventStore | undefined,
    options: PickerOptions = {},
): Promise<PickerResult | undefined> {
    void identity; // reserved for future per-identity titling

    const items: PickerItem[] = [];
    const eventNames = store ? Object.keys(store.events).sort() : [];
    const defaultName = store?.defaultEventName || '';

    if (defaultName && store && store.events[defaultName]) {
        items.push({
            label: `$(star-full) Default: ${defaultName}`,
            detail: 'Resolved automatically when no picker is shown',
            action: 'default-header',
            eventName: defaultName,
        });
    }

    if (eventNames.length > 0) {
        items.push({
            label: 'Saved events',
            kind: vscode.QuickPickItemKind.Separator,
        });
        for (const name of eventNames) {
            items.push({
                label: name,
                detail: previewBody(store!.events[name]),
                eventName: name,
            });
        }
    }

    if (!options.eventsOnly) {
        items.push({
            label: 'Actions',
            kind: vscode.QuickPickItemKind.Separator,
        });
        items.push({
            label: '$(add) Create new event…',
            action: 'create',
        });
        if (defaultName && store && store.events[defaultName]) {
            items.push({
                label: '$(edit) Edit current default…',
                detail: defaultName,
                action: 'edit-default',
            });
        }
        items.push({
            label: '$(close) Run with empty params',
            action: 'empty',
        });
    }

    const qp = vscode.window.createQuickPick<PickerItem>();
    qp.items = items;
    qp.placeholder = options.headerLabel || 'Select a test event or action…';
    qp.matchOnDetail = true;
    qp.ignoreFocusOut = false;

    try {
        const picked = await new Promise<PickerItem | undefined>((resolve) => {
            qp.onDidAccept(() => resolve(qp.selectedItems[0]));
            qp.onDidHide(() => resolve(undefined));
            qp.show();
        });

        if (!picked) {
            return undefined;
        }
        if (picked.action === 'create') {
            return { kind: 'create' };
        }
        if (picked.action === 'edit-default') {
            return { kind: 'edit-default' };
        }
        if (picked.action === 'empty') {
            return { kind: 'empty' };
        }
        if (picked.eventName && store && store.events[picked.eventName]) {
            return {
                kind: 'event',
                name: picked.eventName,
                body: store.events[picked.eventName],
            };
        }
        return undefined;
    } finally {
        qp.dispose();
    }
}

function previewBody(body: Record<string, unknown>): string {
    try {
        const json = JSON.stringify(body);
        if (json.length <= 80) {
            return json;
        }
        return json.slice(0, 77) + '…';
    } catch {
        return '(unserializable)';
    }
}
