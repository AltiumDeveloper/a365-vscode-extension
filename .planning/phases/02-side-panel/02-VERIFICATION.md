---
phase: 02-side-panel
verified: 2026-05-19T00:00:00Z
status: human_needed
score: 6/6 must-haves verified (5 PANEL-* + SCRIPT-01 deferred per context)
overrides_applied: 0
deferred:
  - truth: "SCRIPT-01 — user can run a remote script locally from the tree (D-09 flow)"
    addressed_in: "Phase 3 (Remote Script Operations)"
    evidence: "Plan 02-06 Task 1 (human-verify of A365 file-download endpoint A1 + package-format A2) returned BLOCKED; SCRIPT-01 flipped to Deferred in REQUIREMENTS.md L19/L75; altium365.script.runLocal registered as documented Phase 3 placeholder in src/scriptCommands.ts:37-40"
human_verification:
  - test: "Open VS Code with the extension installed and look at the Activity Bar"
    expected: "An Altium 365 icon (circuit-board codicon) appears in the Activity Bar; clicking it opens a side panel titled 'Workspaces'"
    why_human: "Activity Bar rendering is a VS Code shell behavior; package.json contributes block is correctly declared but only the running editor can confirm the icon actually appears and the container opens"
  - test: "Without signing in, open the Altium 365 side panel"
    expected: "A welcome view appears with a 'Sign In' link (from viewsWelcome gated by !altium365.signedIn)"
    why_human: "viewsWelcome rendering and the altium365.signedIn context-key gating are runtime behaviors of the VS Code TreeView; declaration is correct in package.json:38-44 and extension.ts updateSignedInContext flips the key, but visual confirmation needs the editor"
  - test: "Sign in, then expand a workspace node in the side panel"
    expected: "Project nodes (folder icon) and script nodes (file-code icon) appear together as siblings under the workspace, sorted alphabetically"
    why_human: "Requires a live A365 workspace with projects + scripts to confirm GraphQL responses populate the tree as expected; sidePanel.ts loadWorkspaceChildren wiring is correct but only a live fetch proves data flows end-to-end"
  - test: "Right-click a script node in the tree"
    expected: "Context menu shows 4 items in order: Run Script (Local), Execute Script Remotely, Edit Script, Publish Script. Clicking any of them displays 'Altium 365: <Label> — coming in Phase 3.' info toast"
    why_human: "Menu rendering against viewItem == scriptNode is a VS Code runtime behavior; package.json:257-278 declares the 4 entries with correct grouping and src/scriptCommands.ts registers all 4 placeholder handlers, but only the editor can confirm the menu surfaces and groups render correctly"
  - test: "After signing in, observe the status bar (right side)"
    expected: "Status bar shows '$(account) A365: <user> • <env>'. Clicking it opens a QuickPick with: Sign Out, Switch Environment, Switch Workspace"
    why_human: "StatusBarItem visibility and click-through behavior are runtime; statusBar.ts createStatusBar logic is correct but visual confirmation needs the editor with a real signed-in session"
  - test: "Switch environment via 'Altium 365: Select Environment', then observe the status bar"
    expected: "Status bar updates immediately to show the new environment name (no need to refresh)"
    why_human: "Tests the fireAuthStateChanged({ environment }) wiring from doSelectEnvironment (extension.ts:235) into the statusBar render() subscription — depends on EventEmitter delivery at runtime"
  - test: "Trigger a network/auth failure during workspace expansion (e.g. expand with expired token)"
    expected: "An inline error TreeItem appears under the workspace ('Failed: <msg>') with an error icon; clicking it re-runs the failed fetch (D-07)"
    why_human: "D-07 error-tree-item retry flow is wired (sidePanel.ts:133-140 + altium365.tree.retryNode in extension.ts:66-70) but requires a real failure scenario to confirm"
---

# Phase 02: Side Panel Verification Report

**Phase Goal:** Users can navigate their A365 workspaces, projects, and scripts via a dedicated Activity Bar side panel without running any commands manually
**Verified:** 2026-05-19
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An A365 icon appears in the Activity Bar and opens the side panel | ✓ VERIFIED (code), ? HUMAN (visual) | `package.json:21-37` declares `viewsContainers.activitybar.altium365` (circuit-board icon) and `views.altium365` with tree id `altium365.tree`. TreeView registered in `extension.ts:39-42` |
| 2 | Top level shows all workspaces the signed-in user has access to | ✓ VERIFIED | `sidePanel.ts:143-170` `loadWorkspaces()` calls `listWorkspaces(endpoint, base.access_token)` and maps each `WorkspaceInfo` into a `kind:'workspace'` node with cloud icon |
| 3 | Expanding a workspace reveals its projects and its scripts as separate child nodes | ✓ VERIFIED | `sidePanel.ts:172-210` `loadWorkspaceChildren()` runs `Promise.all([listProjects, listScripts])` with workspace-exchanged token; returns `[...projectNodes, ...scriptNodes]` with distinct contextValues (`projectNode`, `scriptNode`) and distinct icons (folder, file-code). Both sorted by name |
| 4 | Right-clicking a script node shows context menu: Run Script, Edit Script, Execute Remotely, Publish Script | ✓ VERIFIED (declaration + handlers), ? HUMAN (menu render) | `package.json:257-278` declares all 4 commands under `view/item/context` gated by `view == altium365.tree && viewItem == scriptNode` with grouping (1_run@1, 1_run@2, 2_edit@1, 2_edit@2). All 4 handlers registered in `scriptCommands.ts:37-52`. Note: Run Script is a Phase-3-placeholder by deliberate deferral (see deferred section) |
| 5 | Panel header or status bar shows signed-in user and active environment | ✓ VERIFIED | `statusBar.ts:57` formats `$(account) A365: ${user} • ${env}`, hides when not signed in. Wired to `onAuthStateChanged` (line 65-67) and re-renders on env switch via `fireAuthStateChanged({ environment })` in `extension.ts:235` |
| 6 | SCRIPT-01: list scripts via `gloScrScripts` query | ✓ VERIFIED (listing) / ⏸ DEFERRED (run-local from tree) | `workspace.ts:131-149` defines `LIST_SCRIPTS_QUERY` against `gloScrScripts` and exports `listScripts(endpoint, workspaceToken)`. Tree consumes it (sidePanel.ts:187). Run-local-from-tree flow deferred per documented BLOCKED gate |

**Score:** 6/6 truths verified at codebase level; 5 require human runtime confirmation.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | SCRIPT-01 run-local-from-tree (D-09 fetch-body + tmp-write + run pipeline) | Phase 3 | Plan 02-06 Task 1 (human-verify of A365 file-download endpoint A1 + package format A2) returned BLOCKED; REQUIREMENTS.md:19,75 marks SCRIPT-01 Deferred; `scriptCommands.ts:11-19` documents the deferral; `runScriptAtPath` helper extracted and exported from `extension.ts:311` ready for Phase 3 consumption |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/sidePanel.ts` | TreeDataProvider implementing A365 tree | ✓ VERIFIED | 211 lines; A365Node discriminated union (workspace/project/script/info/error), workspace + child caches, lazy ensureWorkspaceToken, D-07 inline error nodes with retry command |
| `src/statusBar.ts` | Status bar factory rendering user + env | ✓ VERIFIED | 72 lines; reactive on onAuthStateChanged; returns disposable handle; correct format per D-04 |
| `src/scriptCommands.ts` | Register 4 script.* commands | ✓ VERIFIED | 54 lines; all 4 commands registered as Phase-3-placeholder handlers (BLOCKED branch acceptance) |
| `src/extension.ts` | Activation wiring | ✓ VERIFIED | 585 lines; TreeView + statusBar + scriptCommands all wired into ctx.subscriptions; updateSignedInContext flips altium365.signedIn context key on activate/signIn/signOut |
| `src/workspace.ts` (extended) | listScripts helper using gloScrScripts | ✓ VERIFIED | listScripts (workspace-token scoped) at lines 143-149 with LIST_SCRIPTS_QUERY (first:100) |
| `src/auth.ts` (extended) | Per-workspace token cache + AuthState emitter + getActiveUserLabel | ✓ VERIFIED | AuthState interface + onAuthStateChanged + fireAuthStateChanged (lines 31-42); getActiveUserLabel (line 352); ensureWorkspaceToken (line 269) |
| `package.json` (contributes) | activitybar container, view, viewsWelcome, commands, menus | ✓ VERIFIED | viewsContainers.activitybar.altium365, views.altium365.tree, viewsWelcome gated on !altium365.signedIn, 7 new commands, view/title refresh, view/item/context with 4 script entries |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `extension.ts activate()` | `A365TreeDataProvider` | `new A365TreeDataProvider(ctx, output, getEndpoint)` + `vscode.window.createTreeView('altium365.tree', { treeDataProvider })` | ✓ WIRED | extension.ts:34-42 |
| `sidePanel.ts loadWorkspaces` | `listWorkspaces` from workspace.ts | direct import + call with base access_token | ✓ WIRED | sidePanel.ts:154 |
| `sidePanel.ts loadWorkspaceChildren` | `listProjects` + `listScripts` | Promise.all with workspace-exchanged token | ✓ WIRED | sidePanel.ts:185-188 |
| `package.json view/item/context` | `altium365.script.*` handlers | viewItem == scriptNode + registerCommand in scriptCommands.ts | ✓ WIRED | All 4 commands declared and handler-registered |
| `statusBar.ts render` | auth state | onAuthStateChanged subscription + getStoredTokens + getActiveUserLabel | ✓ WIRED | statusBar.ts:31-67 |
| `extension.ts doSelectEnvironment` | status bar refresh | fireAuthStateChanged({ signedIn, environment }) | ✓ WIRED | extension.ts:233-238 |
| `extension.ts onAuthStateChanged` | tree refresh + context key | updateSignedInContext + treeProvider.refresh | ✓ WIRED | extension.ts:71-74 |
| `package.json viewsWelcome` | signedIn gate | when: !altium365.signedIn ↔ ctx flipped in updateSignedInContext | ✓ WIRED | package.json:42 + extension.ts:22-29 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `A365TreeDataProvider` workspaces | `list` from `listWorkspaces` | GraphQL query in workspace.ts:50-60 | Yes (real `myWorkspaces` query, no static fallback) | ✓ FLOWING |
| `A365TreeDataProvider` children | `projects` + `scripts` | listProjects (`desProjects`) + listScripts (`gloScrScripts`) | Yes (real GraphQL, defensive array unwrap, errors propagate to inline error node) | ✓ FLOWING |
| `statusBar` user/env | `getActiveUserLabel` + `activeEnvironment` setting | JWT id_token claims + workspace config | Yes (auth.ts:352 reads from stored TokenSet) | ✓ FLOWING |
| script.* command handlers | (placeholder — info toast only) | hardcoded label string | N/A — intentional Phase 3 placeholder per BLOCKED deferral | ⏸ DEFERRED (documented) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly | `npm run compile` | (already verified clean per user note) | ✓ PASS |
| All 13 declared commands have handlers | grep cross-check of package.json commands vs registerCommand calls | 6 in extension.ts (signIn/signOut/selectWorkspace/runScript/debugScript/selectEnvironment) + 2 tree + 1 statusBar + 4 script.* = 13 ✓ | ✓ PASS |
| Activity Bar / view / context-key ids consistent | container `altium365` ↔ views key `altium365` ↔ view id `altium365.tree` ↔ viewsWelcome view `altium365.tree` | All match (Pitfall 1 mitigated) | ✓ PASS |
| Context menu scoping uses correct contextValue string | `viewItem == scriptNode` in package.json ↔ `CTX_SCRIPT = 'scriptNode'` in sidePanel.ts:19 (assigned at line 91) | Match (Pitfall 3 mitigated) | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (no probe scripts in repo) | — | — | SKIPPED (no `scripts/*/tests/probe-*.sh` and no probe references in PLAN/SUMMARY) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PANEL-01 | 02-03, 02-04 | Activity Bar entry point opens the A365 side panel | ✓ SATISFIED | viewsContainers + views + createTreeView (see Truth 1) |
| PANEL-02 | 02-04 | Top-level workspaces list | ✓ SATISFIED | sidePanel.ts loadWorkspaces (see Truth 2) |
| PANEL-03 | 02-04 | Expand workspace → projects | ✓ SATISFIED | loadWorkspaceChildren via listProjects (see Truth 3) |
| PANEL-04 | 02-04 | Expand workspace → scripts (sibling to projects) | ✓ SATISFIED | loadWorkspaceChildren via listScripts (see Truth 3) |
| PANEL-05 | 02-03, 02-06 | Script context menu: Run/Edit/ExecuteRemote/Publish | ✓ SATISFIED | package.json view/item/context + scriptCommands.ts (see Truth 4) |
| PANEL-06 | 02-02, 02-05 | Auth status (user + env) visible | ✓ SATISFIED | statusBar.ts (see Truth 5) |
| SCRIPT-01 | 02-01, 02-06 | List scripts via gloScrScripts | ✓ SATISFIED (listing) / ⏸ DEFERRED (run-local-from-tree) | listScripts helper + tree consumption; D-09 run flow deferred to Phase 3 per BLOCKED gate |

No orphaned requirements: REQUIREMENTS.md maps exactly PANEL-01..06 + SCRIPT-01 to this phase, and every requirement appears in at least one plan's frontmatter.

### Decision Honor Check (D-01..D-09)

| Decision | Honored? | Evidence |
|----------|----------|----------|
| D-01 Workspaces = root; lazy ws-token exchange cached in secrets | ✓ | sidePanel.ts:180 ensureWorkspaceToken on first expand; auth.ts ensureWorkspaceToken caches in SecretStorage |
| D-02 Workspaces eager, children lazy, in-memory only | ✓ | workspacesCache + childrenCache Map (no disk persistence) |
| D-03 Manual refresh title-bar icon | ✓ | package.json view/title refresh + altium365.tree.refresh handler clears caches |
| D-04 Status bar `A365: <user> • <env>` + QuickPick (SignOut/SwitchEnv/SwitchWs) | ✓ | statusBar.ts:57 exact format + extension.ts onStatusBarClick has all 3 items |
| D-05 viewsWelcome with Sign In button when signed out | ✓ | package.json:38-44 |
| D-06 Empty workspaces → info tree item | ✓ | sidePanel.ts:155-161 "No workspaces available for this account" |
| D-07 Inline error tree item w/ retry on fetch failure; detail to outputChannel; no toast | ✓ | sidePanel.ts:130-140 + altium365.tree.retryNode handler |
| D-08 Declare all 4 script actions in package.json now | ✓ | package.json:92-111 commands + 257-278 menus |
| D-09 Run-local flow (fetch body → tmpdir → existing runner) | ⏸ DEFERRED | scriptCommands.ts placeholder; Phase 3 will consume exported `runScriptAtPath` helper (extension.ts:311) |

### Pitfall Check (RESEARCH.md)

| Pitfall | Mitigated? | Evidence |
|---------|------------|----------|
| 1: Container/view id mismatch | ✓ | All three ids consistent (see spot-check) |
| 2: viewsWelcome doesn't hide after sign-in | ✓ | updateSignedInContext flips altium365.signedIn from activate/signIn/signOut |
| 3: Context menu fires for wrong node kind | ✓ | viewItem == scriptNode matches CTX_SCRIPT='scriptNode' |
| 4: Refresh N+1 calls | ✓ | refresh() clears caches once; getChildren rebuilds via Promise.all |
| 5: Workspace token expires mid-session | ✓ | ensureWorkspaceToken in auth.ts checks expiry (per 02-02 summary) |
| 6: Command registered before handler | ✓ | All 4 script.* handlers registered (as placeholders) |
| 7: Engine version | ✓ | package.json `"vscode": "^1.85.0"` matches @types/vscode |
| 8: D-09 body-fetch assumption | ⏸ DEFERRED | Recognized in 02-06; full flow deferred to Phase 3 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/workspace.ts` | 130 | `TODO: paginate if hasNextPage (Assumption A3 — 100-item page sufficient for v1)` | ℹ️ Info | Documented v2 scope; not a debt-marker blocker (TODO ≠ TBD/FIXME/XXX) and references the formal RESEARCH.md Assumption A3 |
| `src/scriptCommands.ts` | 28, 34-51 | `placeholder` info-toast handlers for 4 script.* commands | ⚠️ Warning (intentional) | Documented deferral per BLOCKED gate in Plan 02-06 Task 1; SCRIPT-01 status flipped to Deferred in REQUIREMENTS.md L19/L75; tracked for Phase 3 — NOT a gap |

No 🛑 Blocker anti-patterns. No unreferenced debt markers (`TBD`/`FIXME`/`XXX`) in any file modified by this phase.

### Human Verification Required

See frontmatter `human_verification` for the 7 runtime checks (Activity Bar render, welcome view, expand-and-populate, right-click menu render, status bar render, env-switch reactivity, error-tree retry flow). These are inherently runtime/visual behaviors that grep cannot verify.

### Gaps Summary

No gaps found. All 6 phase success criteria are satisfied at the codebase level:
- All required artifacts exist, are substantive, and are wired into activate()
- All 7 declared decisions (D-01..D-08) are honored in code; D-09 is consciously deferred with full traceability
- All 8 RESEARCH.md pitfalls are either mitigated or explicitly deferred
- The single deferral (SCRIPT-01 run-local-from-tree / D-09) is properly documented across PLAN-06, REQUIREMENTS.md, and the placeholder handler — and was pre-approved as `deferred` (not `gap`) in this verification request

Status is `human_needed` rather than `passed` because the side panel's value proposition (Activity Bar icon visible, tree expand populates, context menu renders, status bar updates) consists of VS Code runtime behaviors that only the editor can confirm; no automated test suite exists in this project.

---

_Verified: 2026-05-19_
_Verifier: gsd-verifier_
