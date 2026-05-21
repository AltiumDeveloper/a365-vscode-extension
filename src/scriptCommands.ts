import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { A365Node } from './sidePanel';
import { getSelectedWorkspace } from './workspace';
import { buildScriptUri, parseScriptUri } from './remoteScriptFs';
import { executeRemoteScript } from './remoteExecution';
import { runScriptAtPath } from './extension';

/**
 * Registers the four `altium365.script.*` commands declared in package.json.
 *
 * Status:
 * - `altium365.script.runLocal` — LIVE (UAT-3 fix following Phase 04). The
 *   Phase 02 BLOCKED dependency on the script-download endpoint was
 *   resolved when Plan 03-03 shipped the `altium365:` FileSystemProvider
 *   readFile path. `runLocal` now: (1) reads the script body via the FSP,
 *   (2) writes it to `os.tmpdir()/altium365-<scriptId>-<basename>.py`,
 *   (3) hands off to `runScriptAtPath` (the same machinery that runs
 *   on-disk Python files via `python/_runner.py` with the A365 helper).
 * - `altium365.script.edit`, `altium365.script.publish`,
 *   `altium365.script.executeRemote` — LIVE handlers, wired in Plan 03-02
 *   on top of the `altium365:` FileSystemProvider.
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
    void placeholder; // retained for future deferred commands

    const getEnvGlobalEndpoint = () =>
        vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', '');

    return [
        vscode.commands.registerCommand(
            'altium365.script.runLocal',
            (node?: A365Node) => runLocalFromScriptNode(context, output, node)
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
            (node?: A365Node) => publishScript(context, output, node)
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

/**
 * Map a known A365 GraphQL error code to a user-friendly toast message.
 * Unknown / undefined codes fall through to the raw message — better to leak
 * an internal code than to misclassify a failure (D-11, T-03-05-01).
 *
 * Curated from RESEARCH §Common Pitfalls + Phase 02 OAuth-error pattern
 * (commit a00dcc0). Codes confirmed during 03-UAT may be added later.
 */
function mapGraphQLErrorToUserMessage(
    code: string | undefined,
    rawMessage: string
): string {
    switch ((code || '').toUpperCase()) {
        case 'AUTH_NOT_AUTHENTICATED':
            return 'Altium 365 session expired. Sign out and sign in again, then retry.';
        case 'UNAUTHORIZED':
            return 'Altium 365: not authorized for this workspace. Switch workspace and retry.';
        case 'BAD_USER_INPUT':
            return 'Altium 365 rejected the input. Check parameter values and try again.';
        case 'NOT_FOUND':
            return 'Altium 365: resource not found (it may have been deleted). Refresh the side panel.';
        default:
            return rawMessage;
    }
}

function resolveScriptContext(
    context: vscode.ExtensionContext,
    node?: A365Node
): ScriptContext | undefined {
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
        // URI carries `authId` (per the GRID format). Recover the GRID-form
        // workspaceId from the selected workspace iff its authId matches;
        // otherwise leave blank — executeRemote surfaces an actionable
        // error if it actually needs the workspaceId.
        const selected = getSelectedWorkspace(context);
        const workspaceId =
            selected && selected.authId === parsed.authId
                ? selected.workspaceId
                : '';
        return {
            workspaceId,
            workspaceAuthId: parsed.authId,
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
    const sc = resolveScriptContext(context, node);
    if (!sc) {
        vscode.window.showErrorMessage(
            'Altium 365: Open Script — no script selected. Right-click a script in the side panel.'
        );
        return;
    }
    void context;
    try {
        const uri = buildScriptUri(sc.workspaceAuthId, sc.scriptId, sc.scriptName);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(doc, 'python');
        await vscode.window.showTextDocument(doc);
    } catch (e) {
        const err = e as Error & { code?: string };
        const code = (err as { code?: string }).code;
        const userMsg = mapGraphQLErrorToUserMessage(code, err.message);
        output.appendLine(
            '[Altium 365] Open Script failed: ' + err.message + (code ? ' (code=' + code + ')' : '')
        );
        if (err.stack) {
            output.appendLine(err.stack);
        }
        vscode.window.showErrorMessage('Altium 365: ' + userMsg);
    }
}

async function publishScript(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    node?: A365Node
): Promise<void> {
    const sc = resolveScriptContext(context, node);
    if (!sc) {
        vscode.window.showErrorMessage(
            'Altium 365: Publish Script — no script selected.'
        );
        return;
    }
    try {
        const uri = buildScriptUri(sc.workspaceAuthId, sc.scriptId, sc.scriptName);
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
        const err = e as Error & { code?: string };
        const code = (err as { code?: string }).code;
        const userMsg = mapGraphQLErrorToUserMessage(code, err.message);
        output.appendLine(
            '[Altium 365] Publish Script failed: ' +
                err.message +
                (code ? ' (code=' + code + ')' : '')
        );
        if (err.stack) {
            output.appendLine(err.stack);
        }
        vscode.window.showErrorMessage('Altium 365: ' + userMsg);
    }
}

/**
 * UAT-3 fix: implement Run Script (Local) for remote scripts.
 *
 * Pipeline:
 *  1. Resolve `ScriptContext` from the tree node (or active editor URI).
 *  2. Read the script body via the `altium365:` FileSystemProvider — this
 *     is the same readFile path Edit Script uses, so any auth/network
 *     errors surface here with the same friendly mapping.
 *  3. Persist to `os.tmpdir()/altium365-<scriptId>-<basename>.py`. The
 *     scriptId prefix avoids collisions across scripts; the .py extension
 *     ensures the runner / debugger pick the right language. The temp
 *     file is overwritten on subsequent runs of the same script (no
 *     manual cleanup — OS-level tmpdir hygiene applies).
 *  4. Hand off to `runScriptAtPath` — reuses the existing `_runner.py`
 *     subprocess, A365 helper injection, and OutputChannel streaming.
 *
 * Note: this writes to disk so the user can also debug the script later
 * (debugpy needs a real file path). Save-back to A365 is intentionally
 * out of scope — Edit + save-on-publish remains the editing path.
 */
async function runLocalFromScriptNode(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    node?: A365Node
): Promise<void> {
    const sc = resolveScriptContext(context, node);
    if (!sc) {
        vscode.window.showErrorMessage(
            'Altium 365: Run Script (Local) — no script selected. Right-click a script in the side panel.'
        );
        return;
    }
    try {
        const uri = buildScriptUri(sc.workspaceAuthId, sc.scriptId, sc.scriptName);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const safeBase = sc.scriptName.replace(/[^\w.-]+/g, '_') || 'script.py';
        const baseWithExt = safeBase.toLowerCase().endsWith('.py')
            ? safeBase
            : `${safeBase}.py`;
        const tmpPath = path.join(
            os.tmpdir(),
            `altium365-${sc.scriptId}-${baseWithExt}`
        );
        await fs.writeFile(tmpPath, bytes);
        output.appendLine(
            `[Altium 365] Run Script (Local): wrote ${bytes.byteLength} bytes to ${tmpPath}`
        );
        await runScriptAtPath(context, tmpPath);
    } catch (e) {
        const err = e as Error & { code?: string };
        const code = (err as { code?: string }).code;
        const userMsg = mapGraphQLErrorToUserMessage(code, err.message);
        output.appendLine(
            '[Altium 365] Run Script (Local) failed: ' +
                err.message +
                (code ? ' (code=' + code + ')' : '')
        );
        if (err.stack) {
            output.appendLine(err.stack);
        }
        vscode.window.showErrorMessage('Altium 365: ' + userMsg);
    }
}

async function executeRemoteFromUi(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    envGlobalEndpoint: string,
    node?: A365Node
): Promise<void> {
    const sc = resolveScriptContext(context, node);
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
        const err = e as Error & { code?: string };
        const code = (err as { code?: string }).code;
        const userMsg = mapGraphQLErrorToUserMessage(code, err.message);
        output.appendLine(
            '[Altium 365] Execute Remotely failed: ' +
                err.message +
                (code ? ' (code=' + code + ')' : '')
        );
        if (err.stack) {
            output.appendLine(err.stack);
        }
        vscode.window.showErrorMessage('Altium 365: ' + userMsg);
    }
}
