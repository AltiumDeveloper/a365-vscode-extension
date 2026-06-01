import { graphqlRequest } from './graphql';

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
