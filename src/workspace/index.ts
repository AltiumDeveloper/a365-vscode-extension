// Barrel re-export — all workspace module symbols in one place so existing
// consumers (`import { ... } from '../workspace'`) require no changes.

export { GraphQLError, collectAllPages, graphqlRequest, type ConnectionPage } from './graphql';
export {
    type WorkspaceLocation,
    type WorkspaceInfo,
    getWorkspaceApiUrl,
    getWorkspaceFilesUrl,
    listWorkspaces,
    pickWorkspace,
    resolveWorkspaceFromAuthId,
} from './workspaces';
export {
    getSelectedWorkspace,
    setSelectedWorkspace,
    clearSelectedWorkspace,
} from './state';
export { type ProjectInfo, listProjects } from './projects';
export {
    type ScriptInfo,
    type ScriptDetail,
    listScripts,
    getScript,
    updateScript,
    createScript,
} from './scripts';
export {
    type ExtensionPointInfo,
    type ExtensionPointParameterInfo,
    type AssignmentInfo,
    listExtensionPoints,
    updateAssignment,
    addAssignment,
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
