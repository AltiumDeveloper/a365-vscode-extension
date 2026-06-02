import { graphqlRequest } from './graphql';

// =============================================================================
// Phase 10 — Plan 10-01: Extension Points and Assignments
// =============================================================================
//
// GraphQL schema verified against live A365 Dev environment (Task 1 checkpoint,
// 2026-05-28). Field names and nesting structure confirmed.
//
// Pagination shape (corrected 2026-06-02):
//   - `gloCusExtensionPoints` returns a DIRECT ARRAY — NOT a Relay connection.
//     There is no pageInfo / nodes wrapper at this level and no $first/$after
//     arguments; the whole list is returned in one round-trip.
//   - The nested `assignments` field on each extension point IS a Relay
//     connection (nodes + pageInfo), but there is NO single-extension-point
//     query in the schema — only the batch `gloCusExtensionPoints` exists —
//     so we cannot fetch tail pages independently. Pragmatic fix: request
//     `first: 100` inline, which covers the expected real-world maximum.
//     If this ever truncates, the server will need to expose a per-EP query
//     (or a way to page the batch query itself) before we can do better.
//
// Assignment type discrimination uses the `type` enum field
// (GloCusAssignmentType), not __typename.

export interface ExtensionPointInfo {
    extensionPointId: string;
    name: string;
    description?: string;
    entityType: string;  // e.g., "WORKSPACE", "PROJECT"
    type: string;        // e.g., "ON_RELEASE_CREATE"
    assignmentCount: number;
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

// Cap for the inline assignments page. The schema exposes no single-EP query,
// so this is the only page we can fetch — set high enough to cover the
// realistic maximum number of assignments per extension point.
const ASSIGNMENTS_PAGE_SIZE = 100;

const LIST_EXTENSION_POINTS_QUERY = `
    query ListExtensionPoints($assignmentsFirst: Int!) {
        gloCusExtensionPoints {
            extensionPointId
            name
            description
            entityType
            type
            assignments(first: $assignmentsFirst) {
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
                pageInfo { hasNextPage endCursor }
            }
        }
    }
`;

interface RawAssignment {
    assignmentId: string;
    name?: string;
    description?: string;
    type: AssignmentInfo['type'];
    active?: boolean;
    scriptId?: string;
    scriptVersionId?: string;
    scriptFileToken?: string;
    workflowId?: string;
    createdAt: string;
    createdBy: string;
    lastModifiedAt: string;
    lastModifiedBy: string;
}

function mapAssignment(a: RawAssignment): AssignmentInfo {
    return {
        assignmentId: a.assignmentId,
        name: a.name,
        description: a.description,
        type: a.type,
        active: a.active ?? false,
        scriptId: a.scriptId,
        scriptVersionId: a.scriptVersionId,
        scriptFileToken: a.scriptFileToken,
        workflowId: a.workflowId,
        createdAt: a.createdAt,
        createdBy: a.createdBy,
        lastModifiedAt: a.lastModifiedAt,
        lastModifiedBy: a.lastModifiedBy,
    };
}

export async function listExtensionPoints(
    endpoint: string,
    workspaceToken: string
): Promise<{ extensionPoints: ExtensionPointInfo[]; assignments: Map<string, AssignmentInfo[]> }> {
    const data = await graphqlRequest(endpoint, workspaceToken, LIST_EXTENSION_POINTS_QUERY, {
        assignmentsFirst: ASSIGNMENTS_PAGE_SIZE,
    });
    // `gloCusExtensionPoints` is a direct array — verified against live API
    // 2026-05-28 (re-confirmed 2026-06-02). No connection wrapper.
    const rawNodes = data?.gloCusExtensionPoints;
    if (!Array.isArray(rawNodes)) {
        return { extensionPoints: [], assignments: new Map() };
    }

    type RawNode = {
        extensionPointId: string;
        name: string;
        description?: string;
        entityType: string;
        type: string;
        assignments?: {
            nodes?: RawAssignment[];
            pageInfo?: { hasNextPage?: boolean; endCursor?: string };
        };
    };

    const extensionPoints: ExtensionPointInfo[] = [];
    const assignments = new Map<string, AssignmentInfo[]>();

    for (const node of rawNodes as RawNode[]) {
        const mapped = Array.isArray(node.assignments?.nodes)
            ? node.assignments!.nodes.map(mapAssignment)
            : [];
        if (mapped.length > 0) {
            assignments.set(node.extensionPointId, mapped);
        }
        extensionPoints.push({
            extensionPointId: node.extensionPointId,
            name: node.name,
            description: node.description,
            entityType: node.entityType,
            type: node.type,
            assignmentCount: mapped.length,
        });
    }

    return { extensionPoints, assignments };
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
