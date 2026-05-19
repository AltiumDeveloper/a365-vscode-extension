import * as vscode from 'vscode';
import {
    AuthState,
    getActiveUserLabel,
    getStoredTokens,
    onAuthStateChanged,
} from './auth';

export interface StatusBarHandle {
    item: vscode.StatusBarItem;
    subscription: vscode.Disposable;
}

/**
 * Creates the Altium 365 status bar item and wires it to onAuthStateChanged.
 *
 * Returns the StatusBarItem and the listener subscription separately so the
 * caller (extension.ts activate()) can push both into ctx.subscriptions for
 * disposal on deactivate. No state or commands are registered here — the
 * altium365.statusBar.click command is registered in activate() per
 * PATTERNS.md (registration belongs to the activation site).
 */
export function createStatusBar(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): StatusBarHandle {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.command = 'altium365.statusBar.click';
    item.tooltip = 'Altium 365 — click for actions';

    async function render(stateHint?: AuthState): Promise<void> {
        try {
            const signedIn =
                typeof stateHint?.signedIn === 'boolean'
                    ? stateHint.signedIn
                    : !!(await getStoredTokens(context));
            if (!signedIn) {
                item.hide();
                return;
            }
            let user: string | undefined =
                stateHint?.user && stateHint.user.length > 0 ? stateHint.user : undefined;
            if (!user) {
                user = await getActiveUserLabel(context);
            }
            if (!user) {
                user = '(signed in)';
            }
            const envFromHint =
                stateHint?.environment && stateHint.environment.length > 0
                    ? stateHint.environment
                    : undefined;
            const envFromSetting = vscode.workspace
                .getConfiguration('altium365')
                .get<string>('activeEnvironment', '');
            const env = envFromHint || envFromSetting || 'default';
            item.text = `$(account) A365: ${user} • ${env}`;
            item.show();
        } catch (e) {
            output.appendLine('[Altium 365] statusBar: ' + (e as Error).message);
            item.hide();
        }
    }

    const subscription = onAuthStateChanged((state) => {
        void render(state);
    });

    void render();

    return { item, subscription };
}
