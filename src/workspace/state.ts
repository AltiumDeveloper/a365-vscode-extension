import type * as vscode from 'vscode';
import type { WorkspaceInfo } from './workspaces';

// ── Constants ────────────────────────────────────────────────────────────────

/** Single source of truth for the selected-workspace globalState key. */
export const SELECTED_WORKSPACE_KEY = 'altium365.selectedWorkspace';

// ── Typed accessors ──────────────────────────────────────────────────────────

/** Return the currently selected workspace, or undefined if none is selected. */
export function getSelectedWorkspace(
    context: vscode.ExtensionContext
): WorkspaceInfo | undefined {
    return context.globalState.get<WorkspaceInfo>(SELECTED_WORKSPACE_KEY);
}

/** Persist a workspace selection to globalState. */
export function setSelectedWorkspace(
    context: vscode.ExtensionContext,
    workspace: WorkspaceInfo
): Thenable<void> {
    return context.globalState.update(SELECTED_WORKSPACE_KEY, workspace);
}

/** Clear the workspace selection from globalState (e.g. on sign-out or env switch). */
export function clearSelectedWorkspace(
    context: vscode.ExtensionContext
): Thenable<void> {
    return context.globalState.update(SELECTED_WORKSPACE_KEY, undefined);
}
