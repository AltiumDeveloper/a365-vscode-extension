import { collectAllPages, graphqlRequest } from './graphql';

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
//     connection (nodes + pageInfo) per
//     https://www.altium.com/documentation/altium-developer-center/altium-365/api/pagination.
//     We fetch the first page inline with each extension point, then follow
//     up in parallel for any extension point whose first page has more.
//
// Assignment type discrimination uses the `type` enum field
// (GloCusAssignmentType), not __typename.

export interface ExtensionPointInfo {
    extensionPointId: string;
    name: string;
    description?: string;
    entityType: string;  // e.g., "WORKSPACE", "PROJECT"
    type: string;        // e.g., "ON_RELEASE_CREATE"
    assignmentCount: number;  // Final count after all assignment pages fetched
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

// Standard Relay page size for the assignments connection. Assignments per
// extension point typically number in the single digits, so 10 fits the
// common case in a single round-trip while keeping per-page server cost low.
const ASSIGNMENTS_PAGE_SIZE = 10;

// Top-level query — `gloCusExtensionPoints` is a direct array (no pagination).
// The nested `assignments` field IS a connection — we request the first page
// inline and follow up below for any extension point that has more.
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

// Follow-up query for extension points whose first assignments page reports
// `hasNextPage: true`. Scoped to a single extension point so query cost is
// proportional to the actual tail length.
const LIST_ASSIGNMENTS_QUERY = `
    query ListAssignmentsForExtensionPoint($extensionPointId: String!, $first: Int!, $after: String) {
        gloCusExtensionPoint(extensionPointId: $extensionPointId) {
            assignments(first: $first, after: $after) {
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

async function listAssignmentTail(
    endpoint: string,
    workspaceToken: string,
    extensionPointId: string,
    firstPageEndCursor: string,
): Promise<AssignmentInfo[]> {
    // collectAllPages drives the loop forward; on the first invocation
    // `after` is null and we seed it with the cursor handed in from the
    // already-fetched inline first page. Subsequent invocations use the
    // server-returned endCursor as normal.
    let seeded = false;
    return collectAllPages<AssignmentInfo>(async (after) => {
        const cursor = !seeded ? firstPageEndCursor : after;
        seeded = true;
        const data = await graphqlRequest(endpoint, workspaceToken, LIST_ASSIGNMENTS_QUERY, {
            extensionPointId,
            first: ASSIGNMENTS_PAGE_SIZE,
            after: cursor,
        });
        const conn = data?.gloCusExtensionPoint?.assignments;
        const rawNodes: RawAssignment[] = Array.isArray(conn?.nodes) ? conn.nodes : [];
        const pageInfo = conn?.pageInfo ?? {};
        return {
            nodes: rawNodes.map(mapAssignment),
            endCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null,
            hasNextPage: pageInfo.hasNextPage === true,
        };
    });
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
    const firstPageByEp = new Map<string, AssignmentInfo[]>();
    const tailFetches: Array<Promise<{ extensionPointId: string; tail: AssignmentInfo[] }>> = [];

    for (const node of rawNodes as RawNode[]) {
        const firstPage = Array.isArray(node.assignments?.nodes)
            ? node.assignments!.nodes.map(mapAssignment)
            : [];
        firstPageByEp.set(node.extensionPointId, firstPage);

        // If the inline page has more, schedule a tail fetch in parallel.
        const aPageInfo = node.assignments?.pageInfo ?? {};
        if (aPageInfo.hasNextPage === true && typeof aPageInfo.endCursor === 'string') {
            tailFetches.push(
                listAssignmentTail(
                    endpoint,
                    workspaceToken,
                    node.extensionPointId,
                    aPageInfo.endCursor,
                ).then((tail) => ({ extensionPointId: node.extensionPointId, tail })),
            );
        }

        extensionPoints.push({
            extensionPointId: node.extensionPointId,
            name: node.name,
            description: node.description,
            entityType: node.entityType,
            type: node.type,
            // Provisional — recomputed below after tail fetches resolve.
            assignmentCount: firstPage.length,
        });
    }

    // Run all per-extension-point tail fetches in parallel, then assemble.
    const tailResults = await Promise.all(tailFetches);
    const tailByEp = new Map<string, AssignmentInfo[]>();
    for (const { extensionPointId, tail } of tailResults) {
        const existing = tailByEp.get(extensionPointId) ?? [];
        tailByEp.set(extensionPointId, [...existing, ...tail]);
    }

    const assignments = new Map<string, AssignmentInfo[]>();
    for (const ep of extensionPoints) {
        const first = firstPageByEp.get(ep.extensionPointId) ?? [];
        const tail = tailByEp.get(ep.extensionPointId) ?? [];
        const all = [...first, ...tail];
        if (all.length > 0) {
            assignments.set(ep.extensionPointId, all);
        }
        ep.assignmentCount = all.length;
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
