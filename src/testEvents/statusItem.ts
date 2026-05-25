import * as vscode from 'vscode';
import { resolveScriptIdentity } from './identity';
import { readStore, onDidChangeTestEventStore } from './store';

/**
 * Status bar indicator for the active script's default test event
 * (Phase 999.3 Plan 06 UX iteration v2, 2026-05-25).
 *
 * Sits on the right side of the status bar, visible only when a Python
 * editor (local `.py` or remote-tmp `altium365:` body) is active. Text
 * shows the current default event name with a `$(symbol-event)` icon
 * so users know at a glance which event will be used on the next Run /
 * Debug / Execute Remotely. Click invokes `altium365.testEvents.pick`.
 *
 * UX iteration history:
 *   v1 — Language Status Item (`vscode.languages.createLanguageStatusItem`).
 *        Rejected: collapsed behind the `{}` indicator at Information
 *        severity; UAT reported "no new button visible".
 *   v2 — Regular StatusBarItem (this implementation). Always visible
 *        when a Python editor is active.
 *
 * Refresh triggers:
 *   - `onDidChangeActiveTextEditor` — identity may switch with the tab.
 *   - `onDidChangeTestEventStore` — default may have changed.
 *
 * CONVENTIONS: single registration factory mirroring
 * `registerTestEventCommands`; returned disposables pushed into
 * `context.subscriptions` at activation.
 */

// Priority chosen to sit just before the existing Altium 365 status
// bar item (user email + env). Higher number = further left on the
// right-aligned status bar. statusBar.ts uses the default priority
// (no explicit value), so we use a positive number to position to its
// left.
const PRIORITY = 100;

export function registerTestEventStatusItem(
    context: vscode.ExtensionContext,
): vscode.Disposable[] {
    const item = vscode.window.createStatusBarItem(
        'altium365.testEvent',
        vscode.StatusBarAlignment.Right,
        PRIORITY,
    );
    item.name = 'Altium 365 Test Event';
    item.command = 'altium365.testEvents.pick';

    const refresh = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            item.hide();
            return;
        }
        // Gate by language id — matches local `.py` AND remote-tmp
        // editors whose language is explicitly set to python by the
        // FileSystemProvider.
        if (editor.document.languageId !== 'python') {
            item.hide();
            return;
        }
        const identity = resolveScriptIdentity(editor.document.uri);
        if (!identity) {
            // Standalone .py without a recognised identity — still
            // surface the affordance; pick command will warn-and-noop
            // if the user clicks without context.
            item.text = '$(symbol-event) No script identity';
            item.tooltip = 'Test events require a recognised script identity';
            item.show();
            return;
        }
        const store = readStore(context, identity.identity);
        const defaultName = store?.defaultEventName;
        const hasDefault = !!(defaultName && store?.events[defaultName]);
        if (hasDefault) {
            item.text = `$(symbol-event) ${defaultName}`;
            item.tooltip = `Altium 365 default test event: ${defaultName}\nClick to switch / create / edit.`;
            item.backgroundColor = undefined;
        } else if (store && Object.keys(store.events).length > 0) {
            item.text = '$(symbol-event) No default';
            item.tooltip = 'Test events exist but no default is set — click to pick one.';
            item.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground',
            );
        } else {
            item.text = '$(symbol-event) No events';
            item.tooltip = 'No test events yet — click to create one.';
            item.backgroundColor = undefined;
        }
        item.show();
    };

    refresh();
    const disposables: vscode.Disposable[] = [
        item,
        vscode.window.onDidChangeActiveTextEditor(refresh),
        onDidChangeTestEventStore(refresh),
    ];
    return disposables;
}
