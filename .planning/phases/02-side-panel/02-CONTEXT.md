# Phase 2: Side Panel - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a dedicated Altium 365 Activity Bar view that surfaces the authenticated user's workspaces → projects → scripts hierarchy as a `TreeDataProvider`, with a status bar indicator for active user/environment and a right-click context menu on script nodes that wires up local execution. Remote script edit/execute/publish actions are registered (Phase 3 takes over their handlers) but the only fully wired action in Phase 2 is "Run Script (local)". No remote script CRUD logic ships in this phase.

</domain>

<decisions>
## Implementation Decisions

### Tree Structure & Loading
- **D-01:** Root nodes = all workspaces returned by `listWorkspaces()` for the active account. Workspace token is exchanged lazily on first expand via `exchangeWorkspaceToken()`, and the per-workspace token is cached in `context.secrets` (keyed by workspace id) so subsequent expansions skip the round-trip.
- **D-02:** Workspaces load eagerly on view open; projects + scripts load lazily on expansion. Cache is in-memory for the session only — no disk persistence beyond the existing secrets store.
- **D-03:** Manual refresh exposed as a title-bar icon on the tree view; clicking it clears the in-memory cache and re-fetches the currently visible level.

### Status Bar & Auth Surfacing
- **D-04:** A VS Code status bar item displays `A365: <user> • <env>` whenever signed in. Clicking it opens a `QuickPick` with: Sign Out, Switch Environment, Switch Workspace.

### Signed-Out & Empty States
- **D-05:** When no user is signed in, the side panel renders a `viewsWelcome` block with a "Sign In" button that runs `altium365.signIn`.
- **D-06:** When the signed-in account has zero workspaces, render a single informational tree item ("No workspaces available for this account").
- **D-07:** On network/auth failure during a fetch, render an inline error tree item that re-runs the failed fetch when clicked; full error detail goes to `outputChannel`. No toast notification.

### Context Menu Actions
- **D-08:** Register all four script actions in `package.json` `contributes.commands` + `menus.view/item/context` now:
  - `altium365.script.runLocal` — fully implemented in Phase 2
  - `altium365.script.edit` — Phase 2 handler shows "Coming in Phase 3" info message
  - `altium365.script.executeRemote` — Phase 2 handler shows "Coming in Phase 3" info message
  - `altium365.script.publish` — Phase 2 handler shows "Coming in Phase 3" info message
  Phase 3 swaps the three placeholder handlers without touching `package.json`.
- **D-09:** "Run Script (local)" flow: fetch the script body via the `gloScrScripts` GraphQL query (content/body field), write it to `os.tmpdir()` as a `.py` file, invoke the existing `python/_runner.py` subprocess pipeline the local-run command already uses, and clean up the temp file when execution completes.

### Agent's Discretion
- Exact `viewsContainer` icon (must be a Codicon or contributed SVG that visually pairs with the existing `resources/icon.png`).
- TreeItem context value strings used to gate the context menu (`workspaceNode`, `projectNode`, `scriptNode` is a reasonable starting convention).
- Whether to fetch scripts via the project-scoped query path or a dedicated scripts query — planner should confirm against the actual GraphQL schema during research.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Requirements
- `.planning/REQUIREMENTS.md` §Side Panel — PANEL-01 through PANEL-06 and SCRIPT-01 are the acceptance criteria for this phase
- `.planning/ROADMAP.md` §Phase 2 — Success criteria define what "done" looks like

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — extension activation flow, command surface, where the new view fits
- `.planning/codebase/STACK.md` — confirms VS Code Extension API ≥1.85.0, TypeScript 5.4+, no bundler
- `.planning/codebase/CONVENTIONS.md` — `altium365.` command prefix, async/await, `vscode.window.showErrorMessage` at command boundaries, `graphqlRequest` reuse
- `.planning/codebase/STRUCTURE.md` — module layout
- `.planning/codebase/CONCERNS.md` — security constraints (tokens in `context.secrets`, tmp files in `os.tmpdir()`)

### Source Files
- `src/extension.ts` — `activate()` and existing 6 command registrations; new view + status bar item + 4 script commands are added here
- `src/workspace.ts` — reuse `graphqlRequest()`, `listWorkspaces()`, `listProjects()`, `getActiveAccessToken()`, `exchangeWorkspaceToken()`; add `listScripts()` for SCRIPT-01
- `src/auth.ts` — token storage helpers; status bar needs an "active user" accessor
- `package.json` `contributes` — add `viewsContainers`, `views`, `viewsWelcome`, `commands`, `menus.view/item/context`, `menus.view/title`

### Phase 1 Carry-Forward (not Phase 2 scope, tracked)
- `.planning/phases/01-packaging/01-REVIEW.md` — HIGH-01 (missing `LICENSE` + `license` field in `package.json`, blocks Marketplace publish) and MEDIUM ci.yml hardening items still open
- `.planning/phases/01-packaging/01-HUMAN-UAT.md` — items 2-4 (VSIX install, icon aesthetic, README usability) still pending human sign-off

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `listWorkspaces(accessToken)` and `listProjects(workspaceToken, workspaceUrl)` already exist in `src/workspace.ts` — directly drive the workspace and project tree levels
- `graphqlRequest(endpoint, token, query, variables)` in `src/workspace.ts` — the canonical GraphQL helper, reuse for the new `gloScrScripts` query
- `getActiveAccessToken()` and `exchangeWorkspaceToken()` in `src/auth.ts` — supply the two token tiers the tree needs
- `outputChannel` singleton in `src/extension.ts` — error detail sink for D-07
- Existing `altium365.runScript` command and `python/_runner.py` subprocess flow — D-09 reuses this pipeline verbatim after writing the fetched body to `os.tmpdir()`

### Established Patterns
- All commands prefixed `altium365.` (CONVENTIONS.md)
- Errors surfaced via `vscode.window.showErrorMessage` at command boundary; detailed errors logged to `outputChannel`
- No module-level state except `outputChannel`; the new TreeDataProvider will be instantiated inside `activate()` and registered with `vscode.window.registerTreeDataProvider`
- Tokens always via `context.secrets` — never plaintext on disk

### Missing Pieces (must be added in Phase 2)
- `listScripts(workspaceToken, workspaceUrl, projectId)` in `src/workspace.ts` using the `gloScrScripts` GraphQL operation
- `viewsContainers` + `views` + `viewsWelcome` blocks in `package.json` `contributes`
- A `TreeDataProvider<A365Node>` implementation (new file, e.g. `src/sidePanel.ts`)
- Status bar item creation + click-handler `QuickPick` in `src/extension.ts`
- Four `altium365.script.*` command registrations, with only `runLocal` fully wired

### Integration Points
- New view contributes to a new `viewsContainer` in the Activity Bar; icon must coexist with the existing `resources/icon.png`
- Status bar item must subscribe to auth state changes (sign-in/sign-out/environment switch) so the label stays accurate
- Context menu wiring uses `when: viewItem == scriptNode` clauses keyed off TreeItem `contextValue`

</code_context>

<specifics>
## Specific Ideas

- Status bar format is explicitly `A365: <user> • <env>` (D-04) — keep the bullet character and the `A365:` prefix
- Phase 3 must be able to drop in three real handlers without changing `package.json` — Phase 2 placeholder handlers should be trivially replaceable

</specifics>

<deferred>
## Deferred Ideas

- Remote script edit / execute / publish business logic — Phase 3 owns this; Phase 2 only registers the commands and shows "Coming in Phase 3" placeholders
- Disk-persisted tree cache across VS Code sessions — explicitly out of scope (D-02 says in-memory only)
- Phase 1 carry-forward items (`LICENSE` file, `license` field, ci.yml `permissions:`/`pull_request`/`if-no-files-found` hardening) — tracked in `01-REVIEW.md`, not Phase 2 work

</deferred>

---

*Phase: 2-Side Panel*
*Context gathered: 2026-05-19*
