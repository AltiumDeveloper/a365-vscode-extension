import { graphqlRequest } from './graphql';

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
