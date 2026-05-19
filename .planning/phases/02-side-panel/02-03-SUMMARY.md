---
phase: 02-side-panel
plan: 03
subsystem: ui
tags: [vscode-extension, package-json, contributes, activity-bar, tree-view, menus]

requires:
  - phase: 01-packaging
    provides: VSIX packaging baseline so manifest changes flow into installable artifacts
  - phase: 02-side-panel/02-01
    provides: gloScrScripts GraphQL query (consumed by Plan 04 TreeDataProvider that this manifest wires)
  - phase: 02-side-panel/02-02
    provides: AuthState emitter (drives the altium365.signedIn context key referenced by viewsWelcome)
provides:
  - Activity Bar container id `altium365` with circuit-board codicon
  - Tree view id `altium365.tree` titled "Workspaces"
  - viewsWelcome panel gated by `!altium365.signedIn` with a Sign In command link
  - 7 new command declarations (tree.refresh, tree.retryNode, statusBar.click, script.runLocal/edit/executeRemote/publish)
  - menus.view/title refresh icon and 4-entry menus.view/item/context wired to `viewItem == scriptNode`
affects: [02-04 sidePanel TreeDataProvider, 02-05 status bar, 02-06 script commands, 03-* remote script operations]

tech-stack:
  added: []
  patterns:
    - Declarative-first: every command + menu entry declared in package.json before any TS handler exists, so later plans only register handlers
    - Group-ordered context menus: `<groupPrefix>@<order>` convention (1_run@1..2, 2_edit@1..2) keeps run/author actions separated

key-files:
  created: []
  modified:
    - package.json — extended contributes block with viewsContainers, views, viewsWelcome, 7 commands, and 2 menu surfaces

key-decisions:
  - Use `$(circuit-board)` codicon for the Activity Bar entry initially (no shipped SVG asset; auto-themes; RESEARCH.md Open Question 3 resolution)
  - Declare `altium365.tree.retryNode` with a user-readable title even though it is not intended for the Command Palette — VS Code requires the declaration for TreeItem.command bindings (commandPalette exclusion deferred to polish)

patterns-established:
  - "Manifest-first wiring: declare commands + menus in package.json, register handlers later — keeps Phase 3 from re-touching the manifest"
  - "Container/view/key id consistency: `altium365` (container) ↔ `altium365` (views key) ↔ `altium365.tree` (view id) — Pitfall 1 mitigation"

requirements-completed: [PANEL-01, PANEL-05]

duration: 2 min
completed: 2026-05-19
---

# Phase 02 Plan 03: Package Manifest Contributes Summary

**Declarative Activity Bar + Workspaces tree view + 7 command declarations + signed-out viewsWelcome wired into `package.json` so Plans 04/05/06 only need to register handlers.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-19T16:56:08Z
- **Completed:** 2026-05-19T16:58:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Activity Bar entry "Altium 365" with circuit-board codicon registered (PANEL-01 declarative half)
- Workspaces tree view (`altium365.tree`) declared with viewsWelcome Sign In panel gated by `!altium365.signedIn`
- All 7 Phase 2 commands declared so handler registration in Plans 04/05/06 has no manifest churn (PANEL-05 declarative half)
- Tree title refresh icon + 4-entry script context menu wired with stable group ordering (`1_run@1..2`, `2_edit@1..2`)

## Task Commits

1. **Task 1: Add viewsContainers + views + viewsWelcome blocks** — `ba1aafb` (feat)
2. **Task 2: Declare 7 new commands and add view/title + view/item/context menus** — `359825f` (feat)

## Files Created/Modified

- `package.json` — extended `contributes` with `viewsContainers`, `views`, `viewsWelcome`, 7 new commands, `menus.view/title`, `menus.view/item/context`. All 6 existing commands, configuration block, and editor/title/run + explorer/context menus preserved unchanged.

## Decisions Made

- Codicon `$(circuit-board)` chosen for the Activity Bar entry to avoid shipping an SVG asset and to auto-theme — can be replaced with a branded SVG later without breaking any wiring
- `altium365.tree.retryNode` declared with a user-readable title (deferred Command Palette suppression to polish)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Manifest now exposes every surface Plans 04/05/06 need to wire up; those plans add handlers and the TreeDataProvider without touching `package.json`
- `altium365.signedIn` context key is consumed by the viewsWelcome `when` clause — Plan 04/05 must call `vscode.commands.executeCommand('setContext', 'altium365.signedIn', boolean)` on every auth state change (RESEARCH.md Pitfall 2 — already captured in this plan's threat model T-02-03-02)

## Self-Check: PASSED

- `package.json` parses as valid JSON (verified via Node)
- `npm run compile` exits 0
- All acceptance criteria for Task 1 and Task 2 verified by the embedded Node validation scripts (both printed `ok`)
- Both task commits present: `ba1aafb`, `359825f`

---
*Phase: 02-side-panel*
*Completed: 2026-05-19*
