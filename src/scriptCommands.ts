import * as vscode from 'vscode';
import { A365Node } from './sidePanel';
import { getSelectedWorkspace } from './workspace';
import { buildScriptUri, parseScriptUri } from './remoteScriptFs';
import { executeRemoteScript } from './remoteExecution';

/**
 * Registers the four `altium365.script.*` commands declared in package.json.
 *
 * Phase 3 status:
 * - `altium365.script.runLocal` — STILL a placeholder (Phase 02 BLOCKED per
 *   the original P02-06 protocol; SCRIPT-01 is deferred to a later plan
 *   that re-runs the file-download endpoint smoke-probe against a live
 *   workspace). DO NOT touch — out of scope for Phase 3.
 * - `altium365.script.edit`, `altium365.script.publish`,
 *   `altium365.script.executeRemote` — LIVE handlers, wired in Plan 03-02
 *   on top of the new `altium365:` FileSystemProvider (Plan 03-03 lands the
 *   real readFile/writeFile; Plan 03-04 lands the real execute).
 *
 * Resolution patterns:
 *   - When invoked from the tree context menu the command receives an
 *     `A365Node` of `kind === 'script'` carrying workspaceId/authId/script.
 *   - When invoked from the editor/title bar there is no node; resolve from
 *     `vscode.window.activeTextEditor?.document.uri` and `parseScriptUri`.
 *
 * Errors are surfaced at the command boundary via `showErrorMessage`; full
 * detail goes to OutputChannel (D-11). Plan 03-05 tightens the friendly
 * mapping with `mapGraphQLErrorToUserMessage`.
 */
export function registerScriptCommands(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    const placeholder = (label: string) => () =>
        vscode.window.showInformationMessage(
            `Altium 365: ${label} — coming in Phase 3.`
        );

    const getEnvGlobalEndpoint = () =>
        vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', '');

    return [
        // BLOCKED branch: runLocal is a placeholder until the file-download
        // endpoint (RESEARCH.md A1) and package format (A2) are confirmed
        // against a live workspace. Phase 02 BLOCKED — out of scope for
        // Phase 3 per 03-CONTEXT scoping.
        vscode.commands.registerCommand(
            'altium365.script.runLocal',
            placeholder('Run Script (Local)')
        ),
        vscode.commands.registerCommand(
            'altium365.script.edit',
            (node?: A365Node) => editScript(context, output, node)
        ),
        vscode.commands.registerCommand(
            'altium365.script.executeRemote',
            (node?: A365Node) =>
                executeRemoteFromUi(context, output, getEnvGlobalEndpoint(), node)
        ),
        vscode.commands.registerCommand(
            'altium365.script.publish',
            (node?: A365Node) => publishScript(output, node)
        ),
    ];
}

/**
 * Resolve workspace + script identity from either a tree node (`kind`
 * === 'script') or the active editor's `altium365:` URI (editor/title
 * invocation). Returns `undefined` when neither source is usable.
 */
interface ScriptContext {
    workspaceId: string;
    workspaceAuthId: string;
    scriptId: string;
    scriptName: string;
}

function resolveScriptContext(node?: A365Node): ScriptContext | undefined {
    if (node && node.kind === 'script') {
        return {
            workspaceId: node.workspaceId,
            workspaceAuthId: node.workspaceAuthId,
            scriptId: node.script.scriptId,
            scriptName: node.script.name,
        };
    }
    const active = vscode.window.activeTextEditor?.document.uri;
    if (!active) {
        return undefined;
    }
    try {
        const parsed = parseScriptUri(active);
        // workspaceAuthId is not encoded in the URI — recover from the
        // selected workspace if it matches; else leave blank (callers that
        // need it will surface an actionable error).
        return {
            workspaceId: parsed.workspaceId,
            workspaceAuthId: '',
            scriptId: parsed.scriptId,
            scriptName: parsed.displayName,
        };
    } catch {
        return undefined;
    }
}

async function editScript(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    node?: A365Node
): Promise<void> {
    const sc = resolveScriptContext(node);
    if (!sc) {
        vscode.window.showErrorMessage(
            'Altium 365: Open Script — no script selected. Right-click a script in the side panel.'
        );
        return;
    }
    void context;
    try {
        const uri = buildScriptUri(sc.workspaceId, sc.scriptId, sc.scriptName);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    } catch (e) {
        const err = e as Error;
        output.appendLine('[Altium 365] Open Script failed: ' + err.message);
        if (err.stack) {
            output.appendLine(err.stack);
        }
        vscode.window.showErrorMessage('Altium 365: Open Script failed: ' + err.message);
    }
}

async function publishScript(
    output: vscode.OutputChannel,
    node?: A365Node
): Promise<void> {
    const sc = resolveScriptContext(node);
    if (!sc) {
        vscode.window.showErrorMessage(
            'Altium 365: Publish Script — no script selected.'
        );
        return;
    }
    try {
        const uri = buildScriptUri(sc.workspaceId, sc.scriptId, sc.scriptName);
        const doc = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === uri.toString()
        );
        if (!doc) {
            vscode.window.showInformationMessage(
                'Altium 365: open the script in an editor first (right-click → Edit Script).'
            );
            return;
        }
        if (!doc.isDirty) {
            vscode.window.showInformationMessage(
                'Altium 365: nothing to publish (no unsaved changes).'
            );
            return;
        }
        // D-03: save = publish; FSP.writeFile performs the upload.
        await doc.save();
    } catch (e) {
        const err = e as Error;
        output.appendLine('[Altium 365] Publish Script failed: ' + err.message);
        if (err.stack) {
            output.appendLine(err.stack);
        }
        vscode.window.showErrorMessage(
            'Altium 365: Publish Script failed: ' + err.message
        );
    }
}

async function executeRemoteFromUi(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    envGlobalEndpoint: string,
    node?: A365Node
): Promise<void> {
    const sc = resolveScriptContext(node);
    if (!sc) {
        vscode.window.showErrorMessage(
            'Altium 365: Execute Remotely — no script selected.'
        );
        return;
    }
    // Recover workspace name + authId from the selected workspace (if it
    // matches) for diagnostic logging in the OutputChannel header. This is
    // best-effort — the real impl in 03-04 re-resolves WorkspaceInfo via
    // listWorkspaces if needed.
    let workspaceName = '<workspace-name unknown>';
    let workspaceAuthId = sc.workspaceAuthId;
    const selected = getSelectedWorkspace(context);
    if (selected && selected.workspaceId === sc.workspaceId) {
        workspaceName = selected.name;
        if (!workspaceAuthId) {
            workspaceAuthId = selected.authId;
        }
    }
    if (!workspaceAuthId) {
        vscode.window.showErrorMessage(
            'Altium 365: Execute Remotely — could not resolve workspace authId. ' +
                'Open the side panel and refresh, then retry.'
        );
        return;
    }
    try {
        await executeRemoteScript({
            context,
            output,
            workspaceId: sc.workspaceId,
            workspaceAuthId,
            scriptId: sc.scriptId,
            scriptName: sc.scriptName,
            workspaceName,
            envGlobalEndpoint,
        });
    } catch (e) {
        const err = e as Error;
        output.appendLine('[Altium 365] Execute Remotely failed: ' + err.message);
        if (err.stack) {
            output.appendLine(err.stack);
        }
        vscode.window.showErrorMessage(
            'Altium 365: Execute Remotely failed: ' + err.message
        );
    }
}
