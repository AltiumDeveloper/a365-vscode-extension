import { collectAllPages, graphqlRequest } from './graphql';

export interface ProjectInfo {
    id: string;
    name: string;
    url?: string;
}

const LIST_PROJECTS_PAGE_SIZE = 100;

const LIST_PROJECTS_QUERY = `
    query ListProjects($first: Int!, $after: String) {
        desProjects(first: $first, after: $after) {
            nodes { id name url }
            pageInfo { hasNextPage endCursor }
        }
    }
`;

/**
 * List all projects in the workspace, transparently following the
 * Relay-cursor pagination contract documented at
 * https://www.altium.com/documentation/altium-developer-center/altium-365/api/pagination.
 *
 * Workspaces with more than `LIST_PROJECTS_PAGE_SIZE` projects previously
 * had their tail silently truncated — callers (sidebar tree, project
 * picker for test events) saw only the first page.
 */
export async function listProjects(
    endpoint: string,
    accessToken: string
): Promise<ProjectInfo[]> {
    return collectAllPages<ProjectInfo>(async (after) => {
        const data = await graphqlRequest(endpoint, accessToken, LIST_PROJECTS_QUERY, {
            first: LIST_PROJECTS_PAGE_SIZE,
            after,
        });
        const conn = data?.desProjects;
        const nodes = Array.isArray(conn?.nodes) ? (conn.nodes as ProjectInfo[]) : [];
        const pageInfo = conn?.pageInfo ?? {};
        return {
            nodes,
            endCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null,
            hasNextPage: pageInfo.hasNextPage === true,
        };
    });
}
