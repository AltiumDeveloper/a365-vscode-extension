import * as vscode from 'vscode';
import {
    clearAllTokens,
    ensureWorkspaceToken,
    getActiveAccessToken,
    getBaseAccessToken,
    OAuthConfig,
    readOAuthConfig,
    signIn,
} from './auth';

export interface WorkspaceLocation {
    apiServiceUrl?: string;
    /**
     * Per-workspace Files Service base URL — Phase 3 D-19 carry-over for the
     * Files Service tier (mirrors `apiServiceUrl`). Populated by
     * `listWorkspaces` after the 03-01 schema bump. Older cached
     * `WorkspaceInfo` blobs may lack this field — `getWorkspaceFilesUrl`
     * throws actionably so callers surface a "refresh workspaces" message.
     */
    filesServiceUrl?: string;
}

export interface WorkspaceInfo {
    name: string;
    workspaceId: string;
    authId: string;
    url?: string;
    location?: WorkspaceLocation;
}

/**
 * Resolve the GraphQL/API endpoint to use for workspace-scoped queries.
 *
 * Phase 02.3 UAT (2026-05-20, D-19) pinned that all post-workspace operations
 * (projects, scripts, future remote-script ops) MUST target the workspace's
 * own `DesWorkspaceInfo.location.apiServiceUrl` rather than the env-global
 * `altium365.graphqlEndpoint`. A workspace can live on a different cluster
 * than the env-global gateway, and the env-global endpoint will silently
 * return data for the wrong cluster (or error).
 *
 * Falls back to the env-global endpoint when a workspace either was loaded
 * before the schema bump or has no location.apiServiceUrl populated by the
 * server (defensive — should not happen with current servers).
 */
export function getWorkspaceApiUrl(
    ws: WorkspaceInfo | undefined,
    envGlobalEndpoint: string
): string {
    const ws_url = ws?.location?.apiServiceUrl?.trim();
    return ws_url && ws_url.length > 0 ? ws_url : envGlobalEndpoint;
}

/**
 * Resolve the Files Service base URL for a workspace-scoped REST call.
 *
 * Phase 3 (Plan 03-01) carries the D-19 per-workspace endpoint pattern from
 * GraphQL (`apiServiceUrl`) over to the Files Service tier. Unlike GraphQL
 * there is no env-global Files Service URL configured in `package.json`, so
 * the helper accepts an optional `fallback` argument — callers typically pass
 * `''`. If neither the workspace nor the fallback yields a usable URL the
 * helper throws an actionable error: the user's resolution is
 * `Altium 365: Refresh` on the side panel, which calls `listWorkspaces`
 * again and repopulates `filesServiceUrl`. We deliberately do NOT silently
 * fall back to the apiServiceUrl host (the two services live on distinct
 * hostnames) — silent misroute is worse than an explicit failure (Pitfall 3
 * / threat T-03-01-04).
 */
export function getWorkspaceFilesUrl(
    ws: WorkspaceInfo | undefined,
    fallback?: string
): string {
    const ws_url = ws?.location?.filesServiceUrl?.trim();
    if (ws_url && ws_url.length > 0) {
        return ws_url;
    }
    const fb = (fallback ?? '').trim();
    if (fb.length > 0) {
        return fb;
    }
    throw new Error(
        'Workspace filesServiceUrl unavailable — refresh the workspace list'
    );
}

/**
 * Typed GraphQL error surfaced by `graphqlRequest` when the response body
 * carries a non-empty `errors[]` array. Mirrors the OAuth-error mapping
 * pattern landed in `doSignIn` (commit `a00dcc0`) — D-11. The legacy
 * full-fidelity JSON blob is preserved as `rawErrors` so callers can append
 * it to OutputChannel for diagnosis without losing the readable message.
 */
export class GraphQLError extends Error {
    public readonly code: string | undefined;
    public readonly path: ReadonlyArray<string | number> | undefined;
    public readonly rawErrors: unknown[];

    constructor(
        message: string,
        opts: {
            code?: string;
            path?: ReadonlyArray<string | number>;
            rawErrors: unknown[];
        }
    ) {
        super(message);
        this.name = 'GraphQLError';
        this.code = opts.code;
        this.path = opts.path;
        this.rawErrors = opts.rawErrors;
    }
}

export async function graphqlRequest(
    endpoint: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>
): Promise<any> {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    let payload: any;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error(`GraphQL non-JSON response: ${text.slice(0, 500)}`);
    }
    if (payload.errors) {
        // D-11: typed throw so command-boundary handlers can map well-known
        // codes to friendly messages while still appending the full body to
        // OutputChannel via `err.rawErrors`. Transport-tier failures (HTTP /
        // non-JSON branches above) remain plain `Error`.
        const rawErrors = Array.isArray(payload.errors) ? payload.errors : [payload.errors];
        const first = (rawErrors[0] ?? {}) as {
            message?: string;
            path?: ReadonlyArray<string | number>;
            extensions?: { code?: string };
        };
        const code = first?.extensions?.code;
        const message =
            typeof first?.message === 'string' && first.message.length > 0
                ? first.message
                : 'GraphQL error';
        throw new GraphQLError(message, {
            code,
            path: first?.path,
            rawErrors,
        });
    }
    return payload.data;
}

export async function listWorkspaces(
    endpoint: string,
    accessToken: string
): Promise<WorkspaceInfo[]> {
    // Phase 3 (Plan 03-01) bumped this selection set to also pull
    // `filesServiceUrl` so per-workspace Files Service REST calls
    // (download/upload script bodies) can resolve a workspace-scoped base URL
    // — D-19 carry-over to the Files Service tier.
    const data = await graphqlRequest(
        endpoint,
        accessToken,
        'query { desWorkspaceInfos { name workspaceId authId url location { apiServiceUrl filesServiceUrl } } }'
    );
    return (data?.desWorkspaceInfos as WorkspaceInfo[]) || [];
}

export async function pickAndExchangeWorkspace(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    graphqlEndpoint: string
): Promise<string | undefined> {
    const baseToken = await getBaseAccessToken(context, cfg);
    if (!baseToken) {
        vscode.window.showErrorMessage('Sign in first (Altium 365: Sign In).');
        return undefined;
    }
    let workspaces: WorkspaceInfo[];
    try {
        workspaces = await listWorkspaces(graphqlEndpoint, baseToken);
    } catch (e) {
        vscode.window.showErrorMessage(`Failed to list workspaces: ${(e as Error).message}`);
        return undefined;
    }
    if (workspaces.length === 0) {
        vscode.window.showWarningMessage('No workspaces available for this account.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(
        workspaces.map((w) => ({
            label: w.name,
            description: w.workspaceId,
            detail: `authId: ${w.authId}`,
            ws: w,
        })),
        { placeHolder: 'Select Altium 365 workspace' }
    );
    if (!pick) {
        return undefined;
    }
    const tok = await ensureWorkspaceToken(context, cfg, {
        workspaceId: pick.ws.workspaceId,
        authId: pick.ws.authId,
    });
    await context.globalState.update('altium365.selectedWorkspace', pick.ws);
    return tok;
}

export function getSelectedWorkspace(
    context: vscode.ExtensionContext
): WorkspaceInfo | undefined {
    return context.globalState.get<WorkspaceInfo>('altium365.selectedWorkspace');
}

export interface ProjectInfo {
    id: string;
    name: string;
    url?: string;
}

export async function listProjects(
    endpoint: string,
    accessToken: string
): Promise<ProjectInfo[]> {
    const data = await graphqlRequest(
        endpoint,
        accessToken,
        'query { desProjects { nodes { id name url } } }'
    );
    const nodes = data?.desProjects?.nodes;
    return Array.isArray(nodes) ? (nodes as ProjectInfo[]) : [];
}

export interface ScriptInfo {
    scriptId: string;
    name: string;
    description?: string;
}

// TODO: paginate if hasNextPage (RESEARCH.md Assumption A3 — 100-item page is sufficient for v1)
const LIST_SCRIPTS_QUERY = `
    query ListScripts {
        gloScrScripts(first: 100) {
            nodes {
                scriptId
                name
                description
            }
        }
    }
`;

export async function listScripts(
    endpoint: string,
    workspaceToken: string
): Promise<ScriptInfo[]> {
    const data = await graphqlRequest(endpoint, workspaceToken, LIST_SCRIPTS_QUERY);
    const nodes = data?.gloScrScripts?.nodes;
    return Array.isArray(nodes) ? (nodes as ScriptInfo[]) : [];
}
