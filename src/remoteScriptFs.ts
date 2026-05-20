import * as vscode from 'vscode';

/**
 * FileSystemProvider for the `altium365:` URI scheme.
 *
 * URI shape (D-01): `altium365://<workspaceId>/<scriptId>/<scriptName>.py`
 * - `authority` carries the workspaceId (host segment) so VS Code's URI
 *   normalisation treats different workspaces as distinct hosts (separate
 *   editor groups, no path collisions across workspaces).
 * - First path segment is the scriptId; remainder is the display name
 *   (`.py` extension drives Python syntax highlighting / language services
 *   automatically — RESEARCH §Don't Hand-Roll).
 *
 * Decisions:
 * - D-01: this scheme + provider pattern.
 * - D-03: Save = Publish — `writeFile` IS the publish; failure throws
 *   `FileSystemError` so VS Code shows the standard save-failure indicator
 *   and the document stays dirty for retry.
 * - D-07 / D-19: every GraphQL call goes through `getWorkspaceApiUrl(ws,
 *   envGlobalEndpoint)`; every Files Service REST call goes through
 *   `getWorkspaceFilesUrl(ws)`. The provider re-resolves the workspace from
 *   the URI authority on every call — no caching.
 * - D-08: tokens come from `ensureWorkspaceToken(...)`; this module NEVER
 *   caches a bearer.
 *
 * Threat mitigations:
 * - T-03-02-01 (path traversal): `parseScriptUri` enforces UUID regex on
 *   both workspaceId and scriptId; throws `FileNotFound` on mismatch.
 * - T-03-02-02 (cross-workspace endpoint leak): the FSP re-resolves the
 *   per-call workspace from the URI's authority and looks up its endpoint /
 *   token freshly; no cross-workspace state survives in the provider.
 *
 * Plan 03-02 lands the skeleton: `readFile` and `writeFile` throw
 * `FileSystemError.Unavailable` with a "Plan 03-03" message; Plan 03-03
 * replaces those bodies with the real two-step (GraphQL → Files REST) flow.
 */

const UUID_REGEX = /^[0-9a-fA-F-]{36}$/;

export interface ParsedRemoteUri {
    workspaceId: string;
    scriptId: string;
    /** `.py` filename for display only; not part of the lookup key. */
    displayName: string;
}

/**
 * Build a canonical `altium365:` URI for a remote script.
 *
 * `authority` = workspaceId, path = `/<scriptId>/<scriptName>` so the
 * built URI stringifies as `altium365://<wsId>/<scriptId>/<encoded-name>`.
 */
export function buildScriptUri(
    workspaceId: string,
    scriptId: string,
    scriptName: string
): vscode.Uri {
    return vscode.Uri.from({
        scheme: 'altium365',
        authority: workspaceId,
        path: '/' + scriptId + '/' + encodeURIComponent(scriptName),
    });
}

/**
 * Strict URI parser. On any malformed component throws
 * `FileSystemError.FileNotFound(uri)` so VS Code shows a clean "file not
 * found" rather than leaking parse internals (defence in depth — the
 * scheme + URI builder is internal but `vscode.workspace.openTextDocument`
 * accepts any URI string from caller code).
 */
export function parseScriptUri(uri: vscode.Uri): ParsedRemoteUri {
    if (uri.scheme !== 'altium365') {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    const workspaceId = uri.authority;
    if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    // path is `/<scriptId>/<scriptName>` — split off leading slash, then by
    // the first remaining slash so display names containing `/` (unlikely
    // but possible after decode) survive the round-trip via the second arg.
    const trimmed = uri.path.replace(/^\/+/, '');
    const slash = trimmed.indexOf('/');
    if (slash < 0) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    const scriptId = trimmed.slice(0, slash);
    const rest = trimmed.slice(slash + 1);
    if (!UUID_REGEX.test(scriptId) || rest.length === 0) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    let displayName: string;
    try {
        displayName = decodeURIComponent(rest);
    } catch {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { workspaceId, scriptId, displayName };
}

/**
 * FileSystemProvider for `altium365:` script URIs.
 *
 * Constructor wires the dependencies the real impl in Plan 03-03 needs;
 * Plan 03-02 only stores them. Tokens are NEVER cached here (D-08).
 */
export class AltiumRemoteScriptFs implements vscode.FileSystemProvider {
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    public readonly onDidChangeFile = this._onDidChangeFile.event;

    constructor(
        protected readonly ctx: vscode.ExtensionContext,
        protected readonly getEnvGlobalEndpoint: () => string,
        protected readonly output: vscode.OutputChannel
    ) {
        void this.ctx;
        void this.getEnvGlobalEndpoint;
        void this.output;
    }

    watch(_uri: vscode.Uri): vscode.Disposable {
        // No-op v1 (D-03): saves are explicit, no external watcher required.
        return new vscode.Disposable(() => {});
    }

    stat(_uri: vscode.Uri): vscode.FileStat {
        // VS Code uses the readFile result's length as the actual buffer
        // size — `size: 0` here is a placeholder.
        return {
            type: vscode.FileType.File,
            ctime: 0,
            mtime: Date.now(),
            size: 0,
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    delete(uri: vscode.Uri): void {
        // SCRIPT-V2-02 — out of scope for v1.
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    rename(oldUri: vscode.Uri, _newUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        // STUB — Plan 03-03 replaces this body with the two-step
        // (GraphQL `gloScrScript` → fileToken → Files Service GET) flow.
        // Validate URI shape early so a malformed URI returns FileNotFound
        // even from the stub.
        parseScriptUri(uri);
        throw vscode.FileSystemError.Unavailable(
            'readFile not yet implemented (Plan 03-03)'
        );
    }

    async writeFile(
        uri: vscode.Uri,
        _content: Uint8Array,
        _options: { create: boolean; overwrite: boolean }
    ): Promise<void> {
        // STUB — Plan 03-03 replaces this body with the two-step
        // (Files Service POST → `gloScrUpdateScript` mutation) flow.
        parseScriptUri(uri);
        throw vscode.FileSystemError.Unavailable(
            'writeFile not yet implemented (Plan 03-03)'
        );
    }

    /**
     * Internal — used by Plan 03-03 to fire change events after writeFile
     * succeeds. Exposed protected so the future subclass / impl can fire
     * events without exposing the emitter publicly.
     */
    protected fireChange(events: vscode.FileChangeEvent[]): void {
        this._onDidChangeFile.fire(events);
    }
}
