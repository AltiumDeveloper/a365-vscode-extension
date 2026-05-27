# Phase 10: Rework sidebar around extension points - Research

**Researched:** 2026-05-27
**Domain:** VS Code TreeDataProvider extension, GraphQL API integration, multi-level tree hierarchies
**Confidence:** MEDIUM

## Summary

Phase 10 introduces a new tree organization model that shifts from a script-centric view to an extension-points-and-assignments model. The sidebar will present extension points (customizable product surfaces) organized by entity type and extension point type, with assignments nested underneath. This requires extending the existing `A365TreeDataProvider` to handle 3-4 level deep hierarchies (Workspace → Extension Points Category → Entity Type → EP Type → Extension Point → Assignments) while preserving the existing Scripts category as a parallel view.

The research confirms that VS Code's `TreeDataProvider` API natively supports arbitrary-depth hierarchies through recursive `getChildren` calls, and the existing codebase already demonstrates the core patterns needed (discriminated union node types, selective caching, contextValue-based menu gating). The primary technical challenge is designing the GraphQL queries for `gloCusExtensionPoints` and `GloCusAssignment` data, as no official Altium 365 GraphQL schema documentation is publicly available — these queries will need to be verified against a live A365 instance during planning or early execution.

**Primary recommendation:** Extend the existing `A365Node` union type with five new node kinds (`extensionPointsCategory`, `entityTypeGroupNode`, `epTypeGroupNode`, `extensionPointNode`, `assignmentNode`), implement grouping logic in `getChildren`, and reuse the established caching/refresh patterns. Use distinct VS Code ThemeIcons per entity/EP type for visual differentiation. Preserve full backward compatibility by keeping Scripts and Extension Points as independent sibling categories under each workspace.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Extension point enumeration | API / Backend | — | GraphQL `gloCusExtensionPoints` query returns structured extension point metadata from A365 backend |
| Assignment enumeration | API / Backend | — | Assignments are fetched via GraphQL as part of extension point data or separate query |
| Tree hierarchy construction | Frontend Server (Extension Host) | — | VS Code extension's `TreeDataProvider.getChildren` builds the 4-level hierarchy from GraphQL data |
| Assignment → Script resolution | Frontend Server (Extension Host) | API / Backend | Extension resolves `GloCusScriptAssignment.script` reference; backend provides script metadata via existing `gloScrScript` query |
| Script editing/execution | Frontend Server (Extension Host) | API / Backend | Existing script command handlers (`scriptCommands.ts`) adapted to work with assignment nodes; execution flows through existing `remoteExecution.ts` |
| Icon rendering | Browser / Client | — | VS Code renders ThemeIcons in the tree view based on `TreeItem.iconPath` returned by the extension |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

**D-01:** Extension Points and Scripts coexist as sibling categories under each workspace. Both are permanent — no migration or deprecation planned.

**D-02:** Within the Extension Points category, use a 2-level hierarchy: Extension Points → Assignments. Clicking an assignment opens the assigned script (for `GloCusScriptAssignment` type).

**D-03:** Scripts category shows all scripts (remains the authoritative list). Extension Points category shows only scripts that are assigned to extension points. Unassigned scripts do not appear in the Extension Points tree.

**D-04:** Extension points are organized by **Entity Type → EP Type → Extension Points**. Example tree structure: Projects → UIAction.ContextMenu (3 extension points), Projects → Event (2 extension points), BOM → BOM.Checks (1 extension point).

**D-05:** Extension point tree items use the `name` field from the GraphQL API for human-readable labels. Show assignment count in parentheses following the existing pattern: "Order Status Changed (2)".

**D-06:** Extension point `description` field appears in the tree item tooltip. Provides context about what the extension point does when user hovers.

**D-07:** Use distinct icons for entity types and extension point types. Examples: Project = folder icon, BOM = list-tree icon, Event = symbol-event icon, UIAction = symbol-method icon. Leverage VS Code ThemeIcons for consistency.

**D-08:** Assignment tree items use the `name` field from `GloCusAssignment` as the label.

**D-09:** Multiple assignment types exist in the GraphQL API: `GloCusScriptAssignment` (backed by a script), `GloCusWorkflowAssignment` (backed by a workflow), `GloCusDefaultAssignment` (default behavior). The `GloCusAssignment` type field differentiates these.

**D-10:** For `GloCusScriptAssignment` type: clicking the assignment node opens the assigned script for editing, reusing the existing script edit/save/run/debug flow. Existing script commands work on assignment nodes.

**D-11:** For other assignment types (`GloCusWorkflowAssignment`, `GloCusDefaultAssignment`): show in tree with different icons to differentiate from script assignments, but provide no actions for now. Future phases may add context menu items (e.g., open workflow in browser, start workflow).

**D-12:** Show extension point parameter expectations in the assignment tooltip. Helps user understand what the script receives when the extension point is triggered.

**D-13:** Do not show execution history or run status in the tree. Users continue to check logs in the Output Channel as before.

**D-14:** Coexistence is permanent. Extension Points and Scripts categories remain side-by-side indefinitely. Users can use whichever model fits their workflow.

**D-15:** Existing script commands (`altium365.script.*`) work on both script nodes (in Scripts category) and script assignment nodes (in Extension Points category). Same command surface, different node context.

**D-16:** GraphQL queries run in parallel: Scripts category uses `gloScrScripts`; Extension Points category uses `gloCusExtensionPoints`. Two data sources, one unified UI.

**D-17:** Tree refresh is independent per category. Refreshing Scripts re-queries only `gloScrScripts`. Refreshing Extension Points re-queries only `gloCusExtensionPoints` + assignments. No cross-category synchronization.

### Agent's Discretion

- The exact GraphQL query structure for `gloCusExtensionPoints` and `GloCusAssignment` (research will determine required fields and pagination strategy).
- Icon choices for specific entity types and extension point types, as long as they follow the "distinct icon per type" principle (D-07).
- Tooltip formatting for extension point descriptions and parameter expectations.
- How to handle GraphQL errors or missing extension points gracefully (error nodes vs empty state).
- Whether to cache extension points/assignments similarly to how projects and scripts are cached, or use a different caching strategy.
- The exact context menu items and their ordering for script assignments vs other assignment types.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. All ideas around workflow and default assignment actions were explicitly noted as out of scope for Phase 10 and deferred to future phases.

</user_constraints>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vscode` | ≥1.85.0 | VS Code Extension API | Project baseline; provides `TreeDataProvider`, `TreeItem`, `ThemeIcon`, `EventEmitter` for tree views |
| TypeScript | 5.4+ | Type-safe extension development | Project baseline; already configured with strict mode |
| Node.js | ≥20 | Runtime for extension host | Project baseline; required by VS Code extension host |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fetch` (native) | Built-in (Node 18+) | GraphQL HTTP requests | Already used in `workspace.ts` for all GraphQL calls; continue using for `gloCusExtensionPoints` queries |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual tree grouping | `vscode.TreeView.createTreeView` with `TreeDataProvider` | `TreeDataProvider` is the standard VS Code pattern; manual grouping would bypass established caching and refresh mechanisms |
| Custom icons (PNG/SVG files) | VS Code ThemeIcons (`symbol-event`, `symbol-method`, etc.) | ThemeIcons adapt to user's color theme automatically and are resolution-independent; custom icons require asset management |
| Single-query fetch (extension points + assignments in one GraphQL call) | Separate queries for extension points and assignments | Single query reduces round-trips but couples two concerns; decision deferred to planner based on GraphQL schema structure |

**Installation:**

No new dependencies required — all capabilities provided by existing VS Code API and project dependencies.

**Version verification:**

```bash
# Node.js (already verified)
node --version  # v22.16.0

# TypeScript (already verified)
npx tsc --version  # Version 5.4.0

# VS Code engine requirement
# package.json: "engines": { "vscode": "^1.85.0" }
```

All versions current and compatible.

## Package Legitimacy Audit

> Phase 10 installs no external packages — all work uses existing VS Code API and project dependencies. No slopcheck verification required.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                        │
│                         (Node.js)                                │
└────────────┬────────────────────────────────┬───────────────────┘
             │                                │
             ▼                                ▼
    ┌────────────────┐              ┌────────────────────┐
    │ TreeDataProvider│              │  GraphQL Queries   │
    │  getChildren()  │              │ gloCusExtension    │
    │  getTreeItem()  │◀─────────────│     Points         │
    │  refresh()      │   Data       │ GloCusAssignment   │
    └────────┬────────┘              └──────────┬─────────┘
             │                                  │
             │ Builds node hierarchy            │ Fetches data
             ▼                                  ▼
    ┌─────────────────────────────────────────────────────┐
    │              Tree Node Structure                     │
    │                                                      │
    │  Workspace                                           │
    │    ├── Projects (n)  [existing]                     │
    │    ├── Scripts (n)   [existing]                     │
    │    └── Extension Points (n)  [NEW]                  │
    │         ├── Entity Type: Projects                   │
    │         │    ├── EP Type: UIAction.ContextMenu      │
    │         │    │    └── EP: "Add Custom Field" (2)    │
    │         │    │         ├── Assignment: Script A     │
    │         │    │         └── Assignment: Script B     │
    │         │    └── EP Type: Event                     │
    │         │         └── EP: "Order Status Changed" (1)│
    │         │              └── Assignment: Script C     │
    │         └── Entity Type: BOM                        │
    │              └── EP Type: BOM.Checks                │
    │                   └── EP: "Validate Part Nums" (1)  │
    │                        └── Assignment: Script D     │
    └─────────────────────────────────────────────────────┘
             │
             │ User clicks assignment
             ▼
    ┌────────────────────────┐
    │ Script Command Handler │
    │ (scriptCommands.ts)    │
    │ - Edit Script          │
    │ - Execute Remotely     │
    │ - Run/Debug Local      │
    └────────────────────────┘
```

**Data flow:**

1. User expands workspace → `getChildren(workspace)` called
2. Extension returns three category nodes: Projects, Scripts, Extension Points
3. User expands Extension Points → `getChildren(extensionPointsCategory)` called
4. Extension queries `gloCusExtensionPoints` via GraphQL, groups by entity type → returns entity type nodes
5. User expands entity type → `getChildren(entityTypeGroupNode)` called → returns EP type nodes
6. User expands EP type → `getChildren(epTypeGroupNode)` called → returns extension point nodes
7. User expands extension point → `getChildren(extensionPointNode)` called → returns assignment nodes
8. User clicks assignment → `TreeItem.command` triggers `altium365.script.edit` with assignment node

### Recommended Project Structure

```
src/
├── sidePanel.ts         # TreeDataProvider (EXTEND with new node types)
├── workspace.ts         # GraphQL queries (ADD gloCusExtensionPoints queries)
├── scriptCommands.ts    # Script operations (EXTEND to handle assignment nodes)
├── treeCommands.ts      # Tree-generic commands (EXTEND for EP refresh)
├── auth.ts              # [unchanged]
├── remoteScriptFs.ts    # [unchanged]
├── remoteExecution.ts   # [unchanged]
└── extension.ts         # Command registration (REGISTER new tree commands if needed)
```

### Component Responsibilities

| Component | Current Responsibility | Phase 10 Extension |
|-----------|------------------------|-------------------|
| `sidePanel.ts` | Workspace → Projects/Scripts two-category tree | Add Extension Points as third category; implement entity/EP type grouping logic; add five new node kinds to `A365Node` union |
| `workspace.ts` | GraphQL queries for workspaces/projects/scripts | Add `listExtensionPoints` and `listAssignments` GraphQL query functions; maintain same error handling pattern |
| `scriptCommands.ts` | Script edit/execute/publish handlers for script nodes | Extend handlers to extract script reference from assignment nodes when `node.kind === 'assignment'` |
| `treeCommands.ts` | Tree refresh/copyId/openInBrowser | Add refresh handler for Extension Points category (mirrors existing Projects/Scripts refresh pattern) |
| `package.json` | Command/menu contributions | Add contextValue entries for new node types (`extensionPointNode`, `assignmentNode-script`, `assignmentNode-workflow`, `assignmentNode-default`); wire context menus |

### Pattern 1: Multi-Level Tree Hierarchy with Discriminated Union Nodes

**What:** Use a discriminated union type for tree nodes, where each variant carries the data needed for its level in the hierarchy. `getChildren` switches on `node.kind` to return the appropriate child nodes.

**When to use:** Any VS Code tree view with multiple node types or hierarchy levels.

**Example:**

```typescript
// Source: Existing pattern in src/sidePanel.ts (lines 28-52) + Phase 10 extension

export type A365Node =
    // Existing nodes
    | { kind: 'workspace'; info: WorkspaceInfo; workspaceUrl: string; url?: string }
    | { kind: 'projectsCategory'; workspaceId: string; workspaceAuthId: string; count: number }
    | { kind: 'scriptsCategory'; workspaceId: string; workspaceAuthId: string; workspaceUrl: string; count: number }
    | { kind: 'project'; workspaceId: string; project: ProjectInfo; url?: string }
    | { kind: 'script'; workspaceId: string; workspaceAuthId: string; workspaceUrl: string; script: ScriptInfo }
    // NEW Phase 10 nodes
    | { kind: 'extensionPointsCategory'; workspaceId: string; workspaceAuthId: string; workspaceUrl: string; count: number }
    | { kind: 'entityTypeGroupNode'; workspaceId: string; entityType: string; epCount: number }
    | { kind: 'epTypeGroupNode'; workspaceId: string; entityType: string; epType: string; epCount: number }
    | { kind: 'extensionPointNode'; workspaceId: string; extensionPoint: ExtensionPointInfo; assignmentCount: number }
    | { kind: 'assignmentNode'; workspaceId: string; workspaceAuthId: string; workspaceUrl: string; assignment: AssignmentInfo }
    // Existing utility nodes
    | { kind: 'info'; label: string }
    | { kind: 'error'; label: string; parent: A365Node | undefined };

// TreeDataProvider.getChildren implementation pattern
async getChildren(element?: A365Node): Promise<A365Node[]> {
    if (!element) {
        return await this.loadWorkspaces();
    }
    if (element.kind === 'workspace') {
        return await this.loadWorkspaceChildren(element);  // Returns 3 categories
    }
    if (element.kind === 'extensionPointsCategory') {
        return this.loadEntityTypeGroups(element);  // Group extension points by entity type
    }
    if (element.kind === 'entityTypeGroupNode') {
        return this.loadEpTypeGroups(element);  // Group by EP type within entity
    }
    if (element.kind === 'epTypeGroupNode') {
        return this.loadExtensionPoints(element);  // List extension points of this type
    }
    if (element.kind === 'extensionPointNode') {
        return this.loadAssignments(element);  // List assignments for this EP
    }
    return [];
}
```

**Why this pattern:** Type-safe hierarchy traversal; each node carries exactly the context needed for its children; compiler enforces exhaustive handling of all node kinds.

### Pattern 2: Selective Caching with Independent Category Refresh

**What:** Cache data at the workspace level (one cache map per category), keyed by `workspaceId`. Category refresh clears only that category's cache and fires `onDidChangeTreeData` for the parent workspace node.

**When to use:** Multi-category tree views where categories have independent data sources and users expect to refresh them independently.

**Example:**

```typescript
// Source: Existing pattern in src/sidePanel.ts (lines 58-107) + Phase 10 extension

export class A365TreeDataProvider implements vscode.TreeDataProvider<A365Node> {
    private _onDidChange = new vscode.EventEmitter<A365Node | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChange.event;

    // Existing caches
    private workspacesCache?: A365Node[];
    private projectsCache = new Map<string, A365Node[]>();
    private scriptsCache = new Map<string, A365Node[]>();
    
    // NEW Phase 10 caches
    private extensionPointsCache = new Map<string, ExtensionPointInfo[]>();  // Raw GraphQL data
    private assignmentsCache = new Map<string, Map<string, AssignmentInfo[]>>();  // Keyed by workspaceId → extensionPointId → assignments

    refresh(node?: A365Node): void {
        if (!node) {
            // Global refresh — clear all caches
            this.workspacesCache = undefined;
            this.projectsCache.clear();
            this.scriptsCache.clear();
            this.extensionPointsCache.clear();
            this.assignmentsCache.clear();
            this._onDidChange.fire(undefined);
            return;
        }
        if (node.kind === 'extensionPointsCategory') {
            // D-17: Refresh only Extension Points category — clear only EP caches, bubble to parent workspace
            this.extensionPointsCache.delete(node.workspaceId);
            this.assignmentsCache.delete(node.workspaceId);
            const parent = this.workspacesCache?.find(
                (w): w is Extract<A365Node, { kind: 'workspace' }> =>
                    w.kind === 'workspace' && w.info.workspaceId === node.workspaceId
            );
            this._onDidChange.fire(parent);
            return;
        }
        // ... existing refresh logic for projectsCategory, scriptsCategory
    }
}
```

**Why this pattern:** D-17 requires independent refresh per category; bubbling to parent workspace ensures category count labels update; established pattern reduces risk.

### Pattern 3: ThemeIcon Strategy for Visual Differentiation

**What:** Use distinct VS Code ThemeIcons for each entity type and extension point type, with optional ThemeColor for inactive/disabled states.

**When to use:** Tree views where visual grouping aids navigation (entity types, file types, status indicators).

**Example:**

```typescript
// Source: Existing pattern in src/sidePanel.ts (lines 109-214) + D-07 guidance

getTreeItem(n: A365Node): vscode.TreeItem {
    switch (n.kind) {
        case 'entityTypeGroupNode': {
            const item = new vscode.TreeItem(
                `${n.entityType} (${n.epCount})`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            // D-07: Distinct icon per entity type
            const iconMap: Record<string, string> = {
                'Project': 'folder',
                'BOM': 'list-tree',
                'Workspace': 'workspace',
                'Library': 'library',
            };
            item.iconPath = new vscode.ThemeIcon(iconMap[n.entityType] || 'symbol-namespace');
            item.contextValue = 'entityTypeGroupNode';
            return item;
        }
        case 'epTypeGroupNode': {
            const item = new vscode.TreeItem(
                `${n.epType} (${n.epCount})`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            // D-07: Distinct icon per EP type
            const iconMap: Record<string, string> = {
                'UIAction.ContextMenu': 'symbol-method',
                'Event': 'symbol-event',
                'Project.ERC': 'checklist',
                'BOM.Checks': 'checklist',
            };
            item.iconPath = new vscode.ThemeIcon(iconMap[n.epType] || 'symbol-key');
            item.contextValue = 'epTypeGroupNode';
            return item;
        }
        case 'assignmentNode': {
            const item = new vscode.TreeItem(
                n.assignment.name,
                vscode.TreeItemCollapsibleState.None
            );
            // D-09/D-11: Different icons per assignment type
            if (n.assignment.type === 'GloCusScriptAssignment') {
                item.iconPath = new vscode.ThemeIcon('file-code');
                item.contextValue = 'assignmentNode-script';
                // D-10: Click opens script for editing
                item.command = {
                    command: 'altium365.script.edit',
                    title: 'Edit Script',
                    arguments: [n],
                };
            } else if (n.assignment.type === 'GloCusWorkflowAssignment') {
                item.iconPath = new vscode.ThemeIcon('workflow', new vscode.ThemeColor('descriptionForeground'));
                item.contextValue = 'assignmentNode-workflow';
                // D-11: No command — future phase adds workflow actions
            } else if (n.assignment.type === 'GloCusDefaultAssignment') {
                item.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
                item.contextValue = 'assignmentNode-default';
                // D-11: No command — future phase adds default actions
            }
            // D-12: Tooltip shows parameter expectations
            item.tooltip = `${n.assignment.name}\n\nParameters: ${n.assignment.parametersSummary || 'none'}`;
            return item;
        }
        // ... existing cases
    }
}
```

**Why this pattern:** D-07 requires distinct icons; ThemeIcons adapt to user's color theme; existing codebase uses this pattern for workspace active/inactive states; VS Code provides 100+ built-in icons covering most entity/action types.

### Pattern 4: ContextValue-Based Menu Gating

**What:** Use `TreeItem.contextValue` as a string prefix/suffix to gate which context menu items appear for each node type. VS Code `package.json` `menus.view/item/context` entries use `when` clauses with regex or exact match.

**When to use:** Tree views with type-specific actions (e.g., script nodes have "Edit Script", workspace nodes have "Select Workspace").

**Example:**

```typescript
// Source: Existing pattern in package.json (lines 402-453) + Phase 10 extension

// In src/sidePanel.ts — assign contextValue per node type
case 'assignmentNode': {
    if (n.assignment.type === 'GloCusScriptAssignment') {
        item.contextValue = 'assignmentNode-script';
    } else if (n.assignment.type === 'GloCusWorkflowAssignment') {
        item.contextValue = 'assignmentNode-workflow';
    } else {
        item.contextValue = 'assignmentNode-default';
    }
    // ...
}

// In package.json — gate menu visibility per contextValue
{
  "menus": {
    "view/item/context": [
      {
        "command": "altium365.script.edit",
        "when": "view == altium365.tree && viewItem == assignmentNode-script",
        "group": "2_edit@1"
      },
      {
        "command": "altium365.script.executeRemote",
        "when": "view == altium365.tree && viewItem == assignmentNode-script",
        "group": "1_run@3"
      },
      {
        "command": "altium365.tree.copyId",
        "when": "view == altium365.tree && viewItem =~ /^assignmentNode/",
        "group": "9_clipboard@1"
      }
      // D-11: No actions for workflow/default assignment types in Phase 10
    ]
  }
}
```

**Why this pattern:** Established in existing codebase (workspaceNode-active vs workspaceNode-inactive); type-safe at runtime (TypeScript enforces contextValue assignment); regex `=~` operator supports prefix matching for shared actions across subtypes.

### Anti-Patterns to Avoid

- **Fetching extension points individually on expand:** Always fetch extension points in bulk for the workspace, then group client-side. Individual fetches cause N+1 query problems and slow tree expansion.
- **Mutating cached nodes after creation:** Node objects should be immutable after being returned from `getChildren`. If data changes, clear the cache and fire `onDidChangeTreeData` to trigger a fresh build.
- **Cross-category cache synchronization:** D-17 explicitly forbids synchronizing Scripts and Extension Points caches. Each category is an independent data source — do not attempt to deduplicate or cross-reference script nodes between the two.
- **Rebuilding the entire tree on category refresh:** The existing pattern (lines 82-105 in `sidePanel.ts`) bubbles refresh to the parent workspace node, which re-renders only that workspace's children. Global tree rebuild is unnecessary and causes collapse of all expanded workspaces.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grouping items in a tree hierarchy | Custom grouping algorithm with nested maps | Discriminated union + switch in `getChildren` | VS Code TreeDataProvider expects flat arrays per level; grouping logic is a pure transform of the flat data; TypeScript exhaustiveness checking catches missing cases |
| Icon asset management | Custom PNG/SVG icon files in `resources/` | VS Code ThemeIcons (`new vscode.ThemeIcon('symbol-event')`) | ThemeIcons adapt to user's color theme automatically; resolution-independent; no asset bundling; 100+ built-in icons cover most use cases |
| GraphQL query client | Custom fetch wrapper with retry/cache/batching | `workspace.ts` existing `graphqlRequest` helper | Already handles auth headers, error typing (`GraphQLError`), response parsing; Phase 2/3 patterns proven stable; adding a GraphQL client library is unnecessary complexity for simple queries |
| Tree refresh event emitter | Manual `vscode.window.createTreeView` refresh calls | `EventEmitter<A365Node \| undefined \| void>` + `onDidChangeTreeData` | VS Code expects `onDidChangeTreeData` event for tree refresh; manual `createTreeView` refresh bypasses the standard contract and breaks incremental updates |

**Key insight:** VS Code's TreeDataProvider API is designed for exactly this use case — multi-level hierarchies with lazy loading. The existing codebase already demonstrates all the patterns needed (discriminated unions, selective caching, contextValue gating). The only net-new work is defining the GraphQL query shape and implementing the grouping logic in `getChildren`.

## Runtime State Inventory

> Phase 10 is not a rename/refactor/migration phase — it adds a new tree category alongside existing ones. No runtime state needs updating. This section is omitted per protocol.

## Common Pitfalls

### Pitfall 1: GraphQL Schema Mismatch Between Environments

**What goes wrong:** Extension points and assignments may have different field names or structures across Dev/Uat/Prod environments if the GraphQL schema is still evolving. Queries that work in Dev may throw errors in Prod.

**Why it happens:** The Altium 365 GraphQL API is not publicly documented, and the `gloCusExtensionPoints` / `GloCusAssignment` schema may still be in active development. The extension supports three environments (Dev/Uat/Prod) via `altium365.selectEnvironment`, and schema drift between them is common during feature rollout.

**How to avoid:** 
1. Query only the minimal required fields in Phase 10 (name, description, type, assignmentCount for extension points; name, type, script reference for assignments).
2. Use optional chaining (`?.`) when accessing nested GraphQL response fields.
3. Add schema version detection if possible (e.g., query `__typename` to verify node types match expected values).
4. Test against all three environments (Dev/Uat/Prod) during execution, not just one.

**Warning signs:** 
- `GraphQLError` with message "Cannot query field X on type Y" when switching environments
- Extension points load in Dev but return empty in Prod
- Assignment nodes missing expected fields (script reference, parameters)

### Pitfall 2: N+1 Query Problem with Assignment Fetching

**What goes wrong:** If assignments are fetched individually per extension point (one GraphQL query per EP), expanding a workspace with 20 extension points triggers 20+ queries, causing slow tree expansion and rate limiting.

**Why it happens:** The natural implementation pattern is to fetch assignments in `getChildren(extensionPointNode)`, which is called once per extension point as the user expands the tree. This works for small workspaces but doesn't scale.

**How to avoid:**
1. Fetch all assignments for a workspace in a single query when loading the Extension Points category (similar to how `listProjects` and `listScripts` run in parallel in `loadWorkspaceChildren`).
2. Cache assignments in a nested map: `Map<workspaceId, Map<extensionPointId, AssignmentInfo[]>>`.
3. Return assignments from cache in `getChildren(extensionPointNode)` — zero additional queries.

**Warning signs:**
- Noticeable delay (>1 second) when expanding extension point nodes
- Network tab shows multiple GraphQL requests in rapid succession
- A365 backend returns 429 Too Many Requests errors

### Pitfall 3: Script Reference Resolution Failures

**What goes wrong:** An assignment node of type `GloCusScriptAssignment` references a script by ID, but the script may have been deleted or is inaccessible to the current user. Clicking the assignment node to edit the script throws "Script not found" errors.

**Why it happens:** Assignments are metadata links — they don't enforce referential integrity. A script can be deleted while assignments still reference it. The GraphQL API may return the assignment without validating the script exists.

**How to avoid:**
1. When fetching assignments, also fetch the referenced script's `name` and `description` (if the GraphQL schema supports nested selection).
2. If the script reference is broken, show the assignment node with a warning icon and tooltip ("Script not found — assignment may be stale").
3. Gracefully handle missing script references in command handlers: catch `getScript` errors and show a user-friendly message ("The script referenced by this assignment is no longer available").

**Warning signs:**
- Assignment nodes render with names like "undefined" or blank labels
- "Edit Script" command fails with "Script not found" for assignments that appear in the tree
- Tree refresh after deleting a script doesn't update assignment nodes

### Pitfall 4: Cache Staleness After Remote Modifications

**What goes wrong:** User modifies an assignment or extension point in the A365 web UI (outside the VS Code extension), but the tree continues showing stale data because the cache wasn't invalidated.

**Why it happens:** The extension caches extension points and assignments per workspace, but has no way to detect when those entities change remotely. Unlike scripts (which have explicit "Publish Script" actions), assignments may be modified in the web UI without the extension knowing.

**How to avoid:**
1. Provide a clear "Refresh Extension Points" action (mirroring the existing "Refresh Workspaces" in `view/title` menu).
2. Document in tooltips or README that the tree is a snapshot — users must manually refresh to see remote changes.
3. Consider adding a timestamp or ETag to the cache and auto-refreshing if the cache is >5 minutes old (optional enhancement, not required for Phase 10).

**Warning signs:**
- User reports "I added an assignment in the web UI but it's not showing in VS Code"
- Assignment count labels (e.g., "Order Status Changed (2)") don't update after modifying assignments remotely
- Deleting an assignment in the web UI leaves it visible in the extension tree

### Pitfall 5: Tooltip Overflow with Long Parameter Lists

**What goes wrong:** Extension points with many parameters (10+ fields) generate tooltips hundreds of characters long, which VS Code truncates or renders poorly as a single-line hover.

**Why it happens:** D-12 requires showing parameter expectations in assignment tooltips, but the GraphQL API may return parameter schemas as long JSON blobs or verbose type descriptions.

**How to avoid:**
1. Summarize parameters in the tooltip (e.g., "Parameters: projectId, userId, status (3 total)") instead of listing full parameter schemas.
2. Use multi-line tooltips with `\n` separators for readability (VS Code supports this).
3. If the parameter list is very long, truncate at 5 parameters and append "… and N more" to keep tooltips scannable.

**Warning signs:**
- Tooltips render as unreadable single-line strings 200+ characters long
- Hovering over assignment nodes shows "[object Object]" in the tooltip (forgot to serialize parameter data)
- User feedback: "I can't read the parameter expectations because the tooltip is too long"

## Code Examples

Verified patterns from the existing codebase and VS Code Extension API documentation:

### Pattern 1: Adding a New Category to Workspace Children

```typescript
// Source: Existing pattern in src/sidePanel.ts (loadWorkspaceChildren, lines 274-326)
// Extended for Phase 10 Extension Points category

private async loadWorkspaceChildren(
    element: Extract<A365Node, { kind: 'workspace' }>
): Promise<A365Node[]> {
    const workspaceId = element.info.workspaceId;
    const wsToken = await ensureWorkspaceToken(this.ctx, readOAuthConfig(), {
        workspaceId,
        authId: element.info.authId,
    });
    const endpoint = getWorkspaceApiUrl(element.info, this.getEndpoint());
    
    // D-16: Run all category queries in parallel
    const [projects, scripts, extensionPoints] = await Promise.all([
        listProjects(endpoint, wsToken),
        listScripts(endpoint, wsToken),
        listExtensionPoints(endpoint, wsToken),  // NEW Phase 10 query
    ]);
    
    // Build and cache category children
    const projectNodes: A365Node[] = projects.map(/* ... */);
    const scriptNodes: A365Node[] = scripts.map(/* ... */);
    
    this.projectsCache.set(workspaceId, projectNodes);
    this.scriptsCache.set(workspaceId, scriptNodes);
    this.extensionPointsCache.set(workspaceId, extensionPoints);  // Store raw EP data
    
    // D-01: Return three category siblings
    return [
        {
            kind: 'projectsCategory',
            workspaceId,
            workspaceAuthId: element.info.authId,
            count: projectNodes.length,
        },
        {
            kind: 'scriptsCategory',
            workspaceId,
            workspaceAuthId: element.info.authId,
            workspaceUrl: element.workspaceUrl,
            count: scriptNodes.length,
        },
        {
            kind: 'extensionPointsCategory',
            workspaceId,
            workspaceAuthId: element.info.authId,
            workspaceUrl: element.workspaceUrl,
            count: extensionPoints.length,
        },
    ];
}
```

### Pattern 2: Grouping Extension Points by Entity Type

```typescript
// NEW Phase 10 logic — group extension points by entity type

private loadEntityTypeGroups(
    element: Extract<A365Node, { kind: 'extensionPointsCategory' }>
): A365Node[] {
    const extensionPoints = this.extensionPointsCache.get(element.workspaceId) || [];
    
    // D-04: Group by entity type
    const grouped = new Map<string, ExtensionPointInfo[]>();
    for (const ep of extensionPoints) {
        const entityType = ep.entityType || 'Other';
        if (!grouped.has(entityType)) {
            grouped.set(entityType, []);
        }
        grouped.get(entityType)!.push(ep);
    }
    
    // Return entity type group nodes sorted alphabetically
    return Array.from(grouped.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([entityType, eps]): A365Node => ({
            kind: 'entityTypeGroupNode',
            workspaceId: element.workspaceId,
            entityType,
            epCount: eps.length,
        }));
}
```

### Pattern 3: Extending Script Commands to Handle Assignment Nodes

```typescript
// Source: Existing pattern in src/scriptCommands.ts (script.edit handler)
// Extended for Phase 10 assignment node support

export function registerScriptCommands(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    const editScriptHandler = async (node: A365Node) => {
        // D-15: Support both script nodes (Scripts category) and assignment nodes (Extension Points category)
        let scriptId: string;
        let workspaceAuthId: string;
        let workspaceUrl: string;
        
        if (node.kind === 'script') {
            // Existing path — clicked a script in Scripts category
            scriptId = node.script.scriptId;
            workspaceAuthId = node.workspaceAuthId;
            workspaceUrl = node.workspaceUrl;
        } else if (node.kind === 'assignmentNode') {
            // NEW Phase 10 path — clicked an assignment in Extension Points category
            if (node.assignment.type !== 'GloCusScriptAssignment') {
                // D-11: Only script assignments are editable in Phase 10
                vscode.window.showWarningMessage('This assignment type is not editable yet.');
                return;
            }
            scriptId = node.assignment.scriptId;  // Assumed field from GraphQL assignment
            workspaceAuthId = node.workspaceAuthId;
            workspaceUrl = node.workspaceUrl;
        } else {
            vscode.window.showErrorMessage('Invalid node type for Edit Script.');
            return;
        }
        
        // Existing edit flow (unchanged)
        const uri = vscode.Uri.parse(
            `altium365://${workspaceAuthId}/${scriptId}.py?workspaceUrl=${encodeURIComponent(workspaceUrl)}`
        );
        await vscode.window.showTextDocument(uri);
    };
    
    return [
        vscode.commands.registerCommand('altium365.script.edit', editScriptHandler),
        // ... other script commands
    ];
}
```

### Pattern 4: GraphQL Query for Extension Points

```typescript
// NEW Phase 10 query in src/workspace.ts
// NOTE: Field names are ASSUMED based on context — must verify against live A365 GraphQL schema

export interface ExtensionPointInfo {
    extensionPointId: string;
    name: string;
    description?: string;
    entityType: string;  // e.g., "Project", "BOM", "Workspace"
    type: string;        // e.g., "UIAction.ContextMenu", "Event", "Project.ERC"
    assignmentCount?: number;  // Optional — may need separate query
}

export interface AssignmentInfo {
    assignmentId: string;
    name: string;
    type: 'GloCusScriptAssignment' | 'GloCusWorkflowAssignment' | 'GloCusDefaultAssignment';
    scriptId?: string;         // Present only if type === 'GloCusScriptAssignment'
    workflowId?: string;       // Present only if type === 'GloCusWorkflowAssignment'
    parametersSummary?: string; // D-12: Human-readable parameter expectations
}

const LIST_EXTENSION_POINTS_QUERY = `
    query ListExtensionPoints {
        gloCusExtensionPoints(first: 100) {
            nodes {
                extensionPointId
                name
                description
                entityType
                type
                assignments {
                    nodes {
                        assignmentId
                        name
                        type
                        scriptId
                        workflowId
                        parametersSummary
                    }
                }
            }
        }
    }
`;

export async function listExtensionPoints(
    endpoint: string,
    workspaceToken: string
): Promise<ExtensionPointInfo[]> {
    const data = await graphqlRequest(endpoint, workspaceToken, LIST_EXTENSION_POINTS_QUERY);
    const nodes = data?.gloCusExtensionPoints?.nodes;
    if (!Array.isArray(nodes)) {
        return [];
    }
    // Transform and cache assignments separately
    return nodes.map((node: any) => ({
        extensionPointId: node.extensionPointId,
        name: node.name,
        description: node.description,
        entityType: node.entityType,
        type: node.type,
        assignmentCount: node.assignments?.nodes?.length || 0,
    }));
}
```

**IMPORTANT:** The above GraphQL query structure is **[ASSUMED]** — no official Altium 365 GraphQL documentation is publicly available. Field names, nesting structure, and pagination parameters MUST be verified against a live A365 instance during planning or Wave 0 execution. The planner should add a checkpoint task: "Verify `gloCusExtensionPoints` schema via GraphQL introspection query against Dev environment."

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Script-centric sidebar (all remote scripts in flat list) | Extension-points-centric sidebar (scripts shown under assigned extension points, with Scripts category as parallel authoritative list) | Phase 10 (2026-05-27) | Users can now discover where scripts are used in the A365 product surface, not just that they exist; Scripts category preserves existing workflow for users who prefer script-first navigation |
| Single category per workspace (Projects or Scripts) | Three categories per workspace (Projects, Scripts, Extension Points) | Phase 10 (2026-05-27) | Increases tree depth but aligns with A365's domain model; users choose which category fits their mental model |

**Deprecated/outdated:**

- **Script-only tree model (Phase 2-9):** Not deprecated — Scripts category remains as a parallel view. Extension Points is additive, not a replacement.
- **Two-level tree hierarchy (Workspace → Category → Items):** Extended to 4+ levels in Extension Points category (Workspace → Extension Points → Entity Type → EP Type → Extension Point → Assignment). Projects and Scripts categories remain 3 levels.

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GraphQL query `gloCusExtensionPoints` returns fields: `extensionPointId`, `name`, `description`, `entityType`, `type`, `assignments { nodes { ... } }` | Code Examples (Pattern 4) | Query fails at runtime; must be rewritten during Wave 0 after schema introspection |
| A2 | Assignment GraphQL type differentiates `GloCusScriptAssignment` / `GloCusWorkflowAssignment` / `GloCusDefaultAssignment` via a `type` field (not `__typename`) | Code Examples (Pattern 4) | Assignment type detection fails; menu gating breaks; must adjust to use `__typename` if that's the actual discriminator |
| A3 | Extension points have a stable `entityType` field with values like "Project", "BOM", "Workspace" | Code Examples (Pattern 2) | Grouping logic fails; must adjust to use a different field or hardcode entity type mapping |
| A4 | Assignments can be fetched as nested nodes under `gloCusExtensionPoints.assignments` (single query) rather than requiring separate queries per extension point | Code Examples (Pattern 4) | If nested fetch not supported, must implement separate `listAssignments(extensionPointId)` query and handle N+1 problem via batching |
| A5 | Script assignments carry a `scriptId` field that can be passed to the existing `getScript(endpoint, token, scriptId)` function | Code Examples (Pattern 3) | Script reference resolution fails; must determine the correct field name and adjust script command handlers |

**If this table is not empty:** All GraphQL API structure claims are ASSUMED and must be verified against a live A365 Dev/Uat environment during Wave 0 execution. The planner MUST add a checkpoint task: "Verify GraphQL schema for `gloCusExtensionPoints` and `GloCusAssignment` via introspection query or live testing."

## Open Questions

1. **GraphQL schema structure for extension points and assignments**
   - What we know: Context mentions `gloCusExtensionPoints` and `GloCusAssignment` types exist in the A365 GraphQL API
   - What's unclear: Exact field names, nesting structure, pagination strategy, whether assignments are nested or require separate queries
   - Recommendation: Add Wave 0 task to run GraphQL introspection query against Dev environment and verify all field names before implementing queries. If introspection is blocked, implement with best-guess schema and add checkpoint for human verification before merging.

2. **Assignment parameter schema format**
   - What we know: D-12 requires showing parameter expectations in assignment tooltips
   - What's unclear: How parameters are represented in the GraphQL response (JSON schema? List of key/type pairs? Prose description?)
   - Recommendation: If parameter schema is complex (nested JSON), implement a simple serializer that converts it to human-readable format (e.g., "projectId (string), status (enum), reason (optional string)"). If format is unknown, show raw JSON in Wave 0 and refine based on UAT feedback.

3. **Entity type and EP type enumeration**
   - What we know: D-04 specifies entity types like "Project", "BOM"; EP types like "UIAction.ContextMenu", "Event"
   - What's unclear: Full enumeration of possible values, whether these are free-text or constrained enums in the GraphQL schema
   - Recommendation: Do not hardcode entity/EP type icon mappings for all possible values. Use a default icon for unmapped types (`symbol-namespace` for entity types, `symbol-key` for EP types) and add specific mappings as users encounter them in UAT.

4. **Cross-workspace extension points**
   - What we know: Extension points are queried per workspace (similar to scripts)
   - What's unclear: Whether extension points can reference scripts from a different workspace, and how to handle that in the tree
   - Recommendation: Assume same-workspace references for Phase 10. If a cross-workspace reference is encountered, show an error node or grayed-out assignment with tooltip "Script in different workspace — not supported yet."

## Environment Availability

> Phase 10 has no external dependencies beyond the existing project stack (Node.js, TypeScript, VS Code Extension API). All tools are already verified in the project baseline. This section is omitted per protocol.

## Validation Architecture

> `workflow.nyquist_validation` is explicitly set to `false` in `.planning/config.json`. This section is omitted per protocol.

## Security Domain

> `security_enforcement` is not explicitly set in `.planning/config.json`, so it defaults to enabled. However, Phase 10 does not introduce new attack surfaces — it extends an existing GraphQL query pattern already proven secure in Phases 2-3. No new ASVS categories apply beyond those already addressed in the auth/workspace layers. This section is included for completeness but flags no new threats.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | OAuth2 PKCE already implemented in `auth.ts` (Phase 1) |
| V3 Session Management | no | Token storage via `context.secrets` already implemented (Phase 1) |
| V4 Access Control | yes | Workspace-scoped tokens enforce access control at GraphQL layer (Phase 2) |
| V5 Input Validation | yes | GraphQL responses validated via type checking; untrusted fields (name, description) never executed as code |
| V6 Cryptography | no | No new cryptographic operations in Phase 10 |

### Known Threat Patterns for VS Code Extension + GraphQL

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious GraphQL response injection (XSS in tree labels) | Tampering / Information Disclosure | VS Code TreeItem labels are plain text (not HTML) — no XSS risk. Tooltips support Markdown but are not executable. |
| Untrusted extension point names cause command injection | Tampering | Extension point names are displayed only, never passed to shell or eval. Script IDs passed to commands are validated by GraphQL schema. |
| Missing workspace token allows accessing other workspaces' extension points | Elevation of Privilege | Workspace token scoping enforced by existing `ensureWorkspaceToken` + `getWorkspaceApiUrl` pattern (Phase 2.3 D-19) — Phase 10 reuses this unchanged. |

**Conclusion:** Phase 10 introduces no new security threats. All data flows through the existing auth/workspace layers, which are already hardened against common threats. Extension point names and descriptions are display-only (no code execution), and workspace token scoping prevents cross-workspace access.

## Sources

### Primary (HIGH confidence)

- VS Code Extension API documentation (TreeDataProvider, TreeItem, ThemeIcon, EventEmitter) — verified via existing codebase patterns in `src/sidePanel.ts` and `package.json` contributions
- Existing project codebase (`src/sidePanel.ts`, `src/workspace.ts`, `package.json`) — demonstrates all core patterns needed for Phase 10 (discriminated unions, selective caching, contextValue gating, parallel GraphQL queries)
- `.planning/phases/10-rework-sidebar-around-extension-points/10-CONTEXT.md` — locked user decisions from discuss-phase (D-01 through D-17)
- `.planning/REQUIREMENTS.md` — project requirements and existing PANEL-* / SCRIPT-* requirements that Phase 10 extends

### Secondary (MEDIUM confidence)

- VS Code ThemeIcon documentation (icon name reference) — verified via existing usage in `src/sidePanel.ts` (lines 135-142, 152, 161, 170, 179, 198, 206) and VS Code Icon Reference (https://code.visualstudio.com/api/references/icons-in-labels) [CITED: code.visualstudio.com]
- TypeScript discriminated union patterns — verified via existing `A365Node` type (lines 28-52 in `src/sidePanel.ts`)

### Tertiary (LOW confidence)

- GraphQL schema structure for `gloCusExtensionPoints` and `GloCusAssignment` — **[ASSUMED]** based on field names mentioned in CONTEXT.md and todo capture; no official Altium 365 GraphQL documentation publicly available; MUST be verified during Wave 0 execution

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - All dependencies verified in existing codebase; no new packages required
- Architecture: HIGH - All patterns demonstrated in existing `sidePanel.ts` and `workspace.ts`; extension is incremental, not greenfield
- Pitfalls: MEDIUM - Pitfalls derived from common tree view and GraphQL integration patterns; specific to A365 extension points is ASSUMED until verified
- GraphQL API structure: LOW - No official schema documentation; field names and query structure ASSUMED based on context mentions; user MUST verify during Wave 0

**Research date:** 2026-05-27
**Valid until:** 30 days (2026-06-26) — VS Code Extension API is stable; GraphQL schema may evolve but user will verify current schema during execution
