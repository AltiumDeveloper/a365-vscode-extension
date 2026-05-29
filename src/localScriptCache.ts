import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildScriptUri, AltiumRemoteScriptFs } from './remoteScriptFs';
import { withScriptProgress } from './progress';
import { updateAssignment, getWorkspaceApiUrl, getSelectedWorkspace, listWorkspaces, WorkspaceInfo } from './workspace';
import { ensureWorkspaceToken, readOAuthConfig, getBaseAccessToken } from './auth';

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
    /** Optional assignment ID when script was opened via an assignment node.
     * Used to automatically update the assignment to latest version on publish. */
    assignmentId?: string;
}

const registry = new Map<string, LocalScriptIdentity>();

/** Case-normalized fsPath key — lowercase on win32/darwin, raw on linux. Single source of truth for cross-module identity equality (per .planning/phases/999.3-script-test-events-backlog/999.3-RESEARCH.md §Don't Hand-Roll Q5). */
export function normalizeLocalScriptKey(fsPath: string): string {
    // Resolve symlinks to canonical path (fixes macOS /var vs /private/var mismatch)
    let resolved: string;
    try {
        resolved = fsSync.realpathSync(fsPath);
    } catch {
        // File might not exist yet (edge case), use original path
        resolved = fsPath;
    }
    
    // Normalize for case-insensitive filesystems (Windows, default macOS).
    return process.platform === 'win32' || process.platform === 'darwin'
        ? resolved.toLowerCase()
        : resolved;
}

export function registerLocalScript(
    fsPath: string,
    identity: LocalScriptIdentity
): void {
    const normalizedKey = normalizeLocalScriptKey(fsPath);
    registry.set(normalizedKey, identity);
}

export function getLocalScript(
    fsPath: string
): LocalScriptIdentity | undefined {
    const normalizedKey = normalizeLocalScriptKey(fsPath);
    return registry.get(normalizedKey);
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
 * Rehydrate the in-memory cache by scanning the on-disk GRID layout
 * `os.tmpdir()/altium365/<workspaceAuthId>/<scriptId>/<name>.py`
 * (introduced by Plan 06-01 D-10/D-12). Called SYNCHRONOUSLY on
 * extension activation so that remote-tmp `.py` tabs restored by VS
 * Code from a previous session are recognized as remote BEFORE the
 * `altium365.activeIsRemoteScript` context key (D-15) is seeded —
 * otherwise the submenu hides Execute Remotely / Publish for restored
 * tabs until the user re-downloads the script.
 *
 * Sync I/O is acceptable here: the walk is bounded (typically a handful
 * of dirs, a few dozen files at most) and runs once at startup. The
 * async equivalent introduced a race where the seed fired before
 * rehydration completed (UAT-3).
 *
 * Best-effort: silently swallows ENOENT (no remote scripts ever
 * downloaded) and any per-entry errors (partial cache > broken
 * activation). The script body itself is not re-fetched — the path
 * encodes identity (workspaceAuthId, scriptId, fileName) so a directory
 * walk is sufficient.
 */
export function rehydrateLocalScriptCacheFromDisk(): number {
    const root = path.join(os.tmpdir(), 'altium365');
    let count = 0;
    let authDirs: fsSync.Dirent[];
    try {
        authDirs = fsSync.readdirSync(root, { withFileTypes: true });
    } catch {
        return 0; // directory missing — first run, nothing to rehydrate
    }
    for (const authEntry of authDirs) {
        if (!authEntry.isDirectory()) continue;
        const workspaceAuthId = authEntry.name;
        const authDir = path.join(root, workspaceAuthId);
        let scriptDirs: fsSync.Dirent[];
        try {
            scriptDirs = fsSync.readdirSync(authDir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const scriptEntry of scriptDirs) {
            if (!scriptEntry.isDirectory()) continue;
            const scriptId = scriptEntry.name;
            const scriptDir = path.join(authDir, scriptId);
            let files: fsSync.Dirent[];
            try {
                files = fsSync.readdirSync(scriptDir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const f of files) {
                if (!f.isFile() || !f.name.toLowerCase().endsWith('.py')) continue;
                const fsPath = path.join(scriptDir, f.name);
                registerLocalScript(fsPath, {
                    workspaceAuthId,
                    scriptId,
                    scriptName: f.name,
                });
                count++;
            }
        }
    }
    return count;
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
 * 
 * Phase 10: After successful publish, if the script was opened via an
 * assignment node, automatically updates that assignment to the latest
 * script version using the `updateAssignment` GraphQL mutation.
 */
export function registerLocalScriptSaveBridge(
    context: vscode.ExtensionContext,
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
        await withScriptProgress(
            'Publishing script...',
            async () => {
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
                    
                    // Phase 10: If script was opened from an assignment node,
                    // auto-update the assignment to the latest published version.
                    if (identity.assignmentId) {
                        try {
                            // Resolve workspace from authId (same pattern as remoteScriptFs.resolveWorkspace)
                            let workspace: WorkspaceInfo | undefined = getSelectedWorkspace(context);
                            if (!workspace || workspace.authId !== identity.workspaceAuthId) {
                                // Selected workspace doesn't match — fetch all workspaces and find by authId
                                const cfg = readOAuthConfig();
                                const baseToken = await getBaseAccessToken(context, cfg);
                                if (!baseToken) {
                                    throw new Error('No base access token available');
                                }
                                const envGlobal = vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', '');
                                const list = await listWorkspaces(envGlobal, baseToken);
                                workspace = list.find((w) => w.authId === identity.workspaceAuthId);
                                if (!workspace) {
                                    throw new Error(`Workspace ${identity.workspaceAuthId} not found`);
                                }
                            }
                            
                            const cfg = readOAuthConfig();
                            const wsToken = await ensureWorkspaceToken(context, cfg, {
                                workspaceId: workspace.workspaceId,
                                authId: workspace.authId,
                            });
                            const apiUrl = getWorkspaceApiUrl(workspace, 
                                vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', '')
                            );
                            
                            // Fetch latest script version (writeFile just created it)
                            const { getScript } = await import('./workspace');
                            const scriptDetail = await getScript(apiUrl, wsToken, identity.scriptId);
                            
                            // Update assignment to latest version
                            await updateAssignment(
                                apiUrl,
                                wsToken,
                                identity.assignmentId,
                                identity.scriptId,
                                scriptDetail.latestVersionId
                            );
                            
                            output.appendLine(
                                `[Altium 365] Auto-updated assignment ${identity.assignmentId} to version ${scriptDetail.latestVersionId}`
                            );
                        } catch (e) {
                            // Non-fatal — publish succeeded, assignment update is best-effort
                            output.appendLine(
                                `[Altium 365] Assignment auto-update failed (non-fatal): ${(e as Error).message}`
                            );
                        }
                    }
                } catch (e) {
                    const err = e as Error;
                    output.appendLine(
                        `[Altium 365] Publish failed for ${doc.uri.fsPath}: ${err.message}`
                    );
                    vscode.window.showErrorMessage(
                        `Altium 365: publish failed — ${err.message}`
                    );
                }
            },
            { cancellable: false },
        );
    });
}
