---
status: partial
phase: 02-side-panel
source: [02-VERIFICATION.md]
started: 2026-05-19T22:10:28Z
updated: 2026-05-19T22:10:28Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Activity Bar icon visible
expected: After installing the extension and reloading VS Code, the Altium 365 icon appears in the Activity Bar; clicking it opens a "Workspaces" panel.
result: [pending]

### 2. Signed-out welcome view
expected: With no active sign-in, the side panel shows the viewsWelcome content (Sign In button visible). Clicking Sign In runs `altium365.signIn` and the welcome content is replaced by the workspaces tree once `signedIn` context flips.
result: [pending]

### 3. Workspace expand populates projects + scripts
expected: Expanding a workspace node fires `Promise.all([listProjects, listScripts])` and renders projects (folder icon) and scripts (file-code icon) as **siblings**, sorted by name. No nesting of scripts under projects (PANEL-04 / D-05).
result: [pending]

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
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
