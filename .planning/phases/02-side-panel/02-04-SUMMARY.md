---
phase: 02-side-panel
plan: 04
subsystem: ui
tags: [vscode-extension, tree-data-provider, activity-bar, context-key, graphql]

requires:
  - phase: 02-side-panel/02-01
    provides: listScripts + ScriptInfo (workspace-scoped script listing)
  - phase: 02-side-panel/02-02
    provides: ensureWorkspaceToken, onAuthStateChanged, fireAuthStateChanged, AuthState
  - phase: 02-side-panel/02-03
    provides: package.json view id altium365.tree, contextValue strings, viewsWelcome gate, command declarations
provides:
  - src/sidePanel.ts (A365TreeDataProvider, A365Node, CTX_WORKSPACE/PROJECT/SCRIPT)
  - TreeView 'altium365.tree' registered in activate() with showCollapseAll
  - altium365.tree.refresh and altium365.tree.retryNode command handlers
  - altium365.signedIn context key wiring on activate / signIn / signOut / env-switch
  - fireAuthStateChanged({ environment }) broadcast from doSelectEnvironment
affects: [02-05 status bar, 02-06 script commands runLocal / edit / executeRemote / publish]

tech-stack:
  added: []
  patterns:
    - "Discriminated-union node model for vscode.TreeDataProvider<T> with kind-switch in getTreeItem/getChildren"
    - "Per-workspace child cache (Map keyed by workspaceId) + Promise.all for parallel sibling fetch (projects + scripts)"
    - "Inline error TreeItem with TreeItem.command -> retry handler (D-07) instead of toast notifications"
    - "altium365.signedIn context key flipped through a small async helper called from every auth-state mutator"

key-files:
  created:
    - src/sidePanel.ts
  modified:
    - src/extension.ts

key-decisions:
  - "Workspace base URL derived from getEndpoint().replace(/\\/api(\\/.*)?$/, '') so Plan 06 can build per-workspace web links without a new setting"
  - "ensureWorkspaceToken is invoked lazily on first expansion of a workspace node — root listing uses only the base access token (no eager exchange for unopened workspaces)"
  - "doSelectEnvironment fires fireAuthStateChanged with the new environment name so Plan 05 status bar updates atomically with the tree refresh"
  - "Tree-fetch errors are converted to a single inline error TreeItem with retry command; full error text goes to outputChannel only (T-02-04-01)"

patterns-established:
  - "DI of (context, outputChannel, getEndpoint) into TreeDataProvider instead of module-level state (PATTERNS.md S6, AGENTS.md no-module-state rule)"
  - "Single context.subscriptions.push() block in activate — new disposables append rather than spawning sibling push() calls (Plan 05 follows the same)"

requirements-completed: [PANEL-01, PANEL-02, PANEL-03, PANEL-04]

duration: 2 min
completed: 2026-05-19
---

# Phase 02 Plan 04: Side-Panel TreeDataProvider Summary

**Side-panel tree wired end-to-end: `A365TreeDataProvider` renders workspaces lazily, fans out each workspace into projects + scripts as siblings via parallel GraphQL, surfaces fetch errors as inline retry items, and flips the `altium365.signedIn` context key on every auth-state change so the viewsWelcome panel from Plan 03 toggles correctly.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-19T16:58:14Z
- **Completed:** 2026-05-19T17:00:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- New `src/sidePanel.ts` exporting `A365TreeDataProvider`, `A365Node` discriminated union, and `CTX_WORKSPACE`/`CTX_PROJECT`/`CTX_SCRIPT` constants matching Plan 03's package.json menu strings
- Workspace-level cache (`workspacesCache`) and per-workspace child cache (`childrenCache: Map<workspaceId, A365Node[]>`); refresh() clears the right slice and emits `onDidChangeTreeData` (RESEARCH.md Pitfall 4)
- Parallel `listProjects + listScripts` via `Promise.all` after lazy `ensureWorkspaceToken`; projects sorted then scripts sorted alphabetically, concatenated as siblings (PANEL-04 / D-04)
- D-06 empty-account behaviour: single info TreeItem `"No workspaces available for this account"`
- D-07 inline error handling: any thrown error inside `getChildren` becomes a single `error` TreeItem with `altium365.tree.retryNode` command bound to `refresh(parent)`; full error text logged to outputChannel only
- `extension.ts` activate() instantiates the provider, registers the `altium365.tree` TreeView with `showCollapseAll`, registers `altium365.tree.refresh` + `altium365.tree.retryNode`, and subscribes to `onAuthStateChanged` to flip the context key and refresh
- `updateSignedInContext(context)` invoked 5× (activate initial push + doSignIn + doSignOut + doSelectEnvironment sign-out branch + via onAuthStateChanged subscription) — exceeds Pitfall 2 / acceptance gate of ≥4
- `doSelectEnvironment` now also calls `fireAuthStateChanged({ signedIn, environment: pick.name })` after env switch so Plan 05 status bar sees the change
- `npm run compile` clean; no new dependencies; no new module-level mutable state

## Task Commits

1. **Task 1: Create src/sidePanel.ts with A365TreeDataProvider + A365Node union + contextValue constants** — `e9bae3b` (feat)
2. **Task 2: Wire TreeView, refresh/retry commands, and altium365.signedIn context key into extension.ts activate()** — `ab1a91d` (feat)

**Plan metadata:** _to follow_ (docs commit with this SUMMARY)

## Files Created/Modified

- `src/sidePanel.ts` — **new** (211 lines): `A365Node` union, `A365TreeDataProvider`, context-value constants, lazy workspace + child caches, parallel sibling fetch, inline error node, retry command binding
- `src/extension.ts` — added imports (`fireAuthStateChanged`, `getStoredTokens`, `onAuthStateChanged`, `A365TreeDataProvider`, `A365Node`); added `updateSignedInContext` helper; instantiated provider + TreeView in `activate()`; extended the single `context.subscriptions.push(...)` with `treeView`, two tree commands, and the auth-state subscription; added context-key updates after sign-in/sign-out/env-switch and `fireAuthStateChanged` on env switch

## Decisions Made

- **Workspace URL derivation:** `getEndpoint().replace(/\/api(\/.*)?$/, '') || endpoint` — Plan 06 can build per-workspace web links without a new setting; if no `/api` suffix, the raw endpoint is reused unchanged (safe default).
- **Lazy workspace-token exchange:** `ensureWorkspaceToken` is only called when a workspace node is actually expanded, not when the root list is fetched. Avoids eager RFC-8693 exchanges for workspaces the user never opens.
- **Provider does not register commands or createTreeView internally** (PATTERNS.md anti-pattern note). Activation wiring stays in `activate()` so subscription disposal is centralized.
- **fireAuthStateChanged on env switch:** added even before Plan 05 ships, because env switching otherwise leaves the tree stale (cached workspaces from the old endpoint).
- **Error node carries parent for retry:** `error.parent` is set at throw time; clicking the inline error re-runs `refresh(parent)` which clears the right cache slot and re-fetches just that level.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Task 2 action block contained a meta-note (lines 254–258) that the original "treeProvider.refresh()" call in doSignIn was unreachable because `treeProvider` is local to `activate`; it resolved the apparent contradiction by relying on the `onAuthStateChanged` subscription to do the refresh. The implementation follows that resolution: `doSignIn`/`doSignOut`/`doSelectEnvironment` only call `updateSignedInContext(context)` and let the subscription handle the refresh, exactly as specified.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Verification

- `npm run compile` → exit 0 (TypeScript strict) after each task commit
- `grep -nE "^export class A365TreeDataProvider" src/sidePanel.ts` → 1 match (line 36)
- `grep -nE "implements vscode.TreeDataProvider<A365Node>" src/sidePanel.ts` → 1 match (line 36)
- `grep -n "CTX_SCRIPT = 'scriptNode'" src/sidePanel.ts` → 1 match (line 19) — gates Plan 03 context menus
- `grep -n "Promise.all" src/sidePanel.ts` → 1 match (line 185) — PANEL-04 parallel sibling fetch
- `grep -n "altium365.tree.retryNode" src/sidePanel.ts` → 1 match (line 112) — D-07 retry binding
- `grep -n "new A365TreeDataProvider" src/extension.ts` → 1 match (line 32)
- `grep -n "createTreeView('altium365.tree'" src/extension.ts` → 1 match (line 37)
- `grep -n "altium365.tree.refresh" src/extension.ts` → 1 match (line 59)
- `grep -n "altium365.tree.retryNode" src/extension.ts` → 1 match (line 60)
- `grep -n "onAuthStateChanged" src/extension.ts` → 2 matches (import + subscription)
- `grep -n "setContext', 'altium365.signedIn'" src/extension.ts` → 1 match (line 23)
- `grep -c "updateSignedInContext(context)" src/extension.ts` → 5 (≥4 required)

## Self-Check: PASSED

- `src/sidePanel.ts` exists with all required exports (A365TreeDataProvider, A365Node, CTX_*)
- `src/extension.ts` instantiates provider, creates TreeView, registers both tree commands, subscribes to auth events, flips signedIn context key
- Both commits present in `git log`: `e9bae3b` (sidePanel) and `ab1a91d` (extension wiring)
- All acceptance criteria for Tasks 1 and 2 verified by greps above
- `npm run compile` exits 0 with strict mode
- No new module-level mutable state added beyond pre-existing `outputChannel` singleton

## Next Phase Readiness

- Wave 2 sibling Plan 02-05 (status bar) can subscribe to `onAuthStateChanged` (already published) and read `getActiveUserLabel(context)` — env name is now broadcast in `AuthState.environment`
- Wave 3 Plan 02-06 (script commands) can consume `A365Node` (specifically the `script` variant carries `workspaceId`, `workspaceAuthId`, `workspaceUrl`, and `script: ScriptInfo`) and call `ensureWorkspaceToken` itself — all four context-menu commands (`altium365.script.runLocal/edit/executeRemote/publish`) receive a `scriptNode` arg via the TreeItem context-menu binding from Plan 03

---
*Phase: 02-side-panel*
*Completed: 2026-05-19*
