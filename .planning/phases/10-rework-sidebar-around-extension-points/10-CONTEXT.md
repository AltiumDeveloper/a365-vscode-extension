# Phase 10: Rework sidebar around extension points - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 10 reframes the remote customization UX from a script-centric model to an **extension-points-and-assignments model**. The sidebar will shift to presenting extension points (product surfaces that can be customized) organized by entity type and extension point type, with assignments nested underneath. This aligns the VS Code extension with Altium 365's actual customization domain model exposed via `gloCusExtensionPoints` and `GloCusAssignment` GraphQL APIs.

The phase preserves the existing Scripts category as a parallel, authoritative script list during and after the transition. Both categories coexist permanently: Scripts shows all scripts (business as usual), while Extension Points shows the assignment-centric organization.

Existing script operations (edit, publish, execute, run, debug) extend to work on script assignments in the Extension Points tree, with type-aware behavior for different assignment types (`GloCusScriptAssignment`, `GloCusWorkflowAssignment`, `GloCusDefaultAssignment`).

Out of scope: removing or deprecating the Scripts category, adding workflow or default assignment actions (deferred to future phases), changing how scripts themselves are authored or executed, redesigning the GraphQL API surface.

</domain>

<decisions>
## Implementation Decisions

### Tree hierarchy and navigation
- **D-01:** Extension Points and Scripts coexist as sibling categories under each workspace. Both are permanent — no migration or deprecation planned.
- **D-02:** Within the Extension Points category, use a 2-level hierarchy: Extension Points → Assignments. Clicking an assignment opens the assigned script (for `GloCusScriptAssignment` type).
- **D-03:** Scripts category shows all scripts (remains the authoritative list). Extension Points category shows only scripts that are assigned to extension points. Unassigned scripts do not appear in the Extension Points tree.

### Extension point presentation
- **D-04:** Extension points are organized by **Entity Type → EP Type → Extension Points**. Example tree structure: Projects → UIAction.ContextMenu (3 extension points), Projects → Event (2 extension points), BOM → BOM.Checks (1 extension point).
- **D-05:** Extension point tree items use the `name` field from the GraphQL API for human-readable labels. Show assignment count in parentheses following the existing pattern: "Order Status Changed (2)".
- **D-06:** Extension point `description` field appears in the tree item tooltip. Provides context about what the extension point does when user hovers.
- **D-07:** Use distinct icons for entity types and extension point types. Examples: Project = folder icon, BOM = list-tree icon, Event = symbol-event icon, UIAction = symbol-method icon. Leverage VS Code ThemeIcons for consistency.

### Assignment and script relationship
- **D-08:** Assignment tree items use the `name` field from `GloCusAssignment` as the label.
- **D-09:** Multiple assignment types exist in the GraphQL API: `GloCusScriptAssignment` (backed by a script), `GloCusWorkflowAssignment` (backed by a workflow), `GloCusDefaultAssignment` (default behavior). The `GloCusAssignment` type field differentiates these.
- **D-10:** For `GloCusScriptAssignment` type: clicking the assignment node opens the assigned script for editing, reusing the existing script edit/save/run/debug flow. Existing script commands work on assignment nodes.
- **D-11:** For other assignment types (`GloCusWorkflowAssignment`, `GloCusDefaultAssignment`): show in tree with different icons to differentiate from script assignments, but provide no actions for now. Future phases may add context menu items (e.g., open workflow in browser, start workflow).
- **D-12:** Show extension point parameter expectations in the assignment tooltip. Helps user understand what the script receives when the extension point is triggered.
- **D-13:** Do not show execution history or run status in the tree. Users continue to check logs in the Output Channel as before.

### Migration and backward compatibility
- **D-14:** Coexistence is permanent. Extension Points and Scripts categories remain side-by-side indefinitely. Users can use whichever model fits their workflow.
- **D-15:** Existing script commands (`altium365.script.*`) work on both script nodes (in Scripts category) and script assignment nodes (in Extension Points category). Same command surface, different node context.
- **D-16:** GraphQL queries run in parallel: Scripts category uses `gloScrScripts`; Extension Points category uses `gloCusExtensionPoints`. Two data sources, one unified UI.
- **D-17:** Tree refresh is independent per category. Refreshing Scripts re-queries only `gloScrScripts`. Refreshing Extension Points re-queries only `gloCusExtensionPoints` + assignments. No cross-category synchronization.

### the agent's Discretion
- The exact GraphQL query structure for `gloCusExtensionPoints` and `GloCusAssignment` (research will determine required fields and pagination strategy).
- Icon choices for specific entity types and extension point types, as long as they follow the "distinct icon per type" principle (D-07).
- Tooltip formatting for extension point descriptions and parameter expectations.
- How to handle GraphQL errors or missing extension points gracefully (error nodes vs empty state).
- Whether to cache extension points/assignments similarly to how projects and scripts are cached, or use a different caching strategy.
- The exact context menu items and their ordering for script assignments vs other assignment types.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current tree implementation
- `src/sidePanel.ts` — Current `TreeDataProvider` implementation; shows workspace → Projects/Scripts two-category pattern; defines `A365Node` union type, caching strategy, and refresh behavior
- `src/treeCommands.ts` — Tree-generic command handlers (refresh, open in browser, etc.); pattern for registering tree commands
- `package.json` (view/item/context contributions) — Context menu wiring for tree nodes; shows how `contextValue` gates menu visibility

### GraphQL integration
- `src/workspace.ts` — GraphQL query patterns (`graphqlRequest` helper, `listWorkspaces`, `listProjects`, `listScripts`); pattern for querying A365 GraphQL API with workspace tokens
- `src/auth.ts` — Workspace token management (`ensureWorkspaceToken`, `getBaseAccessToken`); required for authenticated GraphQL calls

### Existing script operations
- `src/scriptCommands.ts` — Script command handlers (run, debug, edit, publish, execute); these commands must extend to work on assignment nodes
- `src/remoteScriptFs.ts` — Virtual file system for remote scripts; edit/save flow that script assignments will reuse
- `src/remoteExecution.ts` — Remote script execution + log streaming; execution flow that may apply to script assignments triggered from extension points

### Project context
- `.planning/todos/pending/2026-05-26-rework-sidebar-around-extension-points.md` — Original problem statement capturing the shift from script-centric to extension-point-centric model
- `.planning/ROADMAP.md` — Phase 10 entry and milestone context
- `.planning/STATE.md` — Current project decisions including sidebar tree patterns from prior phases
- `.planning/codebase/ARCHITECTURE.md` — Extension layering and tree provider patterns
- `.planning/codebase/CONVENTIONS.md` — Command/config/error-handling conventions to preserve when extending tree functionality
- `AGENTS.md` — Project-specific guidelines for the extension

### External specs
- No external ADRs or specs were referenced during discussion. The GraphQL API shape (`gloCusExtensionPoints`, `GloCusAssignment`, `GloCusScriptAssignment`, `GloCusWorkflowAssignment`, `GloCusDefaultAssignment`) is the authoritative spec, documented in Altium 365 platform API docs (URL TBD by research).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `A365TreeDataProvider` in `src/sidePanel.ts` — TreeDataProvider pattern with caching (`workspacesCache`, `projectsCache`, `scriptsCache`) and selective refresh. Extension Points category will add `extensionPointsCache` and `assignmentsCache` following the same pattern.
- `A365Node` union type — Discriminated union for tree nodes (`workspace`, `projectsCategory`, `scriptsCategory`, `project`, `script`, `info`, `error`). Phase 10 adds `extensionPointsCategory`, `entityTypeGroupNode`, `epTypeGroupNode`, `extensionPointNode`, `assignmentNode` variants.
- `graphqlRequest` helper in `src/workspace.ts` — Reusable GraphQL query function. Phase 10 queries (`gloCusExtensionPoints`, assignments) use this same helper with workspace tokens.
- Context menu wiring pattern in `package.json` — `contextValue` prefix (e.g., `workspaceNode-active`, `scriptNode`) gates menu item visibility. Phase 10 adds `assignmentNode-script`, `assignmentNode-workflow`, `assignmentNode-default` contextValues.

### Established Patterns
- Two-category tree structure (Projects + Scripts) established in Phase 2. Phase 10 adds Extension Points as a third category following the same collapsible-category pattern.
- Active workspace visual cue (circle-filled icon for active, cloud icon for inactive) — Phase 10 may apply similar cues to show which assignment is currently being edited or recently executed.
- Refresh strategy: category-level refresh clears only that category's cache and fires `onDidChangeTreeData` for the parent workspace node. Phase 10 follows the same selective refresh pattern for Extension Points.
- Command reuse: existing commands like `altium365.script.edit`, `altium365.script.execute` check node kind and adapt behavior. Phase 10 extends these to also check for `assignmentNode` kind.

### Integration Points
- `src/sidePanel.ts` `getChildren` method — Where tree hierarchy is built. Phase 10 adds a branch for `extensionPointsCategory` → fetch extension points → group by entity/EP type → return assignment children.
- `src/scriptCommands.ts` command handlers — Where script actions are implemented. Phase 10 extends handlers to extract `script` from `assignmentNode` when the node is a `GloCusScriptAssignment`.
- `package.json` contributions — Where categories, context menus, and commands are declared. Phase 10 adds Extension Points category view, new contextValues, and potentially new commands.
- Workspace token exchange flow (`ensureWorkspaceToken`) — Extension Points queries require workspace-scoped tokens just like Projects and Scripts queries. No new auth mechanism needed.

</code_context>

<specifics>
## Specific Ideas

- Extension point API structure: `entityType` (Project, BOM, etc.), `type` (UIAction.ContextMenu, Event, Project.ERC, BOM.Checks, etc.), `name` (human-readable), `description` (for tooltips).
- Assignment API structure: `GloCusAssignment` has `name` and `type` fields. `type` differentiates `GloCusScriptAssignment`, `GloCusWorkflowAssignment`, `GloCusDefaultAssignment`.
- Tree organization: Group extension points first by entity type, then by extension point type, then show individual extension points, then show assignments underneath each extension point. This creates a logical hierarchy that mirrors how customization is structured in the A365 product.
- Icon strategy: Use distinct icons per entity type and per extension point type, leveraging VS Code ThemeIcons. This visual differentiation helps users quickly identify the type of extension point and assignment they're working with.
- Tooltip content: Extension point tooltips show the `description` field. Assignment tooltips show parameter expectations from the extension point definition.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. All ideas around workflow and default assignment actions were explicitly noted as out of scope for Phase 10 and deferred to future phases.

</deferred>

---

*Phase: 10-rework-sidebar-around-extension-points*
*Context gathered: 2026-05-27*
