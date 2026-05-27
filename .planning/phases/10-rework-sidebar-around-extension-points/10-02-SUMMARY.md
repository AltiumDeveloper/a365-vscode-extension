---
phase: 10-rework-sidebar-around-extension-points
plan: 02
subsystem: ui
tags: [tree-provider, extension-points, sidebar, grouping, caching]

# Dependency graph
requires:
  - phase: 10-01
    provides: listExtensionPoints function and ExtensionPointInfo/AssignmentInfo interfaces
  - phase: 02-side-panel
    provides: TreeDataProvider pattern with caching and refresh
provides:
  - Extended A365Node union with five new node types for Extension Points hierarchy
  - Extension Points category as third sibling under each workspace
  - Four-level grouping: Entity Type → EP Type → Extension Point → Assignment
  - TreeDataProvider methods for Extension Points tree expansion
affects: [10-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [Multi-level tree grouping with Map-based caching, Entity type and EP type icon mapping]

key-files:
  created: []
  modified: [src/sidePanel.ts]

key-decisions:
  - "Extension Points fetched in parallel with Projects/Scripts via Promise.all (D-16)"
  - "Refresh clears extension points caches independently per category (D-17)"
  - "Assignment nodes have no command yet - Plan 10-03 extends script.edit handler"
  - "Entity and EP type icons use hardcoded maps with fallback icons"

patterns-established:
  - "Multi-level grouping pattern: group by first key → group by second key → leaf items"
  - "Entity/EP type icon mapping with fallback to generic icons"

requirements-completed: [PANEL-12, PANEL-13]

# Metrics
duration: 3min
completed: 2026-05-27
---

# Phase 10 Plan 02: Extension Points Sidebar Tree Integration

**Four-level Extension Points hierarchy integrated into sidebar tree with parallel fetch, grouping by entity and EP type, and distinct icons per type**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-27T23:09:36Z
- **Completed:** 2026-05-27T23:13:14Z
- **Tasks:** 4
- **Files modified:** 1

## Accomplishments

- Extended A365Node union with five new node types for Extension Points hierarchy
- Added Extension Points as third category sibling alongside Projects and Scripts
- Implemented four-level grouping logic: Entity Type → EP Type → Extension Point → Assignment
- Extension Points fetched in parallel with existing queries (D-16)
- Category-specific refresh handling for Extension Points (D-17)
- Distinct icons for entity types, EP types, and assignment types (D-07)
- TypeScript compilation succeeds with all new node types

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend A365Node union with Extension Points node types** - `ed5d7dd` (feat)
2. **Task 2: Add Extension Points caching and parallel fetch** - `2bd596a` (feat)
3. **Task 3: Implement getChildren hierarchy for Extension Points** - `01e6796` (feat)
4. **Task 4: Implement getTreeItem rendering for Extension Points** - `a0b0afa` (feat)

**Plan metadata:** (committed separately after SUMMARY)

## Files Created/Modified

- `src/sidePanel.ts` - Extended A365Node union (+5 variants), added cache maps (+2), implemented Extension Points tree hierarchy (+4 loader methods), added getTreeItem rendering cases (+5 cases), extended imports and constants. Net: ~200 lines added to 327-line file.

## Decisions Made

1. **Extension Points fetched in parallel (D-16)** - Added `listExtensionPoints` to existing `Promise.all([listProjects, listScripts])` in `loadWorkspaceChildren`. All three GraphQL queries run concurrently, preserving "one round-trip per workspace expand" performance contract from Phase 2.

2. **Independent category refresh (D-17)** - Extension Points category refresh clears only `extensionPointsCache` and `assignmentsCache`, bubbles to parent workspace (same pattern as Projects/Scripts categories). No cross-category synchronization.

3. **Assignment nodes incomplete (expected)** - Script assignments (`CTX_ASSIGNMENT_SCRIPT`) have correct icon and contextValue but NO `TreeItem.command`. Single-click will fail until Plan 10-03 extends `altium365.script.edit` handler to support assignment nodes. Documented in code comment per plan success criteria #5.

4. **Hardcoded icon maps** - Entity types and EP types use inline icon mappings with fallback icons. Entity type map: `{Project: 'folder', BOM: 'list-tree', Workspace: 'workspace', Library: 'library'}` → fallback `symbol-namespace`. EP type map: `{UIAction.ContextMenu: 'symbol-method', Event: 'symbol-event', Project.ERC: 'checklist', BOM.Checks: 'checklist'}` → fallback `symbol-key`.

## Deviations from Plan

None - plan executed exactly as written. All four tasks implemented per specification, TypeScript compiles successfully.

## Issues Encountered

None - straightforward extension of existing TreeDataProvider patterns from Phase 2. All acceptance criteria passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 10-03 (extend script operations to assignment nodes). The tree now renders Extension Points with full hierarchy, but assignment click behavior is incomplete as expected. Plan 10-03 will:
- Extend `altium365.script.edit` command to handle assignment nodes
- Wire `TreeItem.command` for script assignments after handler update
- Preserve workflow/default assignments as read-only (D-11)

**Known limitation (expected):** Clicking a script assignment node will fail with "command not found" until Plan 10-03 extends the handler. This is documented in success criteria #5 and code comments (lines 280-282 in sidePanel.ts).

---
*Phase: 10-rework-sidebar-around-extension-points*
*Completed: 2026-05-27*
