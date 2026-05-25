import * as vscode from 'vscode';
import { resolveScriptIdentity } from './identity';
import { readStore, onDidChangeTestEventStore } from './store';

/**
 * Language Status Item showing the active script's default test event
 * (Phase 999.3 Plan 06 UX iteration, 2026-05-25).
 *
 * Appears in the editor's language-status row whenever a Python file
 * (or remote-tmp `.py` body) is active. Text reflects the current
 * default test event for that script. Click invokes
 * `altium365.testEvents.pick`.
 *
 * Why not a dynamic `editor/title` entry: VS Code static menu titles
 * cannot reference runtime state. Language status items are purpose-
 * built for editor-context indicators with dynamic text + click
 * actions, and naturally hide on non-Python editors.
 *
 * Refresh triggers:
 *   - `onDidChangeActiveTextEditor` — identity may switch with the tab.
 *   - `onDidChangeTestEventStore` — default may have changed for the
 *     active identity (or any other; cheap to refresh unconditionally).
 *
 * CONVENTIONS: single registration factory mirroring
 * `registerTestEventCommands`; returned disposables pushed into
 * `context.subscriptions` at activation.
 */

const STATUS_ITEM_ID = 'altium365.testEvent';

export function registerTestEventStatusItem(
    context: vscode.ExtensionContext,
): vscode.Disposable[] {
    const item = vscode.languages.createLanguageStatusItem(STATUS_ITEM_ID, [
        { language: 'python' },
    ]);
    item.name = 'Altium 365 Test Event';

    const refresh = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            item.text = '$(symbol-event) No script';
            item.detail = 'Test Event';
            item.command = undefined;
            item.severity = vscode.LanguageStatusSeverity.Information;
            return;
        }
        const identity = resolveScriptIdentity(editor.document.uri);
        if (!identity) {
            item.text = '$(symbol-event) Not a script';
            item.detail = 'Test Event';
            item.command = undefined;
            item.severity = vscode.LanguageStatusSeverity.Information;
            return;
        }
        const store = readStore(context, identity.identity);
        const defaultName = store?.defaultEventName;
        const hasDefault = !!(defaultName && store?.events[defaultName]);
        if (hasDefault) {
            item.text = `$(symbol-event) ${defaultName}`;
            item.detail = 'Default test event — click to switch';
            item.severity = vscode.LanguageStatusSeverity.Information;
        } else if (store && Object.keys(store.events).length > 0) {
            item.text = '$(symbol-event) No default';
            item.detail = 'Test events exist — click to pick one';
            item.severity = vscode.LanguageStatusSeverity.Warning;
        } else {
            item.text = '$(symbol-event) No events';
            item.detail = 'Click to create a test event';
            item.severity = vscode.LanguageStatusSeverity.Information;
        }
        item.command = {
            command: 'altium365.testEvents.pick',
            title: 'Pick',
            arguments: [identity],
        };
    };

    refresh();
    const disposables: vscode.Disposable[] = [
        item,
        vscode.window.onDidChangeActiveTextEditor(refresh),
        onDidChangeTestEventStore(refresh),
    ];
    return disposables;
}
