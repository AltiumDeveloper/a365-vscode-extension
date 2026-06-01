import { GraphQLError, graphqlRequest } from './graphql';

// =============================================================================
// Quick Task 260528-dhr+260528-dp1 — App Installation Check and Install Flow
// =============================================================================
//
// Prevent AUTH_NOT_AUTHENTICATED errors by checking if the extension app is
// installed in the workspace before making protected API calls. Only workspace
// admins can install apps — non-admins receive actionable escalation messages.

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
