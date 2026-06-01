import { graphqlRequest } from './graphql';

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
