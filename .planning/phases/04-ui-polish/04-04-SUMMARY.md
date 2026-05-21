---
phase: 04-ui-polish
plan: 04
subsystem: ui
tags: [vscode-tree, context-menu, workspace-selection, contextValue]

requires:
  - phase: 04-ui-polish
    provides: "Plans 04-01 (command catalog whitelist), 04-02 (active-workspace icon), 04-03 (pickAndExchangeWorkspace QuickPick shape)"
provides:
  - "CTX_WORKSPACE_ACTIVE / CTX_WORKSPACE_INACTIVE contextValue split on workspace tree nodes"
  - "Exported applyWorkspaceSelection(context, workspace) helper — single side-effect path for workspace activation, shared by palette QuickPick and tree context menu"
  - "altium365.workspace.selectFromNode command — activates a workspace directly from its tree-node context menu"
  - "package.json menu wiring: selectFromNode entry gated on workspaceNode-inactive; copyId/openInBrowser updated to /^workspaceNode/ regex"
affects: [phase-05-progress-feedback, future-tree-context-actions]

tech-stack:
  added: []
  patterns:
    - "contextValue suffix split (workspaceNode-active / -inactive) drives per-state menu visibility via VS Code when-clause regex"
    - "Side-effect helper (applyWorkspaceSelection) factored out of doSelectWorkspace so multiple entry points share one activation path"

key-files:
  created: []
  modified:
    - src/sidePanel.ts
    - src/extension.ts
    - src/workspace.ts
    - src/treeCommands.ts
    - package.json

key-decisions:
  - "Renamed pickAndExchangeWorkspace → pickWorkspace and dropped its side effects (token exchange, globalState write) — single caller, name now matches new pure-picker contract"
  - "Resolved extension.ts ↔ treeCommands.ts circular import cleanly under tsc — no need to relocate applyWorkspaceSelection to workspace.ts (planner's fallback)"
  - "Reused existing globalState key altium365.selectedWorkspace from new path (D-16 backwards-compat)"

patterns-established:
  - "contextValue-suffix split: when a tree-item state needs to gate menu visibility, split the contextValue into '-active'/'-inactive' suffixes and use regex /^kindNode/ in when-clauses for state-agnostic entries"
  - "Side-effect helper extraction: when a second UI entry point needs the same post-pick side effects as an existing command, factor the side effects into an exported helper and have both callers invoke it"

requirements-completed: [D-11, D-12, D-13, D-14, D-15, D-16]

duration: 6min
completed: 2026-05-21
---

# Phase 04 Plan 04: Select Workspace Context Menu Summary

**Right-click a workspace tree node → 'Select Workspace' activates it directly via a shared applyWorkspaceSelection helper; entry hides on the already-active workspace via a contextValue-suffix split.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 4
- **Files modified:** 5

## Accomplishments

- `CTX_WORKSPACE` split into `CTX_WORKSPACE_ACTIVE` / `CTX_WORKSPACE_INACTIVE`; workspace tree items now self-identify their activation state to VS Code's menu system (D-13)
- New exported `applyWorkspaceSelection(context, workspace)` helper in `extension.ts` is the single side-effect path for activating a workspace — invoked from both the palette QuickPick (`doSelectWorkspace`) and the new tree context menu (D-14)
- `altium365.workspace.selectFromNode` command registered in `treeCommands.ts`; handler guards `node.kind === 'workspace'`, then delegates to `applyWorkspaceSelection(context, node.info)` (D-11, D-14)
- `package.json` menu wiring: third workspace entry for selectFromNode gated on `workspaceNode-inactive` in group `1_select@1`; existing copyId/openInBrowser entries updated to `viewItem =~ /^workspaceNode/` regex so they survive on both states (D-12, D-13)
- `contributes.commands[]` count unchanged at 6 — selectFromNode intentionally kept out of the palette whitelist per Plan 04-01 D-02/D-04

## Task Commits

1. **Task 1: Split CTX_WORKSPACE in sidePanel.ts** — `14c0b97` (refactor)
2. **Task 2: Factor applyWorkspaceSelection out of doSelectWorkspace** — `b99acd5` (refactor; includes `pickAndExchangeWorkspace` → `pickWorkspace` rename in workspace.ts)
3. **Task 3: Register altium365.workspace.selectFromNode in treeCommands.ts** — `2546cb6` (feat)
4. **Task 4: Update package.json view/item/context** — `c6de4a0` (feat)

## Files Created/Modified

- `src/sidePanel.ts` — CTX_WORKSPACE split into ACTIVE/INACTIVE constants; getTreeItem workspace case assigns the matching contextValue based on `isActive`
- `src/extension.ts` — added exported `applyWorkspaceSelection(context, workspace)` helper; refactored `doSelectWorkspace` to call `pickWorkspace` then `applyWorkspaceSelection`; imports `ensureWorkspaceToken`, `WorkspaceInfo`, `pickWorkspace`
- `src/workspace.ts` — renamed `pickAndExchangeWorkspace` → `pickWorkspace`; dropped the in-function `ensureWorkspaceToken` + `globalState.update` side effects; now returns `WorkspaceInfo | undefined` only (pure picker)
- `src/treeCommands.ts` — registered `altium365.workspace.selectFromNode` handler; imports `applyWorkspaceSelection` from `./extension`; removed `void context` placeholder since `context` is now used
- `package.json` — added selectFromNode menu entry; updated copyId + openInBrowser when-clauses to `viewItem =~ /^workspaceNode/` regex

## Decisions Made

**1. `pickAndExchangeWorkspace` renamed to `pickWorkspace` (not in-place contract change)**

Plan 04-04 Task 2 left the choice open between renaming and keeping the name with a changed contract. With a single caller (`extension.ts:295`), renaming produced the smaller diff overall (no JSDoc gymnastics explaining "this no longer exchanges despite the name") and made the new contract self-documenting. The dropped side effects (`ensureWorkspaceToken` call + `globalState.update('altium365.selectedWorkspace', …)`) now live exclusively in `applyWorkspaceSelection`, so there is exactly one code path that writes `altium365.selectedWorkspace` per activation — no double-write risk across the QuickPick and tree-context entry points.

**2. extension.ts ↔ treeCommands.ts circular import resolved cleanly under tsc**

The planner flagged a risk: `extension.ts` already imports `registerTreeCommands` from `./treeCommands`, and Task 3 required `treeCommands.ts` to import `applyWorkspaceSelection` from `./extension` — forming a cycle. ES modules tolerate cyclic imports as long as the imported symbol is accessed lazily (inside a function body) rather than at module-eval time, which is exactly the shape here: `applyWorkspaceSelection` is called inside the `registerCommand` handler body, not during module initialisation. `npm run compile` exited 0 on the naïve approach with no warnings. The fallback (relocate `applyWorkspaceSelection` into `workspace.ts`) was not adopted; the SUMMARY documents this so future readers don't second-guess the architecture.

## Deviations from Plan

None — plan executed exactly as written. All four tasks landed with the planner's preferred path (rename + clean cycle), no deviation rules triggered.

## Issues Encountered

None. `npm run compile` clean on every task; all `node -e` package.json verifiers passed.

## Threat Flags

None — no new GraphQL operations, no new auth surface, no new persistence keys (D-15, D-16). The new command reuses the audited `ensureWorkspaceToken` path that backs the existing palette QuickPick flow.

## Next Phase Readiness

- Phase 04 (UI Polish) closes with this plan — 4/4 plans complete. UAT Scenario 4 discoverability gap (users not realising workspace switching required the palette) is addressed.
- Phase 5 (Progress Feedback for Async Ops) is unblocked and ready for `/gsd-discuss-phase 05`.
- No outstanding blockers from this plan.

---
*Phase: 04-ui-polish*
*Completed: 2026-05-21*
