import * as vscode from 'vscode';
import {
    ensureWorkspaceToken,
    getBaseAccessToken,
    readOAuthConfig,
} from './auth';
import {
    GraphQLError,
    getScript,
    getSelectedWorkspace,
    getWorkspaceApiUrl,
    getWorkspaceFilesUrl,
    listWorkspaces,
    updateScript,
    WorkspaceInfo,
} from './workspace';
import { downloadByToken, uploadAndGetToken } from './filesService';

/**
 * FileSystemProvider for the `altium365:` URI scheme.
 *
 * URI shape (D-01, revised post-UAT 2026-05-20 round 2):
 *   `altium365:/grid:workspace:<authId>:scripts:script/<scriptId>/<displayName>`
 *
 * The path is an Altium GRID (Global Resource ID) — the canonical identifier
 * format used across the Altium 365 API. Once `GloScrScript.id: ID!` is
 * exposed by the server, the URI path will match it verbatim. We construct
 * it manually for now from `workspaceAuthId` + `scriptId`.
 *
 * Notes:
 * - VS Code scheme stays `altium365:` so the FSP registration and menu
 *   `when` clauses (`resourceScheme == altium365`) work unchanged.
 * - Colons (`:`) are valid `pchar` per RFC 3986 — VS Code preserves them
 *   in path segments without encoding.
 * - Trailing `<displayName>` is cosmetic: it gives the editor tab a human
 *   label. It is NOT part of the GRID and is ignored when looking up the
 *   script — `scriptId` is the lookup key.
 * - Identifier in URI = `authId` (the workspace's friendly slug used in
 *   GRIDs), NOT the GRID-form `workspaceId` (`grid:global::platform:
 *   workspace/<uuid>`). `resolveWorkspace` looks up `WorkspaceInfo` by
 *   matching `authId` in `listWorkspaces`. The full `workspaceId` is then
 *   obtained from that lookup for token storage (D-08).
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
 *   `scriptId`; throws `FileNotFound` on mismatch. `workspaceId` is opaque
 *   server-issued GRID, validated by membership in `listWorkspaces` result
 *   inside `resolveWorkspace` (auth tier check beats charset check).
 * - T-03-02-02 (cross-workspace endpoint leak): the FSP re-resolves the
 *   per-call workspace from the URI's authority and looks up its endpoint /
 *   token freshly; no cross-workspace state survives in the provider.
 *
 * Plan 03-02 lands the skeleton: `readFile` and `writeFile` throw
 * `FileSystemError.Unavailable` with a "Plan 03-03" message; Plan 03-03
 * replaces those bodies with the real two-step (GraphQL → Files REST) flow.
 */

const UUID_REGEX = /^[0-9a-fA-F-]{36}$/;
const GRID_PATH_REGEX = /^\/grid:workspace:([^:/]+):scripts:script\/([0-9a-fA-F-]{36})(?:\/(.*))?$/;

export interface ParsedRemoteUri {
    /** Workspace `authId` (friendly slug, e.g. `my-team`). NOT the GRID-form workspaceId. */
    authId: string;
    scriptId: string;
    /** Cosmetic display name from the tail of the path; not used for lookup. */
    displayName: string;
}

/**
 * Build a canonical `altium365:` URI for a remote script.
 *
 * The path is the GRID `grid:workspace:<authId>:scripts:script/<scriptId>`
 * followed by `/<displayName>` for tab readability. Pass values raw —
 * `vscode.Uri.from` handles encoding once on stringification.
 */
export function buildScriptUri(
    workspaceAuthId: string,
    scriptId: string,
    scriptName: string
): vscode.Uri {
    if (!workspaceAuthId || /[/:]/.test(workspaceAuthId)) {
        // authId must be a single GRID-safe segment (no `:` or `/`); fail
        // loudly so we catch any caller that passes the wrong field.
        throw new Error(
            'buildScriptUri: workspaceAuthId must be a single segment (got: ' + workspaceAuthId + ')'
        );
    }
    return vscode.Uri.from({
        scheme: 'altium365',
        path:
            '/grid:workspace:' +
            workspaceAuthId +
            ':scripts:script/' +
            scriptId +
            '/' +
            scriptName,
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
    // `uri.path` is already percent-decoded by VS Code's URI parser.
    const m = GRID_PATH_REGEX.exec(uri.path);
    if (!m) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    const authId = m[1];
    const scriptId = m[2];
    const displayName = m[3] ?? '';
    if (!authId || !UUID_REGEX.test(scriptId)) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { authId, scriptId, displayName };
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
        const { authId, scriptId } = parseScriptUri(uri);
        const ws = await this.resolveWorkspace(uri, authId);
        const cfg = readOAuthConfig();
        const wsToken = await ensureWorkspaceToken(this.ctx, cfg, {
            workspaceId: ws.workspaceId,
            authId: ws.authId,
        });
        const apiUrl = getWorkspaceApiUrl(ws, this.getEnvGlobalEndpoint());

        let detail;
        try {
            detail = await getScript(apiUrl, wsToken, scriptId);
        } catch (e) {
            this.logFsError('readFile getScript', uri, e);
            if (e instanceof GraphQLError && this.isAuthCode(e.code)) {
                throw vscode.FileSystemError.NoPermissions(uri);
            }
            throw vscode.FileSystemError.Unavailable(
                'Open Script failed: ' + (e as Error).message
            );
        }

        const filesUrl = getWorkspaceFilesUrl(ws);
        let bytes: Uint8Array;
        try {
            bytes = await downloadByToken(filesUrl, detail.latestFileToken, wsToken);
        } catch (e) {
            this.logFsError('readFile downloadByToken', uri, e);
            throw vscode.FileSystemError.Unavailable(
                'Open Script failed: ' + (e as Error).message
            );
        }

        // Token-hygiene: log only an 8-char prefix of the fileToken, never the
        // bearer (T-03-03-02). The full token would be unique-per-version and
        // is not in itself a credential, but we keep prefixes only out of
        // caution to avoid log-spam if it ever changes shape.
        this.output.appendLine(
            `[Altium 365] readFile ${uri.toString()}: ${bytes.length} bytes via fileToken ${detail.latestFileToken.slice(0, 8)}...`
        );
        return bytes;
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        _options: { create: boolean; overwrite: boolean }
    ): Promise<void> {
        // `_options.create` / `_options.overwrite` are ignored — the
        // `altium365:` URI form addresses an existing remote script by ID, so
        // there is no "create" semantic in v1 (SCRIPT-V2-01 deferred).
        const { authId, scriptId } = parseScriptUri(uri);
        const ws = await this.resolveWorkspace(uri, authId);
        const cfg = readOAuthConfig();
        const wsToken = await ensureWorkspaceToken(this.ctx, cfg, {
            workspaceId: ws.workspaceId,
            authId: ws.authId,
        });
        const apiUrl = getWorkspaceApiUrl(ws, this.getEnvGlobalEndpoint());
        const filesUrl = getWorkspaceFilesUrl(ws);

        let fileToken: string;
        try {
            fileToken = await uploadAndGetToken(filesUrl, wsToken, content);
        } catch (e) {
            this.logFsError('writeFile uploadAndGetToken', uri, e);
            throw vscode.FileSystemError.Unavailable(
                'Publish failed: ' + (e as Error).message
            );
        }

        let version;
        try {
            version = await updateScript(
                apiUrl,
                wsToken,
                scriptId,
                fileToken,
                'Updated via VS Code extension'
            );
        } catch (e) {
            this.logFsError('writeFile updateScript', uri, e);
            if (e instanceof GraphQLError) {
                if (this.isAuthCode(e.code)) {
                    throw vscode.FileSystemError.NoPermissions(uri);
                }
                if (e.code === 'BAD_USER_INPUT') {
                    throw vscode.FileSystemError.Unavailable(
                        'Publish failed: server rejected input (' +
                            (e.message || e.code || 'BAD_USER_INPUT') +
                            ')'
                    );
                }
            }
            throw vscode.FileSystemError.Unavailable(
                'Publish failed: ' + (e as Error).message
            );
        }

        // Defensive — fire change so any other open editors of the same URI
        // re-pull. v1 has no realistic multi-editor flow, but free.
        this._onDidChangeFile.fire([
            { type: vscode.FileChangeType.Changed, uri },
        ]);

        this.output.appendLine(
            `[Altium 365] writeFile ${uri.toString()}: published ${content.length} bytes → scriptVersionId=${version.scriptVersionId}`
        );
    }

    /**
     * Resolve a `WorkspaceInfo` for the given URI's `authId`. Prefers the
     * cached selected workspace when its `authId` matches; otherwise fetches
     * a fresh list via `listWorkspaces` (using the base token).
     * Throws `FileNotFound` if the workspace no longer exists for the
     * signed-in user.
     */
    private async resolveWorkspace(
        uri: vscode.Uri,
        authId: string
    ): Promise<WorkspaceInfo> {
        const selected = getSelectedWorkspace(this.ctx);
        if (selected && selected.authId === authId) {
            return selected;
        }
        const cfg = readOAuthConfig();
        const baseToken = await getBaseAccessToken(this.ctx, cfg);
        if (!baseToken) {
            throw vscode.FileSystemError.NoPermissions(uri);
        }
        const envGlobal = this.getEnvGlobalEndpoint();
        let list: WorkspaceInfo[];
        try {
            list = await listWorkspaces(envGlobal, baseToken);
        } catch (e) {
            this.logFsError('resolveWorkspace listWorkspaces', uri, e);
            throw vscode.FileSystemError.Unavailable(
                'Open Script failed: ' + (e as Error).message
            );
        }
        const ws = list.find((w) => w.authId === authId);
        if (!ws) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return ws;
    }

    private isAuthCode(code: string | undefined): boolean {
        return code === 'AUTH_NOT_AUTHENTICATED' || code === 'UNAUTHORIZED';
    }

    private logFsError(stage: string, uri: vscode.Uri, e: unknown): void {
        const err = e as Error & { rawErrors?: unknown[]; code?: string };
        this.output.appendLine(
            `[Altium 365] ${stage} ${uri.toString()}: ${err.message}`
        );
        if (err instanceof GraphQLError && err.rawErrors) {
            try {
                this.output.appendLine(
                    '[Altium 365]   GraphQL errors: ' +
                        JSON.stringify(err.rawErrors).slice(0, 1000)
                );
            } catch {
                // ignore stringify issues
            }
        }
        if (err.stack) {
            this.output.appendLine(err.stack);
        }
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
