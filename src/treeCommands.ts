import * as vscode from 'vscode';
import { A365Node } from './sidePanel';
import { applyWorkspaceSelection } from './extension';

/**
 * Safely open an http(s) URL supplied by the GraphQL backend in the user's
 * external browser. Rejects any other scheme (javascript:, file:, vscode:,
 * data:, ...) defensively — `vscode.Uri.parse` is permissive and would
 * otherwise hand a hostile or malformed backend URL to `openExternal`. See
 * WR-04 in 02.1-REVIEW.md.
 */
async function openExternalHttpUrl(
    url: string,
    output: vscode.OutputChannel,
    logTag: string
): Promise<void> {
    let parsed: vscode.Uri;
    try {
        parsed = vscode.Uri.parse(url, true);
    } catch (e) {
        const msg = (e as Error).message;
        vscode.window.showErrorMessage('Altium 365: malformed URL from server');
        output.appendLine(`[Altium 365] ${logTag} rejected malformed URL: ${msg}`);
        return;
    }
    if (parsed.scheme !== 'https' && parsed.scheme !== 'http') {
        vscode.window.showErrorMessage(
            `Altium 365: refusing to open non-http(s) URL (scheme: ${parsed.scheme})`
        );
        output.appendLine(
            `[Altium 365] ${logTag} rejected URL with scheme=${parsed.scheme}`
        );
        return;
    }
    await vscode.env.openExternal(parsed);
}

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
                    case 'extensionPointNode':
                        id = node.extensionPoint.extensionPointId;
                        await vscode.env.clipboard.writeText(id);
                        vscode.window.showInformationMessage(
                            'Extension Point ID copied to clipboard.'
                        );
                        return;
                    case 'assignmentNode':
                        id = node.assignment.assignmentId;
                        await vscode.env.clipboard.writeText(id);
                        vscode.window.showInformationMessage(
                            'Assignment ID copied to clipboard.'
                        );
                        return;
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
                    await openExternalHttpUrl(url, output, 'workspace.openInBrowser');
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
            'altium365.workspace.selectFromNode',
            async (node?: A365Node) => {
                if (!node || node.kind !== 'workspace') {
                    output.appendLine(
                        '[Altium 365] workspace.selectFromNode: ignored kind=' +
                            (node?.kind ?? 'undefined')
                    );
                    return;
                }
                try {
                    await applyWorkspaceSelection(context, node.info);
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Select Workspace failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] workspace.selectFromNode failed: ' +
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
                    await openExternalHttpUrl(url, output, 'project.openInBrowser');
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
