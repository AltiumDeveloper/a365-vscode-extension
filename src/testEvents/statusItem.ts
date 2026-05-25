import * as vscode from 'vscode';
import { ScriptIdentity, resolveScriptIdentity } from './identity';
import { readStore, onDidChangeTestEventStore } from './store';

/**
 * Status bar indicator for the active script's default test event
 * (Phase 999.3 Plan 06 UX iteration v2, 2026-05-25).
 *
 * Sits on the right side of the status bar, visible only when a Python
 * editor (local `.py` or remote-tmp `altium365:` body) is active. Text
 * shows the current default event name with a `$(symbol-event)` icon
 * so users know at a glance which event will be used on the next Run /
 * Debug / Execute Remotely. Click invokes `altium365.testEvents.setDefault`
 * so the visible default actually changes after the user picks — the
 * transient `pick` command returns a body for one-shot runs and would
 * leave the indicator stale.
 *
 * UX iteration history:
 *   v1 — Language Status Item (`vscode.languages.createLanguageStatusItem`).
 *        Rejected: collapsed behind the `{}` indicator at Information
 *        severity; UAT reported "no new button visible".
 *   v2 — Regular StatusBarItem wired to `testEvents.pick`. Rejected:
 *        pick is transient and never mutates `defaultEventName`, so the
 *        indicator text never updated after a click.
 *   v3 — StatusBarItem wired to `testEvents.setDefault` (this impl).
 *        setDefault writes the store → fires `onDidChangeTestEventStore`
 *        → refresh() re-reads and updates the visible text.
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
    item.command = 'altium365.testEvents.setDefault';

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
            item.tooltip = buildTooltip(
                'No script identity',
                'The active editor is not a recognised Altium 365 script.',
                undefined,
            );
            item.show();
            return;
        }
        const store = readStore(context, identity.identity);
        const defaultName = store?.defaultEventName;
        const hasDefault = !!(defaultName && store?.events[defaultName]);
        if (hasDefault) {
            item.text = `$(symbol-event) ${defaultName}`;
            item.tooltip = buildTooltip(
                `Default: ${defaultName}`,
                `This event will be passed to **Run**, **Debug**, and **Execute Remotely** for the active script. Click to switch the default.`,
                identity,
            );
            item.backgroundColor = undefined;
        } else if (store && Object.keys(store.events).length > 0) {
            item.text = '$(symbol-event) No default';
            item.tooltip = buildTooltip(
                'No default test event',
                `Test events exist for this script but none is marked as the default. Click to pick or set one.`,
                identity,
            );
            item.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground',
            );
        } else {
            item.text = '$(symbol-event) No events';
            item.tooltip = buildTooltip(
                'No test events',
                `No test events stored for this script yet. Click to create one.`,
                identity,
            );
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

/**
 * Build a rich MarkdownString tooltip for the status bar item.
 * Includes Altium 365 attribution, plain-language explanation of what
 * test events are, current state, and links to the relevant commands
 * so the affordance teaches itself the first time a user hovers it.
 */
function buildTooltip(
    headline: string,
    state: string,
    identity: ScriptIdentity | undefined,
): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.supportThemeIcons = true;
    md.appendMarkdown(`**Altium 365 — Test Events**\n\n`);
    md.appendMarkdown(`$(symbol-event) **${headline}**\n\n`);
    md.appendMarkdown(`${state}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(
        `Test events are **named JSON parameter sets** attached to a script — ` +
            `AWS-Lambda-style. The same event is used by **Run**, **Debug**, and ` +
            `**Execute Remotely**, so you can keep multiple parameterizations ` +
            `(e.g. \`small-project\`, \`with-errors\`, \`production-id\`) and switch ` +
            `between them in one click.\n\n`,
    );
    if (identity) {
        const args = encodeURIComponent(JSON.stringify([identity]));
        md.appendMarkdown(
            `[Set default](command:altium365.testEvents.setDefault?${args} "Switch the default event for this script") · ` +
                `[Pick for one run](command:altium365.testEvents.pick?${args} "Choose an event for a single Run/Debug without changing the default") · ` +
                `[Create new](command:altium365.testEvents.create?${args} "Create a new event") · ` +
                `[Edit current](command:altium365.testEvents.edit?${args} "Open the current event's JSON in an editor")\n`,
        );
    }
    return md;
}
