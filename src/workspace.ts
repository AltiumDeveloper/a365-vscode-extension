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

// =============================================================================
// Phase 10 — Plan 10-01: Extension Points and Assignments
// =============================================================================
//
// GraphQL schema verified against live A365 Dev environment (Task 1 checkpoint,
// 2026-05-28). Field names and nesting structure confirmed. Extension points
// query includes nested assignments via GraphQL connection pattern
// (assignments.nodes). Assignment type discrimination uses the `type` enum
// field (GloCusAssignmentType), not __typename.

export interface ExtensionPointInfo {
    extensionPointId: string;
    name: string;
    description?: string;
    entityType: string;  // e.g., "WORKSPACE", "PROJECT"
    type: string;        // e.g., "ON_RELEASE_CREATE"
    assignmentCount: number;  // Derived from assignments.nodes.length
}

export interface AssignmentInfo {
    assignmentId: string;
    name?: string;
    description?: string;
    type: 'DEFAULT' | 'SCRIPT' | 'WORKFLOW';  // GloCusAssignmentType enum (verified)
    active: boolean;
    scriptId?: string;         // Present only if type === 'SCRIPT'
    scriptVersionId?: string;  // Present only if type === 'SCRIPT'
    scriptFileToken?: string;  // Present only if type === 'SCRIPT'
    workflowId?: string;       // Present only if type === 'WORKFLOW' (assumed field name)
    createdAt: string;
    createdBy: string;
    lastModifiedAt: string;
    lastModifiedBy: string;
}

// Query fetches extension points with nested assignments in a single round-trip.
// Returns direct array (no connection wrapper) - verified against live API 2026-05-28
const LIST_EXTENSION_POINTS_QUERY = `
    query ListExtensionPoints {
        gloCusExtensionPoints {
            extensionPointId
            name
            description
            entityType
            type
            assignments {
                nodes {
                    assignmentId
                    name
                    description
                    type
                    active
                    ... on GloCusScriptAssignment {
                        scriptId
                        scriptVersionId
                        scriptFileToken
                    }
                }
            }
        }
    }
`;

export async function listExtensionPoints(
    endpoint: string,
    workspaceToken: string
): Promise<{ extensionPoints: ExtensionPointInfo[]; assignments: Map<string, AssignmentInfo[]> }> {
    const data = await graphqlRequest(endpoint, workspaceToken, LIST_EXTENSION_POINTS_QUERY);
    // gloCusExtensionPoints returns direct array, not { nodes: [...] } connection
    const nodes = data?.gloCusExtensionPoints;
    if (!Array.isArray(nodes)) {
        return { extensionPoints: [], assignments: new Map() };
    }

    const extensionPoints: ExtensionPointInfo[] = [];
    const assignments = new Map<string, AssignmentInfo[]>();

    for (const node of nodes) {
        const epId = node.extensionPointId;
        const assignmentNodes = node.assignments?.nodes;
        const assignmentList: AssignmentInfo[] = Array.isArray(assignmentNodes)
            ? assignmentNodes.map((a: any) => ({
                  assignmentId: a.assignmentId,
                  name: a.name,
                  description: a.description,
                  type: a.type,  // GloCusAssignmentType enum: DEFAULT | SCRIPT | WORKFLOW
                  active: a.active ?? false,
                  scriptId: a.scriptId,
                  scriptVersionId: a.scriptVersionId,
                  scriptFileToken: a.scriptFileToken,
                  workflowId: a.workflowId,  // May be undefined if not in schema
                  createdAt: a.createdAt,
                  createdBy: a.createdBy,
                  lastModifiedAt: a.lastModifiedAt,
                  lastModifiedBy: a.lastModifiedBy,
              }))
            : [];

        extensionPoints.push({
            extensionPointId: epId,
            name: node.name,
            description: node.description,
            entityType: node.entityType,
            type: node.type,
            assignmentCount: assignmentList.length,
        });

        if (assignmentList.length > 0) {
            assignments.set(epId, assignmentList);
        }
    }

    return { extensionPoints, assignments };
}

// =============================================================================
// Phase 3 — Plan 03-03: getScript + updateScript (open / publish round-trip)
// =============================================================================
//
// GraphQL shapes verified against
// `.planning/phases/03-remote-script-ops/schema-introspection.json`. RESEARCH
// §Code Examples documents the same selection sets (Pattern 1 — open/publish).
//
// Both helpers respect 02.3 D-19 by accepting an `endpoint` arg — callers
// resolve via `getWorkspaceApiUrl(ws, fallback)` so cross-cluster workspaces
// keep working. Tokens are workspace-scoped — callers obtain them via
// `ensureWorkspaceToken`. Errors surface as the typed `GraphQLError` from
// `graphqlRequest` so command-boundary handlers can map well-known codes
// (Plan 03-05 wraps these in user-friendly toasts).

export interface ScriptDetail {
    scriptId: string;
    name: string;
    description?: string;
    /** `package.fileToken` of `versions[0]` — opaque token to feed into
     *  `filesService.downloadByToken`. */
    latestFileToken: string;
    latestVersionId: string;
}

const GET_SCRIPT_QUERY = `
    query GetScriptSource($scriptId: String!) {
        gloScrScript(scriptId: $scriptId) {
            scriptId
            name
            description
            versions(first: 1, order: [{ timestamp: DESC }]) {
                nodes {
                    scriptVersionId
                    timestamp
                    comment
                    package { fileToken }
                }
            }
        }
    }
`;

export async function getScript(
    endpoint: string,
    workspaceToken: string,
    scriptId: string
): Promise<ScriptDetail> {
    const data = await graphqlRequest(endpoint, workspaceToken, GET_SCRIPT_QUERY, {
        scriptId,
    });
    const script = data?.gloScrScript;
    if (!script) {
        throw new Error('Script not found: ' + scriptId);
    }
    const node = script?.versions?.nodes?.[0];
    if (!node) {
        throw new Error('Script has no published versions: ' + scriptId);
    }
    const fileToken = node?.package?.fileToken;
    if (typeof fileToken !== 'string' || fileToken.length === 0) {
        throw new Error('Script latest version has no fileToken: ' + scriptId);
    }
    return {
        scriptId: script.scriptId,
        name: script.name,
        description: script.description,
        latestFileToken: fileToken,
        latestVersionId: node.scriptVersionId,
    };
}

const UPDATE_SCRIPT_MUTATION = `
    mutation UpdateScript($input: GloScrUpdateScriptInput!) {
        gloScrUpdateScript(input: $input) {
            gloScrScriptVersion {
                scriptVersionId
                timestamp
            }
        }
    }
`;

export async function updateScript(
    endpoint: string,
    workspaceToken: string,
    scriptId: string,
    fileToken: string,
    comment?: string
): Promise<{ scriptVersionId: string; timestamp: string }> {
    const input: Record<string, unknown> = {
        scriptId,
        package: { fileToken },
    };
    if (comment !== undefined) {
        input.comment = comment;
    }
    const data = await graphqlRequest(
        endpoint,
        workspaceToken,
        UPDATE_SCRIPT_MUTATION,
        { input }
    );
    const version = data?.gloScrUpdateScript?.gloScrScriptVersion;
    if (!version) {
        throw new Error('updateScript: unexpected empty response');
    }
    return {
        scriptVersionId: version.scriptVersionId,
        timestamp: version.timestamp,
    };
}

// =============================================================================
// Phase 10 — Extension Points: updateAssignment (auto-update on publish)
// =============================================================================
//
// GraphQL mutation verified against live A365 Dev environment. Updates an
// assignment to reference the latest published script version after a
// successful publish operation.

const UPDATE_ASSIGNMENT_MUTATION = `
    mutation UpdateAssignment($input: GloCusUpdateAssignmentInput!) {
        gloCusUpdateAssignment(input: $input) {
            assignmentId
        }
    }
`;

export async function updateAssignment(
    endpoint: string,
    workspaceToken: string,
    assignmentId: string,
    scriptId: string,
    scriptVersionId: string
): Promise<{ assignmentId: string }> {
    const input = {
        script: {
            assignmentId,
            scriptId,
            scriptVersionId,
        },
    };
    const data = await graphqlRequest(
        endpoint,
        workspaceToken,
        UPDATE_ASSIGNMENT_MUTATION,
        { input }
    );
    const result = data?.gloCusUpdateAssignment;
    if (!result?.assignmentId) {
        throw new Error('updateAssignment: unexpected empty response');
    }
    return {
        assignmentId: result.assignmentId,
    };
}

// =============================================================================
// Phase 10 — Extension Points: executeAssignment (trigger extension points)
// =============================================================================
//
// Execute an assignment via gloCusExecuteAssignment mutation. This is the
// correct way to trigger extension points. The mutation returns a scriptExecutionId
// (same as gloScrExecuteScript) so we can use the same polling/logging infrastructure.

export interface ExecuteAssignmentInput {
    assignmentId: string;
    parameters?: Array<{ key: string; value: string }>;
}

const EXECUTE_ASSIGNMENT_MUTATION = `
    mutation ExecuteAssignment($input: GloCusExecuteAssignmentInput!) {
        gloCusExecuteAssignment(input: $input) {
            scriptExecutionId
        }
    }
`;

export async function executeAssignment(
    endpoint: string,
    workspaceToken: string,
    input: ExecuteAssignmentInput
): Promise<{ scriptExecutionId: string; status: string }> {
    // Transform parameters from { key, value } to { name, value } for assignment API
    const transformedInput = {
        assignmentId: input.assignmentId,
        parameters: input.parameters?.map(p => ({
            name: p.key,
            value: p.value,
        })),
    };
    
    const data = await graphqlRequest(
        endpoint,
        workspaceToken,
        EXECUTE_ASSIGNMENT_MUTATION,
        { input: transformedInput }
    );
    const exec = data?.gloCusExecuteAssignment;
    if (!exec || !exec.scriptExecutionId) {
        throw new Error('executeAssignment: unexpected empty response');
    }
    return {
        scriptExecutionId: exec.scriptExecutionId,
        status: 'Pending',  // Default status since mutation doesn't return it
    };
}

// =============================================================================
// Phase 3 — Plan 03-04: executeScript + getExecutionResult + getExecutionLogs
// =============================================================================
//
// GraphQL shapes verified against
// `.planning/phases/03-remote-script-ops/schema-introspection.json`. RESEARCH
// §Pattern 2 documents the same selection sets (async execute + poll-driven
// log streaming).
//
// Status + logs are split into two queries (rather than the single combined
// query in RESEARCH §Pattern 2) so the two responses can be sized
// independently and a malformed log-page can't poison the status read. Both
// run in parallel each tick via `Promise.all` in `remoteExecution.ts`.

export interface ExecutionResult {
    scriptExecutionId: string;
    /** Server returns `String!` — see RESEARCH §Pitfall 5. Curated terminal
     *  set lives in `remoteExecution.ts`. */
    status: string;
    exitCode: number | null;
    startedAt: string | null;
    completedAt: string | null;
    failureReason: string | null;
}

export interface ExecutionLogPage {
    logs: string[];
    /** `String!` per schema; empty string when no more pages are available. */
    nextToken: string;
}

export interface ExecuteScriptInput {
    scriptId: string;
    /** Optional — omit to use the latest published version. */
    scriptVersionId?: string;
    parameters?: Array<{ key: string; value: string }>;
}

const EXECUTE_SCRIPT_MUTATION = `
    mutation ExecuteScript($input: GloScrExecuteScriptInput!) {
        gloScrExecuteScript(input: $input) {
            gloScrScriptExecution {
                scriptExecutionId
                status
            }
        }
    }
`;

export async function executeScript(
    endpoint: string,
    workspaceToken: string,
    input: ExecuteScriptInput
): Promise<{ scriptExecutionId: string; status: string }> {
    const data = await graphqlRequest(
        endpoint,
        workspaceToken,
        EXECUTE_SCRIPT_MUTATION,
        { input }
    );
    const exec = data?.gloScrExecuteScript?.gloScrScriptExecution;
    if (!exec) {
        throw new Error('executeScript: unexpected empty response');
    }
    return {
        scriptExecutionId: exec.scriptExecutionId,
        status: exec.status,
    };
}

const GET_EXEC_RESULT_QUERY = `
    query GetExecResult($id: String!) {
        gloScrScriptExecutionResult(scriptExecutionId: $id) {
            scriptExecutionId
            status
            failureReason
            createdAt
            updatedAt
            executionResult {
                exitCode
            }
        }
    }
`;

export async function getExecutionResult(
    endpoint: string,
    workspaceToken: string,
    scriptExecutionId: string
): Promise<ExecutionResult> {
    const data = await graphqlRequest(
        endpoint,
        workspaceToken,
        GET_EXEC_RESULT_QUERY,
        { id: scriptExecutionId }
    );
    const r = data?.gloScrScriptExecutionResult;
    if (!r) {
        throw new Error(
            'getExecutionResult: execution not found: ' + scriptExecutionId
        );
    }
    // Schema gotcha: Query.gloScrScriptExecutionResult returns the umbrella
    // GloScrScriptExecution type, NOT GloScrScriptExecutionResult. The
    // exitCode lives nested under .executionResult (which is non-null per
    // schema but may carry a placeholder value before completion).
    // Schema also has no startedAt/completedAt — only createdAt/updatedAt.
    return {
        scriptExecutionId: r.scriptExecutionId,
        status: r.status,
        exitCode: r.executionResult?.exitCode ?? null,
        startedAt: r.createdAt ?? null,
        completedAt: r.updatedAt ?? null,
        failureReason: r.failureReason ?? null,
    };
}

const GET_EXEC_LOGS_QUERY = `
    query GetExecLogs($id: String!, $limit: Int!, $nextToken: String) {
        gloScrScriptExecutionResult(scriptExecutionId: $id) {
            logs(limit: $limit, nextToken: $nextToken) {
                logs
                nextToken
            }
        }
    }
`;

export async function getExecutionLogs(
    endpoint: string,
    workspaceToken: string,
    scriptExecutionId: string,
    limit: number,
    nextToken: string | null
): Promise<ExecutionLogPage> {
    const data = await graphqlRequest(
        endpoint,
        workspaceToken,
        GET_EXEC_LOGS_QUERY,
        { id: scriptExecutionId, limit, nextToken }
    );
    const page = data?.gloScrScriptExecutionResult?.logs;
    if (!page) {
        // Defensive — never throw mid-poll on log fetch (Pitfall 5).
        return { logs: [], nextToken: '' };
    }
    const logs = Array.isArray(page.logs) ? (page.logs as string[]) : [];
    const nt =
        typeof page.nextToken === 'string' ? (page.nextToken as string) : '';
    return { logs, nextToken: nt };
}

// =============================================================================
// Quick Task 260528-dhr+260528-dp1 — App Installation Check and Install Flow
// =============================================================================
//
// Prevent AUTH_NOT_AUTHENTICATED errors by checking if the extension app is
// installed in the workspace before making protected API calls. Only workspace
// admins can install apps — non-admins receive actionable escalation messages.
//
// Integration pattern for command handlers:
//   const cfg = vscode.workspace.getConfiguration('altium365');
//   const activeEnvName = cfg.get<string>('activeEnvironment') || '';
//   const envs = cfg.get<Record<string, EnvironmentSpec>>('environments') || {};
//   const activeEnv = envs[activeEnvName];
//   const appId = activeEnv?.appId;
//   if (!appId) {
//     vscode.window.showErrorMessage('Active environment missing appId. Switch environment to refresh.');
//     return;
//   }
//   const installed = await checkAppInstalled(endpoint, workspaceToken, appId);
//   if (!installed) {
//     const choice = await vscode.window.showInformationMessage(
//       'Extension app not installed in workspace. Install now?', 'Install Now'
//     );
//     if (choice === 'Install Now') {
//       await installApp(endpoint, workspaceToken, appId);
//       vscode.window.showInformationMessage('Extension app installed successfully.');
//     }
//   }

export interface InstalledAppInfo {
    id: string;
    name: string;
}

const CHECK_APP_INSTALLED_QUERY = `
    query CheckAppInstalled {
        gloAppInstalledApps {
            id
            name
        }
    }
`;

/**
 * Check if the Altium Developer extension app is installed in the workspace.
 *
 * Queries `gloAppInstalledApps` and returns true if the installed apps include
 * the provided app GRID. This check should be performed before making
 * workspace-scoped GraphQL calls that require app installation to avoid
 * AUTH_NOT_AUTHENTICATED errors.
 *
 * @param endpoint - The GraphQL API endpoint URL
 * @param workspaceToken - Workspace-scoped access token
 * @param appId - App GRID to check (obtain from active environment config)
 * @returns True if the extension app is installed, false otherwise
 */
export async function checkAppInstalled(
    endpoint: string,
    workspaceToken: string,
    appId: string
): Promise<boolean> {
    const data = await graphqlRequest(endpoint, workspaceToken, CHECK_APP_INSTALLED_QUERY);
    const apps = data?.gloAppInstalledApps;
    if (!Array.isArray(apps)) {
        return false;
    }
    const installedAppIds = new Set(apps.map((app: InstalledAppInfo) => app.id));
    return installedAppIds.has(appId);
}

const INSTALL_APP_MUTATION = `
    mutation InstallApp($input: GloInstallAppInput!) {
        gloInstallApp(input: $input) {
            gloApp {
                id
            }
        }
    }
`;

/**
 * Install the extension app in the workspace.
 *
 * IMPORTANT: This function should ONLY be called after explicit user consent
 * via a UI prompt (e.g., vscode.window.showInformationMessage with action
 * buttons). Only workspace administrators have permission to install apps.
 * Non-admin users will receive a clear error message instructing them to
 * contact their workspace admin.
 *
 * @param endpoint - The GraphQL API endpoint URL
 * @param workspaceToken - Workspace-scoped access token
 * @param appId - The app GRID to install (obtain from active environment config)
 * @returns The installed app GRID
 * @throws GraphQLError with admin escalation message on permission errors
 */
export async function installApp(
    endpoint: string,
    workspaceToken: string,
    appId: string
): Promise<string> {
    try {
        const data = await graphqlRequest(
            endpoint,
            workspaceToken,
            INSTALL_APP_MUTATION,
            { input: { id: appId } }
        );
        const installedApp = data?.gloInstallApp?.gloApp;
        if (!installedApp?.id) {
            throw new Error('installApp: unexpected empty response');
        }
        return installedApp.id;
    } catch (err) {
        // Map permission-related GraphQL errors to actionable admin escalation message
        if (err instanceof GraphQLError) {
            const code = err.code?.toUpperCase();
            if (
                code === 'AUTH_FORBIDDEN' ||
                code === 'PERMISSION_DENIED' ||
                code === 'FORBIDDEN' ||
                code === 'UNAUTHORIZED'
            ) {
                throw new Error(
                    'Only workspace administrators can install apps. Contact your workspace admin to install the Altium Developer extension app.'
                );
            }
        }
        // Re-throw other errors (network, GraphQL schema issues, etc.)
        throw err;
    }
}
