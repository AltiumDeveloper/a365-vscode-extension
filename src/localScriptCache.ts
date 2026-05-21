import * as vscode from 'vscode';
import { buildScriptUri, AltiumRemoteScriptFs } from './remoteScriptFs';

/**
 * In-memory mapping from local tmp file path -> remote script identity.
 *
 * Edit / Run / Debug Script (Local) all download a script body to
 * `os.tmpdir()/altium365-<scriptId>-<basename>.py` so the user can set
 * breakpoints in a real on-disk file (debugpy requirement) and still
 * publish back to Altium 365 on save.
 *
 * The save-back path bridges through this registry: a global
 * `onDidSaveTextDocument` listener checks whether the saved document's
 * fsPath is a tracked tmp file; if so it forwards the content to
 * `vscode.workspace.fs.writeFile(altium365Uri, ...)` which in turn
 * invokes `AltiumRemoteScriptFs.writeFile` (the existing publish path).
 *
 * Keys are `path.normalize`-friendly absolute paths. The registry lives
 * for the extension lifetime; entries are not pruned on tmp-file
 * deletion (cheap memory footprint, and re-downloads simply overwrite
 * the entry with the same value).
 */

export interface LocalScriptIdentity {
    workspaceAuthId: string;
    scriptId: string;
    scriptName: string;
}

const registry = new Map<string, LocalScriptIdentity>();

function key(fsPath: string): string {
    // Normalize for case-insensitive filesystems (Windows, default macOS).
    return process.platform === 'win32' || process.platform === 'darwin'
        ? fsPath.toLowerCase()
        : fsPath;
}

export function registerLocalScript(
    fsPath: string,
    identity: LocalScriptIdentity
): void {
    registry.set(key(fsPath), identity);
}

export function getLocalScript(
    fsPath: string
): LocalScriptIdentity | undefined {
    return registry.get(key(fsPath));
}

/**
 * Find an already-tracked tmp file for the given remote scriptId. Used
 * by the Publish Script command to locate the editor that owns the
 * dirty buffer.
 */
export function findLocalScriptByRemoteId(
    scriptId: string
): { fsPath: string; identity: LocalScriptIdentity } | undefined {
    for (const [k, identity] of registry.entries()) {
        if (identity.scriptId === scriptId) {
            return { fsPath: k, identity };
        }
    }
    return undefined;
}

/**
 * Wire the save-back listener. Returns a Disposable to be added to
 * `context.subscriptions`. Idempotent registration is the caller's job.
 *
 * Bypasses `vscode.workspace.fs.writeFile` (which probes parent
 * directories via stat and trips on the FSP's flat URI model — it
 * surfaced as "Unable to create folder ... that already exists but is
 * not a directory" during UAT-7). Calls the FSP's `writeFile` directly
 * with `create:true, overwrite:true`, matching the contract used when
 * VS Code saves a doc opened on the altium365: URI.
 */
export function registerLocalScriptSaveBridge(
    output: vscode.OutputChannel,
    remoteFs: AltiumRemoteScriptFs
): vscode.Disposable {
    return vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.uri.scheme !== 'file') {
            return;
        }
        const identity = getLocalScript(doc.uri.fsPath);
        if (!identity) {
            return;
        }
        const remoteUri = buildScriptUri(
            identity.workspaceAuthId,
            identity.scriptId,
            identity.scriptName
        );
        try {
            const bytes = Buffer.from(doc.getText(), 'utf-8');
            await remoteFs.writeFile(remoteUri, bytes, {
                create: true,
                overwrite: true,
            });
            output.appendLine(
                `[Altium 365] Published ${doc.uri.fsPath} -> ${remoteUri.toString()} (${bytes.length} bytes)`
            );
            vscode.window.setStatusBarMessage(
                `Altium 365: published ${identity.scriptName}`,
                3000
            );
        } catch (e) {
            const err = e as Error;
            output.appendLine(
                `[Altium 365] Publish failed for ${doc.uri.fsPath}: ${err.message}`
            );
            vscode.window.showErrorMessage(
                `Altium 365: publish failed — ${err.message}`
            );
        }
    });
}
