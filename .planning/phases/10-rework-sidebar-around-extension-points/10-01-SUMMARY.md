---
phase: 10-rework-sidebar-around-extension-points
plan: 01
subsystem: api
tags: [graphql, extension-points, assignments, schema-verification]

# Dependency graph
requires:
  - phase: 02-side-panel
    provides: graphqlRequest helper and workspace token pattern
  - phase: 03-remote-script-ops
    provides: GraphQL query patterns for A365 API
provides:
  - listExtensionPoints function returning extension points and nested assignments
  - ExtensionPointInfo and AssignmentInfo TypeScript interfaces
  - Verified GraphQL schema for gloCusExtensionPoints API
affects: [10-02, 10-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [GraphQL introspection for schema verification, nested assignment fetch via GraphQL connections]

key-files:
  created: []
  modified: [src/workspace.ts]

key-decisions:
  - "Use GloCusAssignmentType enum field (not __typename) for assignment type discrimination"
  - "Fetch assignments nested under extension points in single query (avoid N+1)"
  - "Return both extension points and assignments Map from listExtensionPoints"

patterns-established:
  - "GraphQL schema verification via introspection query before implementation"
  - "Nested GraphQL connection fetch pattern (assignments.nodes under extension points)"

requirements-completed: [PANEL-12]

# Metrics
duration: 6min
completed: 2026-05-27
---

# Phase 10 Plan 01: Extension Points GraphQL Schema Verification and Query Implementation

**GraphQL queries for extension points and assignments verified and implemented using live schema introspection**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-27T23:01:07Z
- **Completed:** 2026-05-27T23:07:52Z
- **Tasks:** 2 (1 checkpoint + 1 implementation)
- **Files modified:** 1

## Accomplishments

- Verified GraphQL schema for `gloCusExtensionPoints` and `GloCusAssignment` against live A365 Dev environment
- Implemented `listExtensionPoints` function with nested assignment fetch in single round-trip
- Added TypeScript interfaces (`ExtensionPointInfo`, `AssignmentInfo`) using verified field names
- Confirmed assignment type discrimination uses `type` enum field (not `__typename`)
- Avoided N+1 query problem by fetching all assignments nested under extension points

## Task Commits

Each task was committed atomically:

1. **Task 1: Checkpoint: Verify GraphQL schema** - No commit (checkpoint verification only)
2. **Task 2: Implement GraphQL query functions** - `da2f896` (feat)

**Plan metadata:** (committed separately after SUMMARY)

## Files Created/Modified

- `src/workspace.ts` - Added ExtensionPointInfo and AssignmentInfo interfaces, LIST_EXTENSION_POINTS_QUERY constant, and listExtensionPoints function (116 lines added after line 282)

## Decisions Made

1. **Use `type` enum field for assignment discrimination** - Checkpoint verified that GraphQL schema uses `GloCusAssignmentType` enum field (not `__typename`) to differentiate `DEFAULT`, `SCRIPT`, `WORKFLOW` assignment types. TypeScript interfaces use discriminated union on `type` field.

2. **Fetch assignments nested in single query** - GraphQL schema supports `assignments { nodes { ... } }` nested under extension points. Implemented single query fetch to avoid N+1 problem (RESEARCH.md Pitfall 2). Returns both extension points array and assignments Map keyed by extensionPointId.

3. **Return structured result with assignments Map** - Function signature returns `{ extensionPoints: ExtensionPointInfo[]; assignments: Map<string, AssignmentInfo[]> }` rather than embedding assignments in each extension point object. This mirrors the sidebar tree caching pattern from Phase 2 and enables efficient lookup during tree expansion.

## Deviations from Plan

None - plan executed exactly as written. Checkpoint verification confirmed all ASSUMED field names from RESEARCH.md Pattern 4 were correct.

## Issues Encountered

None - GraphQL schema introspection completed successfully, all expected types and fields present, TypeScript compilation passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 10-02 (sidebar tree integration). Extension point and assignment data structures are now available for the TreeDataProvider to consume. The `listExtensionPoints` function follows the same pattern as `listProjects` and `listScripts` - can be called in parallel via `Promise.all` during workspace expansion (D-16).

---
*Phase: 10-rework-sidebar-around-extension-points*
*Completed: 2026-05-27*
