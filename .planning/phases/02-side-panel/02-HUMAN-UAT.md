---
status: diagnosed
phase: 02-side-panel
source: [02-VERIFICATION.md]
started: 2026-05-19T22:10:28Z
updated: 2026-05-19T22:30:00Z
---

## Current Test

complete — 5 gaps recorded for Phase 02.1 closure

## Tests

### 1. Activity Bar icon visible
expected: After installing the extension and reloading VS Code, the Altium 365 icon appears in the Activity Bar; clicking it opens a "Workspaces" panel.
result: [pending]

### 2. Signed-out welcome view
expected: With no active sign-in, the side panel shows the viewsWelcome content (Sign In button visible). Clicking Sign In runs `altium365.signIn` and the welcome content is replaced by the workspaces tree once `signedIn` context flips.
result: [pending]

### 3. Workspace expand populates projects + scripts
expected: Expanding a workspace node fires `Promise.all([listProjects, listScripts])` and renders projects (folder icon) and scripts (file-code icon) as **siblings**, sorted by name. No nesting of scripts under projects (PANEL-04 / D-05).
result: issue — user wants projects under a "Projects" parent node and scripts under a "Scripts" parent node, not as flat siblings. See Gaps G-01.

### 4. Right-click context menu on a script node
expected: Right-clicking a script row surfaces exactly four actions: "Run Script (Local)", "Execute Remotely", "Edit Script", "Publish Script". Each shows a "coming in Phase 3" information toast (Phase 2 placeholders for D-03 + the BLOCKED D-09 runLocal).
result: [pending]

### 5. Status bar shows user + environment
expected: After sign-in, the VS Code status bar (right-aligned) shows `$(account) A365: <user> • <env>` (e.g., `A365: alice@example.com • Production`). The text updates immediately when environment is switched.
result: [pending]

### 6. Status-bar click QuickPick
expected: Clicking the status bar item opens a QuickPick with three choices: Sign Out, Switch Environment, Switch Workspace. Each delegates to the corresponding existing command and produces the expected effect.
result: [pending]

### 7. Failure path — inline error tree item + retry
expected: Forcing a workspace/projects/scripts fetch error (e.g., expired token, network drop) renders an inline error TreeItem at the failure point (not a popup). Clicking it triggers `altium365.tree.retry` which re-fetches successfully once the underlying error is cleared (D-07).
result: [pending]

## Summary

total: 7
passed: 0
issues: 5
pending: 6
skipped: 0
blocked: 0

## Gaps

### G-01: Group projects and scripts under category parent nodes
status: failed
source_test: 3
description: Currently projects and scripts render as flat siblings of the workspace node. User wants them grouped under "Projects" and "Scripts" parent nodes (i.e., workspace → Projects (n) → individual projects, workspace → Scripts (n) → individual scripts). This reverses the original D-05 / PANEL-04 sibling decision based on real-usage feedback.
affected: src/sidePanel.ts (TreeDataProvider hierarchy), 02-CONTEXT.md (D-05 reversal), REQUIREMENTS.md (PANEL-04 clarification)

### G-02: Drop GUIDs from tree node labels; add "Copy ID" context menu
status: failed
source_test: visual review
description: Node labels currently include backend GUIDs which add visual noise. Drop GUIDs from the display label and instead expose them via a "Copy ID" (or similar) context menu item available on workspace/project/script nodes. ID still useful — just not in the primary label.
affected: src/sidePanel.ts (label rendering), src/scriptCommands.ts or new commands module (Copy ID handler), package.json (new command + view/item/context entry)

### G-03: Visual indicator for active workspace
status: failed
source_test: visual review
description: When multiple workspaces are visible, the user cannot tell which one is the currently active workspace (the one whose token is exchanged and whose projects/scripts are being browsed). Suggested: distinct icon variant for the active workspace (e.g., `cloud` for active vs `cloud-outline`, or `cloud` + a dot/badge). The active workspace concept already exists in the auth/workspace state — surface it visually in the tree.
affected: src/sidePanel.ts (TreeItem icon selection), src/auth.ts or src/workspace.ts (expose active-workspace id)

### G-04: "Switch Environment" action in panel view title
status: failed
source_test: 6 (indirectly)
description: Currently the only way to switch environments from the tree side is via the status-bar QuickPick. Add a globe-icon action to the A365 view title bar that triggers the existing `altium365.switchEnvironment` command. Status-bar QuickPick stays as-is.
affected: package.json (contributes.menus["view/title"] entry, `when: view == altium365.workspaces && altium365.signedIn`), no new command needed (reuse existing handler)

### G-05: "Open in Browser" context menu for workspaces and projects
status: failed
source_test: 4 (incomplete coverage)
description: Workspaces and projects expose a `url` field (`DesWorkspaceInfo.url`, `DesProject.url`) on their GraphQL types. Add an "Open in Browser" context menu item that calls `vscode.env.openExternal(vscode.Uri.parse(url))`. Two new commands: `altium365.workspace.openInBrowser` and `altium365.project.openInBrowser`, scoped via `when: viewItem == workspaceNode` and `when: viewItem == projectNode`.
affected: src/workspace.ts (extend `WorkspaceInfo` + `ProjectInfo` types and queries to include `url`), src/sidePanel.ts (carry `url` in the TreeNode), new command handlers (could live in src/scriptCommands.ts or a new src/treeCommands.ts), package.json (2 new commands + 2 view/item/context entries)
