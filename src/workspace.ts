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

export interface WorkspaceInfo {
    name: string;
    workspaceId: string;
    authId: string;
    url?: string;
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
        throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
    }
    return payload.data;
}

export async function listWorkspaces(
    endpoint: string,
    accessToken: string
): Promise<WorkspaceInfo[]> {
    const data = await graphqlRequest(
        endpoint,
        accessToken,
        'query { desWorkspaceInfos { name workspaceId authId url } }'
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
    query ListScripts($first: Int = 100) {
        gloScrScripts(first: $first) {
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
    const data = await graphqlRequest(endpoint, workspaceToken, LIST_SCRIPTS_QUERY, { first: 100 });
    const nodes = data?.gloScrScripts?.nodes;
    return Array.isArray(nodes) ? (nodes as ScriptInfo[]) : [];
}
