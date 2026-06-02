import { collectAllPages, graphqlRequest } from './graphql';

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

// Standard page size for Relay-cursor paginated listings — see
// https://www.altium.com/documentation/altium-developer-center/altium-365/api/pagination.
// Matches the project listing page size; assignments per extension point
// typically number in the single digits, so 10 is comfortable.
const EXTENSION_POINTS_PAGE_SIZE = 10;
const ASSIGNMENTS_PAGE_SIZE = 10;

// `gloCusExtensionPoints` returns a Relay connection (nodes + pageInfo);
// the inline assignments selection is itself paginated and is followed up
// per-extension-point below when `hasNextPage` is true on the first batch.
const LIST_EXTENSION_POINTS_QUERY = `
    query ListExtensionPoints($first: Int!, $after: String, $assignmentsFirst: Int!) {
        gloCusExtensionPoints(first: $first, after: $after) {
            nodes {
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
            pageInfo { hasNextPage endCursor }
        }
    }
`;

// Follow-up query for extension points whose first assignments page reports
// `hasNextPage: true`. Scoped to a single extension point to keep query cost
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
    return collectAllPages<AssignmentInfo>(async (after) => {
        const cursor = after ?? firstPageEndCursor;
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
    // Per-call state — closures below capture these so concurrent
    // `listExtensionPoints` calls cannot collide on shared mutable maps.
    const firstPageByEp = new Map<string, AssignmentInfo[]>();
    const tailFetches: Array<Promise<{ extensionPointId: string; tail: AssignmentInfo[] }>> = [];

    const extensionPoints = await collectAllPages<ExtensionPointInfo>(async (after) => {
        const data = await graphqlRequest(endpoint, workspaceToken, LIST_EXTENSION_POINTS_QUERY, {
            first: EXTENSION_POINTS_PAGE_SIZE,
            after,
            assignmentsFirst: ASSIGNMENTS_PAGE_SIZE,
        });
        const conn = data?.gloCusExtensionPoints;
        const rawNodes: Array<{
            extensionPointId: string;
            name: string;
            description?: string;
            entityType: string;
            type: string;
            assignments?: {
                nodes?: RawAssignment[];
                pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            };
        }> = Array.isArray(conn?.nodes) ? conn.nodes : [];

        const eps: ExtensionPointInfo[] = [];
        for (const node of rawNodes) {
            const firstPage = Array.isArray(node.assignments?.nodes)
                ? node.assignments!.nodes.map(mapAssignment)
                : [];
            // Inline first page is already on the wire — record it.
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

            eps.push({
                extensionPointId: node.extensionPointId,
                name: node.name,
                description: node.description,
                entityType: node.entityType,
                type: node.type,
                // Provisional — recomputed below after tail fetches resolve.
                assignmentCount: firstPage.length,
            });
        }

        const pageInfo = conn?.pageInfo ?? {};
        return {
            nodes: eps,
            endCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null,
            hasNextPage: pageInfo.hasNextPage === true,
        };
    });

    // Assemble the final assignments map: first-page + tail-page entries.
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
        // Fix up the provisional count now that tail pages have arrived.
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
