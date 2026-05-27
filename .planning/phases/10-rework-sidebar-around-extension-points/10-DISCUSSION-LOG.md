# Phase 10: Rework sidebar around extension points - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 10-rework-sidebar-around-extension-points
**Areas discussed:** Tree hierarchy and navigation, Extension point presentation, Assignment and script relationship, Migration and backward compatibility

---

## Tree hierarchy and navigation

### Question 1: Should extension points replace the 'Scripts' category entirely, or coexist as a sibling? How deep should the tree go?

| Option | Description | Selected |
|--------|-------------|----------|
| Extension points as top-level category (Recommended) | Extension points replace Scripts category entirely. Workspace → Extension Points (collapsible) with assignments nested underneath. Unassigned scripts get a special 'Unassigned Scripts' node or are hidden. | |
| Extension Points + Scripts as sibling categories | Both 'Extension Points' and 'Scripts' coexist as separate categories. User can navigate both models. More migration-friendly but UI becomes crowded. | ✓ |
| Full 3-level hierarchy (EP → Assignments → Scripts) | Deeper nesting: Workspace → Extension Points → Assignments → Scripts. More explicit but adds click depth. Good if assignments have rich metadata to show. | |

**User's choice:** Extension Points + Scripts as sibling categories
**Notes:** User chose #2 to keep scripts for now until it is clear that extension points replace them cleanly

### Question 2: Within the Extension Points category, how deep should assignment nesting go?

| Option | Description | Selected |
|--------|-------------|----------|
| 2-level: Extension Points → Assignments (Recommended) | Show assignments as direct children of extension points. Click assignment → opens assigned script for editing. Minimal depth, faster navigation. | ✓ |
| 3-level: Extension Points → Assignments → Scripts | Show scripts as a third level. Extension Point → Assignment → Script node. More explicit relationship but adds click depth. | |

**User's choice:** 2-level: Extension Points → Assignments (Recommended)

### Question 3: What should happen to scripts that aren't assigned to any extension point?

| Option | Description | Selected |
|--------|-------------|----------|
| Show in 'Unassigned Scripts' node (Recommended) | Add an 'Unassigned Scripts' pseudo-extension-point in the Extension Points category that lists scripts not linked to any assignment. Keeps everything in one place. | |
| Scripts category shows all; EP category shows only assigned | Only the Scripts category shows all scripts; Extension Points category shows only assigned ones. Scripts category remains the authoritative list. | ✓ |
| Hide unassigned from EP tree | Hide unassigned scripts from Extension Points tree entirely. They only appear in the Scripts category. | |

**User's choice:** Scripts category shows all; EP category shows only assigned

---

## Extension point presentation

### Question 1: How should extension points be labeled in the tree?

| Option | Description | Selected |
|--------|-------------|----------|
| Friendly name (Recommended) | Show a human-friendly label derived from the extension point type/name. Example: 'Order Status Changed' instead of 'order.status.changed'. Better UX but requires name mapping. | |
| Technical identifier | Show the raw extension point identifier as returned by the API. Example: 'glo.cus.extensionPoint.orderStatusChanged'. Technical but unambiguous. | |
| Both friendly name + identifier | Show both: 'Order Status Changed (order.status.changed)'. Verbose but informative. | |

**User's choice:** Use 'name' field for human-readable label
**Notes:** Extension points are organized by entity type ('entityType' field in GraphQL API). Further, under the same type (e.g. Project) there are multiple types of extension points ('type' field in GraphQL): UIAction.ContextMenu (context menu action), Event (async event related to entity), Project.ERC (custom ERC check, applicable only to Project entities), BOM.Checks (custom BOM check, applicable only to BOM entities) - there will be others in future. Tree structure should group extension points based on entity and type of extension point. Use 'name' field for human readable name. There is also 'description' that will be useful for tooltip or similar extended presentation.

### Question 2: Given the entity type + extension point type structure, how should we organize the tree?

| Option | Description | Selected |
|--------|-------------|----------|
| Entity Type → EP Type → Extension Points (Recommended) | Group by entity type first, then by extension point type. Example tree: Projects → UIAction.ContextMenu (3), Projects → Event (2), BOM → BOM.Checks (1). Two-level grouping before showing actual extension points. | ✓ |
| Flat list with labels showing context | Flat list of all extension points, no grouping. Show 'Project: Order Status Changed (Event)' as the label. Simpler tree structure but could get long. | |
| Group by EP Type only | Group only by extension point type, skip entity grouping. Example: UIAction.ContextMenu (5 items across all entities), Event (3 items). Groups related interaction patterns together. | |

**User's choice:** Entity Type → EP Type → Extension Points (Recommended)

### Question 3: What metadata should appear in the extension point tree item label?

| Option | Description | Selected |
|--------|-------------|----------|
| Show assignment count (Recommended) | Show assignment count in parentheses like the current pattern. Example: 'Order Status Changed (2)' means 2 assignments. Simple and consistent with existing Projects/Scripts categories. | ✓ |
| Name only, no count | Show extension point name only, no count. Cleaner but user must expand to see if anything is assigned. | |
| Count + type indicator | Show count + type indicator. Example: 'Order Status Changed (2 assignments, Event)'. More verbose but informative at a glance. | |

**User's choice:** Show assignment count (Recommended)

### Question 4: How should we use the 'description' field from the extension point API?

| Option | Description | Selected |
|--------|-------------|----------|
| Show description in tooltip (Recommended) | Show the 'description' field from the API in the tooltip. Provides context about what the extension point does when user hovers. | ✓ |
| Description + identifier in tooltip | Show description + technical identifier in tooltip. Example: 'Triggered when order status changes\n(ID: order.status.changed)'. More complete reference. | |
| No tooltip | No tooltip, keep it minimal. | |

**User's choice:** Show description in tooltip (Recommended)

### Question 5: How should extension points and their groupings be visually distinguished?

| Option | Description | Selected |
|--------|-------------|----------|
| Icon per entity/EP type (Recommended) | Use consistent icons for entity types (Project = folder, BOM = list-tree, etc) and EP types (Event = symbol-event, UIAction = symbol-method). VSCode ThemeIcons. | ✓ |
| Single generic icon | Single generic icon for all extension points (symbol-interface or plug). Simple but less informative. | |
| No icons | No icons, text only. | |

**User's choice:** Icon per entity/EP type (Recommended)

---

## Assignment and script relationship

### Question 1: How should assignments appear under extension points?

| Option | Description | Selected |
|--------|-------------|----------|
| Assignment labeled by script name (Recommended) | Assignment tree item shows script name as the label. Clicking assignment opens the assigned script for editing. Simple and direct. | |
| Assignment metadata + nested script child | Assignment tree item shows assignment metadata (ID, status, etc). Nested script child shows script name. More explicit but adds click depth. | |
| Assignment ID + script name combined | Assignment shows both assignment ID and script name. Example: 'Assignment #123 → UpdateOrderStatus'. Verbose but complete at a glance. | |

**User's choice:** Use assignment name (name field in GloCusAssignment)

### Question 2: What happens when user clicks or right-clicks an assignment in the tree?

| Option | Description | Selected |
|--------|-------------|----------|
| Assignment click opens script (Recommended) | Clicking assignment opens the assigned script for editing (reuses existing script editing flow). Script operations (edit/publish/execute) work the same but contextual to the assignment. | |
| Assignment details separate from script | Clicking assignment shows assignment details panel. Separate 'Open Script' action in context menu. More explicit separation between assignment metadata and script content. | |
| Extension Points tree is read-only | Assignments are read-only in tree. All actions (execute, edit) must go through the Scripts category. Extension Points tree is view-only. | |

**User's choice:** Multiple assignment types
**Notes:** There are multiple assignment types: GloCusScriptAssignment is backed by a script and click on it must behave as existing implementation for scripts behaves - script will be opened in VSCode with ability to edit/save/run/debug. Other assignment types (GloCusWorkflowAssignment, GloCusDefaultAssignment) will be shown in the tree (maybe with different icons to differentiate them from scripts) but there will be no actions for now. In future we may add context menu items to open workflow in web browser, for example, or start it - out of scope for now. GloCusAssignment has type field that helps to differentiate assignments across these types.

### Question 3: Should parameter expectations or execution context be visible in the tree?

| Option | Description | Selected |
|--------|-------------|----------|
| Show parameters in tooltip (Recommended) | Show parameter expectations from extension point API in assignment tooltip or when hovering. Helps user understand what the script receives when triggered. | ✓ |
| Dedicated details command | Add a 'View Extension Point Details' command that shows parameters, trigger context, and documentation in a separate panel. | |
| No parameter info in tree | Don't show parameter info in the tree. User learns from documentation or script code. | |

**User's choice:** Show parameters in tooltip (Recommended)

### Question 4: Should execution history or run status be visible for assignments?

| Option | Description | Selected |
|--------|-------------|----------|
| Show last run time in tooltip (Recommended) | Show last execution timestamp in tooltip. Example: 'Last run: 2 hours ago'. Lightweight indicator of assignment activity. | |
| Visual execution status badge | Show execution status badge/icon. Green checkmark = last run succeeded, red X = failed, gray = never run. Visual at-a-glance status. | |
| Dedicated execution history command | Add 'View Execution History' context menu command that shows recent runs and logs. | |
| No execution history in tree | Don't show execution history in tree. User checks logs in Output Channel as before. | ✓ |

**User's choice:** No execution history in tree

---

## Migration and backward compatibility

### Question 1: Is the coexistence of Scripts + Extension Points temporary or permanent?

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent coexistence (Recommended) | Both Scripts and Extension Points categories coexist permanently. Scripts category remains the authoritative script list; Extension Points shows assignment-centric view. Users can use whichever model fits their workflow. | ✓ |
| Planned migration with deprecation | Extension Points replaces Scripts in a future phase (Phase 11?). Phase 10 is the transition period where both exist. Add deprecation notice to Scripts category. | |
| User-configurable visibility | Add a setting to toggle which category is visible. Power users can hide Scripts if they only work with extension points. | |

**User's choice:** Permanent coexistence (Recommended)

### Question 2: How should existing script commands (run, edit, publish, execute) adapt to the extension points model?

| Option | Description | Selected |
|--------|-------------|----------|
| Commands work on both node types (Recommended) | Existing commands (altium365.script.*) work on both script nodes (in Scripts category) and assignment nodes (in Extension Points category). Same command, different context. | ✓ |
| Separate command namespaces | Create new assignment-specific commands (altium365.assignment.*) and keep script commands unchanged. Explicit separation. | |
| New commands for Extension Points | Existing commands only work on script nodes. Extension Points tree uses new commands. Clean separation but requires users to learn new patterns. | |

**User's choice:** Commands work on both node types (Recommended)

### Question 3: How should GraphQL queries be structured for the dual-category model?

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel GraphQL queries (Recommended) | Add gloCusExtensionPoints + GloCusAssignment queries alongside existing gloScrScripts. Scripts category uses gloScrScripts; Extension Points uses gloCusExtensionPoints. Two data sources, one UI. | ✓ |
| Unified on extension points API | Migrate Scripts category to use gloCusExtensionPoints filtered by unassigned. Both categories use the same API surface. Single source of truth. | |
| Additive API only, no migration | Keep Scripts using gloScrScripts for now. Extension Points fetches gloCusExtensionPoints. Phase 10 adds the new API surface without touching existing queries. | |

**User's choice:** Parallel GraphQL queries (Recommended)

### Question 4: How should tree refresh work with both Scripts and Extension Points categories?

| Option | Description | Selected |
|--------|-------------|----------|
| Independent refresh (Recommended) | Refresh both categories independently. User refreshes Scripts → only Scripts re-queries. Refreshing Extension Points re-queries extension points + assignments. No cross-category sync needed. | ✓ |
| Synchronized refresh | Refreshing either category refreshes both. Keeps data consistent across categories but doubles API calls. | |
| Independent + global refresh | Add a global 'Refresh All' command that refreshes both. Individual category refresh only updates that category. | |

**User's choice:** Independent refresh (Recommended)

---

## the agent's Discretion

- The exact GraphQL query structure for `gloCusExtensionPoints` and `GloCusAssignment`
- Icon choices for specific entity types and extension point types
- Tooltip formatting details
- GraphQL error handling strategy
- Caching strategy for extension points and assignments
- Context menu item ordering

## Deferred Ideas

None — all scope remained within Phase 10 boundaries.
