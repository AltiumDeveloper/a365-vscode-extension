import * as vscode from 'vscode';
import { A365Node } from './sidePanel';

/**
 * Hosts tree-generic (non-script-scoped) command handlers contributed by
 * Phase 02.1. Mirrors the `registerScriptCommands` factory shape per D-11 of
 * `.planning/phases/02.1-side-panel-ux/02.1-CONTEXT.md`.
 *
 * Currently registers `altium365.tree.copyId` (Plan 02.1-03). Future plans
 * (e.g. 02.1-05 Open in Browser) will add their handlers here alongside.
 */
export function registerTreeCommands(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    void context;

    return [
        vscode.commands.registerCommand(
            'altium365.tree.copyId',
            async (node?: A365Node) => {
                if (!node) {
                    output.appendLine('[Altium 365] tree.copyId: ignored kind=undefined');
                    return;
                }
                let id: string | undefined;
                switch (node.kind) {
                    case 'workspace':
                        id = node.info.workspaceId;
                        break;
                    case 'project':
                        id = node.project.id;
                        break;
                    case 'script':
                        id = node.script.scriptId;
                        break;
                    default:
                        output.appendLine(
                            '[Altium 365] tree.copyId: ignored kind=' + node.kind
                        );
                        return;
                }
                if (!id) {
                    output.appendLine(
                        '[Altium 365] tree.copyId: no id on kind=' + node.kind
                    );
                    return;
                }
                try {
                    await vscode.env.clipboard.writeText(id);
                    vscode.window.showInformationMessage(
                        'Altium 365: ID copied to clipboard'
                    );
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Copy ID failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] tree.copyId failed: ' + (err.stack ?? err.message)
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            'altium365.workspace.openInBrowser',
            async (node?: A365Node) => {
                if (!node || node.kind !== 'workspace') {
                    output.appendLine(
                        '[Altium 365] workspace.openInBrowser: ignored kind=' +
                            (node?.kind ?? 'undefined')
                    );
                    return;
                }
                const url = node.url;
                if (!url) {
                    vscode.window.showInformationMessage(
                        'This workspace does not expose a browser URL'
                    );
                    return;
                }
                try {
                    await vscode.env.openExternal(vscode.Uri.parse(url));
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Open in Browser failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] workspace.openInBrowser failed: ' +
                            (err.stack ?? err.message)
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            'altium365.project.openInBrowser',
            async (node?: A365Node) => {
                if (!node || node.kind !== 'project') {
                    output.appendLine(
                        '[Altium 365] project.openInBrowser: ignored kind=' +
                            (node?.kind ?? 'undefined')
                    );
                    return;
                }
                const url = node.url;
                if (!url) {
                    vscode.window.showInformationMessage(
                        'This project does not expose a browser URL'
                    );
                    return;
                }
                try {
                    await vscode.env.openExternal(vscode.Uri.parse(url));
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Open in Browser failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] project.openInBrowser failed: ' +
                            (err.stack ?? err.message)
                    );
                }
            }
        ),
    ];
}
