# Phase 04: UI Polish - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Tighten the day-to-day surface of the Altium 365 side panel and command palette so labels, icons, and navigation feel coherent. Specifically: clean command titles, prune the palette to user-actionable commands, surface the current environment in the tree-view header, differentiate Projects vs Scripts category icons, strengthen the active-workspace visual cue, and expose a direct "Select" affordance on workspace tree nodes.

**Not in this phase:** Workspace favorites (deferred to backlog 999.2), progress feedback for async operations (Phase 05), any new GraphQL operations, any auth changes.

</domain>

<decisions>
## Implementation Decisions

### Command title & palette cleanup (item #1 + #3)
- **D-01:** Strip the literal `Altium 365: ` prefix from every `title` in `package.json` `contributes.commands[]`. Keep `category: "Altium 365"`. Result: Command Palette renders as `Altium 365: <Title>` (category prepended automatically); context menus render as `<Title>` (clean, no redundant prefix). Applies to all ~17 commands.
- **D-02:** Reduce `contributes.commands[]` to only the user-actionable palette whitelist: `altium365.signIn`, `altium365.signOut`, `altium365.selectWorkspace`, `altium365.selectEnvironment`, `altium365.runScript`, `altium365.debugScript`. Everything else is removed from `contributes.commands[]` entirely.
- **D-03:** Remove from `contributes.commands[]`: `altium365.tree.copyId`, `altium365.tree.refresh`, `altium365.tree.retryNode`, `altium365.tree.openInBrowser`, all `altium365.script.*` (`edit`, `publish`, `executeRemote`, `runLocal`), `altium365.workspace.openInBrowser`, `altium365.project.openInBrowser`, `altium365.statusBar.click`. These stay registered via `vscode.commands.registerCommand` in `extension.ts` so context menus and view-title actions still resolve them; they just no longer appear in the palette.
- **D-04:** Approach chosen: **remove from `contributes.commands[]` entirely (option a)**. The alternative (`menus.commandPalette` with `when: false`) was rejected — option (a) is simpler, and the title/category metadata for context-only commands isn't needed for anything (no keybindings planned in this phase).

### Workspace selection QuickPick (item #2)
- **D-05:** Drop the GRID line from the workspace QuickPick. Line 1 = workspace name; line 2 = raw `authId` (no `authId: ` prefix). GRID is internal plumbing and must not be user-visible. Location: wherever the picker items are built in `src/extension.ts` / `src/workspace.ts` — researcher should locate exact call site.

### Category icons (item #4)
- **D-06:** Projects category node uses `$(project)` codicon (replacing `$(folder-library)` at `src/sidePanel.ts:143`). Scripts category node uses `$(file-code)` codicon (replacing `$(folder-library)` at `src/sidePanel.ts:152`). Both are built-in VS Code codicons — no `contributes.icons` entry needed; theme customization continues to work.

### Environment name in tree header (item #5)
- **D-07:** Set `treeView.description = currentEnvironment.name` on the `vscode.window.createTreeView('altium365.tree', …)` call at `src/extension.ts:41`. VS Code renders the description as dimmed text immediately after the view title (e.g. `ALTIUM 365 · Production`). Update `treeView.description` whenever the environment changes — re-use the existing environment-change listener that already refreshes the tree.

### Active-workspace visual cue (item #6)
- **D-08:** Approach chosen: **different codicon (option a)**. Inactive workspaces keep `$(cloud)`; active workspace uses `$(circle-filled)`. Locations: `src/sidePanel.ts:124-134` where the workspace TreeItem icon is currently set.
- **D-09:** Drop the redundant `(active)` text suffix from the workspace description label — the icon difference now carries the signal. ThemeColor changes (option b) and custom SVG cloud pair (option c) explicitly rejected.
- **D-10:** Icon choice rationale: `$(circle-filled)` was picked over `$(pinned)`, `$(bookmark)`, `$(pass-filled)`, `$(record)` specifically because it has no semantic clash with the future 999.2 workspace-favorites feature (which is reserved for `$(star-full)` / `$(pinned)` semantics). Active-workspace cue and favorite cue can therefore stack on the same workspace node without collision in 999.2.

### Select-from-node command (item #7)
- **D-11:** Register a new command `altium365.workspace.selectFromNode` that takes the clicked `A365Node` directly, looks up the workspace, and sets it active — bypassing the QuickPick entirely. Pattern mirrors the existing tree-aware commands `altium365.script.edit` and `altium365.tree.copyId`. Keeps the existing palette-invoked `altium365.selectWorkspace` (QuickPick variant) untouched.
- **D-12:** Wire the new command into a third `view/item/context` entry in `package.json` (alongside the existing entries at `package.json:322` and `:337` for `workspaceNode`).
- **D-13:** Hide the "Select" menu entry on the already-active workspace by using **two distinct contextValues**: `workspaceNode-active` (assigned in `src/sidePanel.ts:115` when this workspace is the active one) and `workspaceNode-inactive` (otherwise). The `view/item/context` `when` clause becomes `viewItem == workspaceNode-inactive`. The existing two `view/item/context` entries that gate on `viewItem == workspaceNode` must be updated to match BOTH values (e.g. `viewItem =~ /^workspaceNode/`) so `Copy ID` and `Open in Browser` still appear on every workspace node. The `CTX_WORKSPACE` constant in `src/sidePanel.ts:19` is replaced by two: `CTX_WORKSPACE_ACTIVE` and `CTX_WORKSPACE_INACTIVE`.
- **D-14:** Selecting a workspace from the node triggers the **same side effects** as selecting via QuickPick — token exchange via `exchangeWorkspaceToken`, `altium365.selectedWorkspace` global state update, tree refresh, status bar refresh. Refactor the post-pick logic in `doSelectWorkspace` into a shared helper (e.g. `applyWorkspaceSelection(context, workspace)`) that both `altium365.selectWorkspace` and `altium365.workspace.selectFromNode` call.

### Cross-cutting
- **D-15:** No new GraphQL queries, no auth changes, no new requirements derived. All work is `package.json` (commands, menus, icons) + TypeScript wiring changes in `src/extension.ts`, `src/sidePanel.ts`, `src/workspace.ts`.
- **D-16:** Backwards compatibility: existing global state keys (`altium365.selectedWorkspace`, etc.) and command IDs (`altium365.signIn` etc.) are preserved; only `contributes.commands[]` membership changes and the `CTX_WORKSPACE` constant is split.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & history
- `.planning/ROADMAP.md` §Phase 4 — phase goal, success criteria, depends-on
- `.planning/phases/03-remote-script-ops/03-VERIFICATION.md` — Phase 3 UAT findings that surfaced these UX gaps (esp. Scenarios 1, 2, 4)

### Codebase intelligence
- `.planning/codebase/CONVENTIONS.md` — command naming (`altium365.*`), camelCase, error-handling, secrets-vs-globalState rules
- `.planning/codebase/STRUCTURE.md` — where to add new commands (handler in `extension.ts`, register in `package.json`)
- `.planning/codebase/ARCHITECTURE.md` — VS Code Activity Bar / TreeDataProvider pattern in use

### Code locations referenced in decisions
- `package.json:67` — `altium365.selectWorkspace` command registration (existing palette entry)
- `package.json:286-298` — view-title action with `altium365.selectEnvironment` (globe icon)
- `package.json:322`, `:337` — existing `view/item/context` entries for `viewItem == workspaceNode`
- `package.json` `contributes.commands[]` (full block) — all ~17 commands to audit per D-01..D-04
- `src/sidePanel.ts:19` — `CTX_WORKSPACE` constant (to split per D-13)
- `src/sidePanel.ts:115` — workspace node `contextValue` assignment (to dual-key per D-13)
- `src/sidePanel.ts:124-134` — workspace TreeItem icon and color (to swap per D-08, D-09)
- `src/sidePanel.ts:143`, `:152` — Projects and Scripts category icons (to replace per D-06)
- `src/extension.ts:41` — `vscode.window.createTreeView('altium365.tree', …)` call (to add `description` per D-07)
- `src/extension.ts` `doSelectWorkspace` handler — post-pick side-effect block to factor into shared helper per D-14
- `src/workspace.ts` `pickAndExchangeWorkspace` — QuickPick item construction (where GRID line lives per D-05)

### VS Code API references
- VS Code codicon gallery — confirm `$(project)`, `$(file-code)`, `$(circle-filled)`, `$(cloud)` are all built-in (they are, but planner should sanity-check against engine `^1.85.0`)
- `TreeView.description` API — set on the `TreeView` instance returned by `createTreeView`, NOT on individual items
- `when` clause regex matching — `viewItem =~ /^workspaceNode/` syntax for D-13

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`doSelectWorkspace` post-pick block** (`src/extension.ts`): the logic after the QuickPick resolves — `exchangeWorkspaceToken`, global state set, tree refresh, status bar update — is the exact behavior needed by `altium365.workspace.selectFromNode`. Factor into shared `applyWorkspaceSelection(context, workspace)` helper.
- **Tree-aware command pattern** (`altium365.script.edit`, `altium365.tree.copyId`): node-receiving command signature `(node: A365Node) => Promise<void>` is the proven shape for `selectFromNode`.
- **`graphqlRequest` helper** (`src/workspace.ts`): unchanged in this phase — no new GraphQL calls needed.
- **Environment-change listener**: already refreshes the tree; extend it to also update `treeView.description` per D-07.

### Established Patterns
- **All commands prefixed `altium365.`** → new command MUST be `altium365.workspace.selectFromNode` (CONVENTIONS.md).
- **`category: "Altium 365"` + bare `title`** → the entire palette cleanup (D-01..D-04) is consistent with the existing convention; the bug is current titles double-prefix the category.
- **Tree node `contextValue` drives menus** → splitting `CTX_WORKSPACE` into two values (D-13) is the idiomatic VS Code way to gate menu visibility per node state.
- **No module-level state except `outputChannel`** (CONVENTIONS.md) → the shared `applyWorkspaceSelection` helper must take `context` as a parameter, not capture it in a closure.

### Integration Points
- **`package.json`** — heaviest churn: `contributes.commands[]` whitelist, `contributes.menus.view/item/context` (add third workspace entry + update existing two to match both contextValues), all command `title` strings.
- **`src/sidePanel.ts`** — icon swaps (`folder-library` → `project`/`file-code`, `cloud` → conditional `cloud`/`circle-filled`), contextValue dual-keying, description label cleanup.
- **`src/extension.ts`** — register new `altium365.workspace.selectFromNode` command, factor `applyWorkspaceSelection` helper out of `doSelectWorkspace`, set `treeView.description` on env change.
- **`src/workspace.ts`** — `pickAndExchangeWorkspace` QuickPick item construction: drop GRID line.

</code_context>

<specifics>
## Specific Ideas

- **Active-workspace icon = `$(circle-filled)`** specifically because it avoids semantic collision with the future 999.2 workspace-favorites feature, which is reserved for star/pin codicons. This is a deliberate forward-looking choice — the planner should preserve this rationale in `04-PLAN.md` so a future revisitor doesn't undo it.
- **Drop the `(active)` text suffix entirely** once the icon swap lands — don't keep belt-and-suspenders. The icon difference is the signal.
- **Use regex `when` clause** (`viewItem =~ /^workspaceNode/`) for the two existing context-menu entries (`Copy ID`, `Open in Browser`) when splitting `CTX_WORKSPACE` so they stay visible on both active and inactive workspaces.

</specifics>

<deferred>
## Deferred Ideas

- **Workspace favorites** — reserved for backlog phase 999.2. Phase 04 decisions explicitly preserve compatibility (active-workspace icon uses `$(circle-filled)` not pin/star).
- **Progress feedback for async ops** — reserved for Phase 05. Phase 04 makes no `withProgress` changes.
- **Custom SVG codicon pair** (cloud-filled + cloud-outline via `contributes.icons`) — rejected for Phase 04 in favor of the simpler built-in-codicon swap. Revisit only if the built-in `$(circle-filled)` proves visually unsatisfying after dogfooding.
- **Keybindings for tree-context commands** — out of scope; removing context commands from `contributes.commands[]` (D-04) means any future keybinding work for them will need an alternative registration path (e.g. add them back with `menus.commandPalette: when: false` at that time).
- **999.2 / 04 / 05 interaction design** — all three layer behavior on the workspace context menu. Phase 04 reserves no menu-ordering decisions; 999.2 planning will re-evaluate placement when it adds the favorite/unfavorite entries.

</deferred>

---

*Phase: 04-ui-polish*
*Context gathered: 2026-05-21*
