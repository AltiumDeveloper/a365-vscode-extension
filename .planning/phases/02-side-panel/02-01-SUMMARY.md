---
phase: 02-side-panel
plan: 01
subsystem: api
tags: [graphql, scripts, gloScrScripts, workspace, typescript]

requires:
  - phase: 01-packaging
    provides: stable extension scaffold with existing graphqlRequest helper
provides:
  - listScripts(endpoint, workspaceToken) → ScriptInfo[]
  - ScriptInfo interface (scriptId, name, description?)
  - LIST_SCRIPTS_QUERY constant (workspace-scoped, first:100)
affects: [02-04 sidePanel TreeDataProvider, 02-06 script commands / runLocal]

tech-stack:
  added: []
  patterns:
    - "Workspace-scoped GraphQL helper mirroring listProjects: defensive nodes array, errors propagate"

key-files:
  created: []
  modified:
    - src/workspace.ts

key-decisions:
  - "Workspace-scoped query (no projectId arg) per RESEARCH.md Schema Finding §1 / D-04"
  - "Cap at first:100; defer pagination to v2 with TODO comment (Assumption A3)"
  - "Do not swallow errors — let graphqlRequest throw so D-07 tree-error handling can render them downstream"

patterns-established:
  - "Script API uses workspaceToken (RFC 8693 exchanged), not the base access_token — caller picks endpoint+token"

requirements-completed: [SCRIPT-01]

duration: 1 min
completed: 2026-05-19
---

# Phase 02 Plan 01: listScripts GraphQL helper Summary

**Added `listScripts(endpoint, workspaceToken)` and `ScriptInfo` interface to `src/workspace.ts`, mirroring `listProjects` and wired to the workspace-scoped `gloScrScripts` query — SCRIPT-01 plumbing for the Phase 2 tree provider.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-05-19T16:51:30Z
- **Completed:** 2026-05-19T16:52:03Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- New `ScriptInfo` interface (`scriptId`, `name`, `description?`) exported from `src/workspace.ts`
- New `listScripts(endpoint, workspaceToken)` async function reusing existing `graphqlRequest` helper
- Module-private `LIST_SCRIPTS_QUERY` template literal selecting only the fields the tree will render
- TypeScript compile clean; no new dependencies, no module-level state

## Task Commits

1. **Task 1: Add ScriptInfo interface and listScripts() to src/workspace.ts** — `3b52d34` (feat)

## Files Created/Modified

- `src/workspace.ts` — appended `ScriptInfo`, `LIST_SCRIPTS_QUERY`, and `listScripts()` after `listProjects` (lines 124–151)

## Decisions Made

- Workspace-scoped signature (no `projectId` arg) confirms D-04 tree shape (scripts as sibling to projects)
- `first: 100` only; no `after` cursor in v1 (Assumption A3) — TODO marker left in code
- Errors propagate to caller (consistent with `listWorkspaces`/`listProjects` pattern) so Plan 04 can render a tree-error item per D-07

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `npm run compile` → exit 0 (no TS errors)
- `grep -nE "^export async function listScripts" src/workspace.ts` → 1 match (line 143)
- `grep -nE "^export interface ScriptInfo" src/workspace.ts` → 1 match (line 124)
- `grep -n "gloScrScripts" src/workspace.ts` → 2 matches (query body + defensive nodes access — both expected)

## Self-Check: PASSED

- `src/workspace.ts` exists with all three required exports
- Commit `3b52d34` present in `git log`
- Acceptance criteria all green; no new deps; no module-level mutable state

## Next Phase Readiness

- Wave 1 sibling plans (02-02 auth refactor, 02-03 package.json contributes) can proceed in parallel
- Wave 2 Plan 04 (sidePanel TreeDataProvider) can import `listScripts` / `ScriptInfo` by name from `src/workspace.ts`

---
*Phase: 02-side-panel*
*Completed: 2026-05-19*
