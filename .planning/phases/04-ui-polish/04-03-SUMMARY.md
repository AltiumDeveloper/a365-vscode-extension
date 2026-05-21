---
phase: 04-ui-polish
plan: 03
subsystem: ui
tags: [quickpick, workspace, ux]

requires:
  - phase: 02-side-panel
    provides: pickAndExchangeWorkspace QuickPick (original GRID + authId-prefixed shape)
provides:
  - Simplified workspace QuickPick item shape (label=name, description=raw authId)
  - GRID (workspaceId) no longer visible in workspace picker UI
affects: [future workspace UX phases]

tech-stack:
  added: []
  patterns:
    - "QuickPick item shape: { label, description, ws } — drop `detail` when one disambiguator suffices"

key-files:
  created: []
  modified:
    - src/workspace.ts

key-decisions:
  - "Description shows raw authId (no 'authId:' prefix) — concise; users recognize the format from sign-in"
  - "GRID dropped entirely from UI — internal plumbing not useful for human disambiguation"

patterns-established:
  - "QuickPick items expose user-meaningful identifiers only; internal IDs stay in the carrier object (pick.ws)"

requirements-completed: [D-05]

duration: 1 min
completed: 2026-05-21
---

# Phase 04 Plan 03: Workspace QuickPick GRID Drop Summary

**Workspace picker now shows the workspace name and raw authId only — GRID and the `authId:` prefix are gone.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-05-21T (sequential executor)
- **Completed:** 2026-05-21
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `pickAndExchangeWorkspace` QuickPick items simplified to `{ label, description, ws }`
- `description` now renders the raw `authId` (used to disambiguate multi-tenant accounts) instead of `workspaceId`
- `detail` field removed — no third line in the picker
- `npm run compile` passes; downstream `pick.ws.workspaceId` / `pick.ws.authId` usage at lines 213-216 unchanged

## Task Commits

1. **Task 1: Simplify pickAndExchangeWorkspace QuickPick item shape** — `77ea02e` (refactor)

## Files Created/Modified
- `src/workspace.ts` — QuickPick item shape in `pickAndExchangeWorkspace` simplified per D-05

## Decisions Made
- None beyond plan — executed exactly as written.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ready for Plan 04-04 (next/final plan in Phase 04).
- No blockers.

---
*Phase: 04-ui-polish*
*Completed: 2026-05-21*
