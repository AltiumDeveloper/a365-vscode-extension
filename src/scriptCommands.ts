import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { A365Node } from './sidePanel';
import { getSelectedWorkspace } from './workspace';
import { buildScriptUri, parseScriptUri } from './remoteScriptFs';
import { executeRemoteScript } from './remoteExecution';
import { runScriptAtPath, debugScriptAtPath } from './extension';
import {
    registerLocalScript,
    getLocalScript,
    findLocalScriptByRemoteId,
} from './localScriptCache';
import { withScriptProgress } from './progress';

/**
 * Extract script metadata from either a script node or a script assignment node.
 * Returns undefined if the node is neither, or if it's a non-script assignment.
 */
function extractScriptContext(
    node: any
): { scriptId: string; scriptName: string; workspaceAuthId: string; workspaceUrl: string } | undefined {
    if (node.kind === 'script') {
        return {
            scriptId: node.script.scriptId,
            scriptName: node.script.name,
            workspaceAuthId: node.workspaceAuthId,
            workspaceUrl: node.workspaceUrl,
        };
    }
    
    if (node.kind === 'assignmentNode') {
        if (node.assignment.type !== 'SCRIPT') {
            return undefined;
        }
        
        return {
            scriptId: node.assignment.scriptId || '',
            scriptName: node.assignment.name,
            workspaceAuthId: node.workspaceAuthId,
            workspaceUrl: node.workspaceUrl,
        };
    }
    
    return undefined;
}

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
            'altium365.script.debugLocal',
            (node?: A365Node) => debugLocalFromScriptNode(context, output, node)
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
    // Try extracting from node (script or assignment node)
    if (node) {
        const scriptCtx = extractScriptContext(node);
        if (scriptCtx) {
            // scriptCtx contains authId and url, but we need workspaceId too
            // Recover workspaceId from the node if available
            const workspaceId = 
                'workspaceId' in node ? (node as any).workspaceId : '';
            return {
                workspaceId,
                ...scriptCtx,
            };
        }
        // If node is an assignment but extractScriptContext returned undefined,
        // it means it's a non-script assignment (workflow/default)
        if (node.kind === 'assignmentNode') {
            return undefined;
        }
    }
    const active = vscode.window.activeTextEditor?.document.uri;
    if (!active) {
        return undefined;
    }
    // UAT-6: tmp file (Edit/Run/Debug Local) — tracked in the local
    // script cache. Resolve identity directly from the registry; recover
    // workspaceId from the selected workspace if it matches.
    if (active.scheme === 'file') {
        const identity = getLocalScript(active.fsPath);
        if (identity) {
            const selected = getSelectedWorkspace(context);
            const workspaceId =
                selected && selected.authId === identity.workspaceAuthId
                    ? selected.workspaceId
                    : '';
            return {
                workspaceId,
                workspaceAuthId: identity.workspaceAuthId,
                scriptId: identity.scriptId,
                scriptName: identity.scriptName,
            };
        }
    }
    // Legacy: altium365: virtual URI (kept for back-compat — FSP still
    // registered, may be opened by other code paths).
    try {
        const parsed = parseScriptUri(active);
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
    // UAT-6: open the script as an on-disk tmp file (the same path used
    // by Run/Debug Local) so breakpoints set here apply when the user
    // hits Debug. Save publishes back to A365 via the save bridge in
    // localScriptCache.ts (calls FSP.writeFile under the hood).
    const tmpPath = await downloadScriptToTmp(context, output, node, 'Open Script');
    if (!tmpPath) {
        return;
    }
    try {
        const doc = await vscode.workspace.openTextDocument(tmpPath);
        await vscode.languages.setTextDocumentLanguage(doc, 'python');
        await vscode.window.showTextDocument(doc);
    } catch (e) {
        const err = e as Error;
        output.appendLine(`[Altium 365] Open Script failed: ${err.message}`);
        vscode.window.showErrorMessage('Altium 365: ' + err.message);
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
    // UAT-6: find the tracked tmp file for this remote script and save
    // it. The save listener in localScriptCache.ts pushes the buffer
    // through FSP.writeFile (same publish path as before).
    let entry = findLocalScriptByRemoteId(sc.scriptId);
    if (!entry) {
        // Fall back to legacy altium365: URI lookup for back-compat.
        const legacyUri = buildScriptUri(sc.workspaceAuthId, sc.scriptId, sc.scriptName);
        const legacyDoc = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === legacyUri.toString()
        );
        if (legacyDoc) {
            if (!legacyDoc.isDirty) {
                vscode.window.showInformationMessage(
                    'Altium 365: nothing to publish (no unsaved changes).'
                );
                return;
            }
            try {
                await legacyDoc.save();
                return;
            } catch (e) {
                const err = e as Error;
                output.appendLine(
                    '[Altium 365] Publish Script failed: ' + err.message
                );
                vscode.window.showErrorMessage('Altium 365: ' + err.message);
                return;
            }
        }
        vscode.window.showInformationMessage(
            'Altium 365: open the script in an editor first (right-click → Edit Script).'
        );
        return;
    }
    const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.scheme === 'file' && d.uri.fsPath.toLowerCase() === entry!.fsPath.toLowerCase()
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
    try {
        // doc.save() triggers onDidSaveTextDocument -> save bridge ->
        // FSP.writeFile -> upload + updateScript GraphQL mutation.
        await doc.save();
    } catch (e) {
        const err = e as Error;
        output.appendLine('[Altium 365] Publish Script failed: ' + err.message);
        vscode.window.showErrorMessage('Altium 365: ' + err.message);
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
    const tmpPath = await downloadScriptToTmp(context, output, node, 'Run Script (Local)');
    if (!tmpPath) {
        return;
    }
    // D-01..D-03 (Phase 6): route through the script's owning workspace
    // so cross-workspace right-click runs use the correct token + apiUrl
    // without hijacking the active-workspace selection.
    const target = sc && sc.workspaceId
        ? { workspaceId: sc.workspaceId, workspaceAuthId: sc.workspaceAuthId }
        : undefined;
    await runScriptAtPath(context, tmpPath, target);
}

/**
 * UAT-5 fix: implement Debug Script (Local) for remote scripts. Mirrors
 * runLocalFromScriptNode — same download-to-tmp pipeline — and then
 * hands off to debugScriptAtPath which launches debugpy against
 * `_runner.py` with the script as the first argument. Breakpoints set
 * in the downloaded tmp file are hit (debugpy honors absolute paths).
 */
async function debugLocalFromScriptNode(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    node?: A365Node
): Promise<void> {
    const sc = resolveScriptContext(context, node);
    const tmpPath = await downloadScriptToTmp(context, output, node, 'Debug Script (Local)');
    if (!tmpPath) {
        return;
    }
    // UAT-6: open the script in editor before launching debugpy so the
    // user can set breakpoints in the same buffer that the debugger
    // uses. If the file is already open (e.g. via Edit Script), this is
    // a no-op reveal.
    try {
        const doc = await vscode.workspace.openTextDocument(tmpPath);
        await vscode.languages.setTextDocumentLanguage(doc, 'python');
        await vscode.window.showTextDocument(doc, { preserveFocus: false });
    } catch (e) {
        output.appendLine(
            `[Altium 365] Debug Script (Local): failed to reveal editor: ${(e as Error).message}`
        );
    }
    // D-01..D-03 (Phase 6): same target plumbing as Run (above).
    const target = sc && sc.workspaceId
        ? { workspaceId: sc.workspaceId, workspaceAuthId: sc.workspaceAuthId }
        : undefined;
    await debugScriptAtPath(context, tmpPath, target);
}

/**
 * Shared helper for runLocal / debugLocal: resolves the script context,
 * downloads the body via the `altium365:` FSP, and writes it to
 * `os.tmpdir()/altium365-<scriptId>-<basename>.py`. Returns the temp
 * path, or undefined on error / no-selection (user message already
 * shown).
 */
async function downloadScriptToTmp(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    node: A365Node | undefined,
    actionLabel: string
): Promise<string | undefined> {
    const sc = resolveScriptContext(context, node);
    if (!sc) {
        vscode.window.showErrorMessage(
            `Altium 365: ${actionLabel} — no script selected. Right-click a script in the side panel.`
        );
        return undefined;
    }
    return withScriptProgress(
        `${actionLabel}: loading...`,
        async (signal) => {
            let tmpPath: string | undefined;
            try {
                try {
                    const uri = buildScriptUri(sc.workspaceAuthId, sc.scriptId, sc.scriptName);
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    // D-09 / D-10 / D-12: Altium platform GRID format —
                    //   grid:workspace:{workspaceAuthId}:scripts:script/{scriptId}
                    // The on-disk layout `altium365/<authId>/<scriptId>/<name>.py`
                    // encodes the GRID identity in the path, so (a) the editor
                    // tab title stays as the readable script name (no `altium365-…`
                    // prefix), and (b) two scripts that share a name in different
                    // workspaces resolve to distinct paths — cross-workspace
                    // collisions are impossible. D-11: no migration of legacy
                    // flat `altium365-<id>-<name>.py` files; the cache keys on
                    // fsPath so they keep working until the user closes them.
                    const safeBase = sc.scriptName.replace(/[^\w.-]+/g, '_') || 'script';
                    const fileName = safeBase.toLowerCase().endsWith('.py')
                        ? safeBase
                        : `${safeBase}.py`;
                    const dir = path.join(
                        os.tmpdir(),
                        'altium365',
                        sc.workspaceAuthId,
                        sc.scriptId
                    );
                    // D-12: create the nested directory on demand. D-22: do NOT
                    // wrap in a nested `withScriptProgress` — the surrounding
                    // wrapper already covers this region.
                    await fs.mkdir(dir, { recursive: true });
                    tmpPath = path.join(dir, fileName);
                    await fs.writeFile(tmpPath, bytes);
                    // UAT-6: register the tmp path so (a) the save bridge can publish
                    // back on save, and (b) resolveScriptContext can recognize this
                    // editor as belonging to the remote script.
                    registerLocalScript(tmpPath, {
                        workspaceAuthId: sc.workspaceAuthId,
                        scriptId: sc.scriptId,
                        scriptName: sc.scriptName,
                    });
                    output.appendLine(
                        `[Altium 365] ${actionLabel}: wrote ${bytes.byteLength} bytes to ${tmpPath}`
                    );
                    if (signal.aborted) {
                        return undefined;
                    }
                    return tmpPath;
                } catch (e) {
                    const err = e as Error & { code?: string };
                    const code = (err as { code?: string }).code;
                    const userMsg = mapGraphQLErrorToUserMessage(code, err.message);
                    output.appendLine(
                        `[Altium 365] ${actionLabel} failed: ` +
                            err.message +
                            (code ? ' (code=' + code + ')' : '')
                    );
                    if (err.stack) {
                        output.appendLine(err.stack);
                    }
                    vscode.window.showErrorMessage('Altium 365: ' + userMsg);
                    return undefined;
                }
            } finally {
                if (signal.aborted && tmpPath) {
                    try {
                        await fs.unlink(tmpPath);
                    } catch (e) {
                        output.appendLine(
                            `[Altium 365] cancel cleanup: unlink failed: ${(e as Error).message}`
                        );
                    }
                }
            }
        },
        { cancellable: true },
    );
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
