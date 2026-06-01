// Barrel re-export — all workspace module symbols in one place so existing
// consumers (`import { ... } from '../workspace'`) require no changes.

export { GraphQLError, graphqlRequest } from './graphql';
export {
    type WorkspaceLocation,
    type WorkspaceInfo,
    getWorkspaceApiUrl,
    getWorkspaceFilesUrl,
    listWorkspaces,
    pickWorkspace,
    getSelectedWorkspace,
    resolveWorkspaceFromAuthId,
} from './workspaces';
export { type ProjectInfo, listProjects } from './projects';
export {
    type ScriptInfo,
    type ScriptDetail,
    listScripts,
    getScript,
    updateScript,
} from './scripts';
export {
    type ExtensionPointInfo,
    type AssignmentInfo,
    listExtensionPoints,
    updateAssignment,
} from './extensionPoints';
export {
    type ExecutionResult,
    type ExecutionLogPage,
    type ExecuteScriptInput,
    type ExecuteAssignmentInput,
    executeScript,
    executeAssignment,
    getExecutionResult,
    getExecutionLogs,
} from './execution';
export {
    type InstalledAppInfo,
    checkAppInstalled,
    installApp,
} from './apps';
