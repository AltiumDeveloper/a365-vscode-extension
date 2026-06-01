import { graphqlRequest } from './graphql';

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
