import * as vscode from 'vscode';
import {
    getBaseAccessToken,
    type OAuthConfig,
    readOAuthConfig,
} from '../auth';
import { graphqlRequest } from './graphql';
import { getSelectedWorkspace } from './state';

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

// Phase 3 (Plan 03-01) bumped this selection set to also pull
// `filesServiceUrl` so per-workspace Files Service REST calls
// (download/upload script bodies) can resolve a workspace-scoped base URL
// — D-19 carry-over to the Files Service tier.
const LIST_WORKSPACES_QUERY =
    'query { desWorkspaceInfos { name workspaceId authId url location { apiServiceUrl filesServiceUrl } } }';

export async function listWorkspaces(
    endpoint: string,
    accessToken: string
): Promise<WorkspaceInfo[]> {
    const data = await graphqlRequest<{ desWorkspaceInfos?: unknown }>(
        endpoint,
        accessToken,
        LIST_WORKSPACES_QUERY
    );
    return (data?.desWorkspaceInfos as WorkspaceInfo[]) || [];
}

/**
 * Show a QuickPick of the user's workspaces and return the picked
 * `WorkspaceInfo` (or `undefined` if the user cancelled / no workspaces
 * available / sign-in missing).
 *
 * Plan 04-04 (D-14, D-16): this function previously performed
 * `ensureWorkspaceToken` + `globalState.update('altium365.selectedWorkspace')`
 * inline. Those side effects now live in
 * `applyWorkspaceSelection(context, workspace)` in `extension.ts` so the
 * tree-context-menu `altium365.workspace.selectFromNode` command can reuse
 * the exact same activation path without going through a QuickPick. This
 * helper is now a pure picker — no token exchange, no globalState write.
 *
 * Returns the picked `WorkspaceInfo` so callers can pass it to
 * `applyWorkspaceSelection`. `cfg` is no longer needed (the picker only
 * uses the base-token to list workspaces) but the parameter is retained to
 * preserve the call signature shape; callers may pass `readOAuthConfig()`.
 */
export async function pickWorkspace(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    graphqlEndpoint: string
): Promise<WorkspaceInfo | undefined> {
    void cfg;
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
            description: w.authId,
            ws: w,
        })),
        { placeHolder: 'Select Altium 365 workspace' }
    );
    return pick?.ws;
}

export async function resolveWorkspaceFromAuthId(
    context: vscode.ExtensionContext,
    authId: string,
    envGlobalEndpoint: string
): Promise<WorkspaceInfo | undefined> {
    // Fast path: check if selected workspace matches
    const selected = getSelectedWorkspace(context);
    if (selected && selected.authId === authId) {
        return selected;
    }

    // Slow path: fetch all workspaces and find by authId
    const baseToken = await getBaseAccessToken(context, readOAuthConfig());
    if (!baseToken) {
        return undefined;
    }

    try {
        const workspaces = await listWorkspaces(envGlobalEndpoint, baseToken);
        return workspaces.find(w => w.authId === authId);
    } catch {
        return undefined;
    }
}
