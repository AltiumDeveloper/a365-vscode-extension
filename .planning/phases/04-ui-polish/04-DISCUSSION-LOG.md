# Phase 04: UI Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 04-ui-polish
**Areas discussed:** Palette cleanup approach, Projects vs Scripts category icons, Active-workspace visual cue, Select-from-node command shape

---

## Gray Area Selection

Of 7 captured items in this phase, 3 were single-line clear-cut fixes (items #1, #2, #5 — command title prefix, QuickPick GRID drop, env name in tree header) and skipped from discussion. The 4 items below required design decisions.

---

## Palette Cleanup Approach (item #3)

### Q1: How should tree/script context-only commands be hidden from the Command Palette?

| Option | Description | Selected |
|--------|-------------|----------|
| Option (a): remove from `contributes.commands[]` | Cleanest. Commands stay registered via `vscode.commands.registerCommand` so context menus work. Title/category metadata disappears from package.json. | ✓ |
| Option (b): keep entries, add `menus.commandPalette` `when: false` | Verbose but preserves title/category in package.json for tooling/keybindings. | |

**User's choice:** Option (a) — remove from contributes.commands[] entirely.

### Q2: Confirm the palette-visible whitelist?

| Option | Description | Selected |
|--------|-------------|----------|
| Use the backlog-defined list | Whitelist: signIn, signOut, selectWorkspace, selectEnvironment, runScript, debugScript. All others removed. | ✓ |
| Adjust the list | User wants to change which commands stay palette-visible. | |

**User's choice:** Use the backlog-defined whitelist as-is.

---

## Projects vs Scripts Category Icons (item #4)

### Q1: Which codicon pair for Projects (category) and Scripts (category)?

| Option | Description | Selected |
|--------|-------------|----------|
| `$(project)` + `$(file-code)` | Project = collection of files; scripts = code documents. Reads naturally. | ✓ |
| `$(package)` + `$(code)` | Projects as bundle/package, scripts as raw code symbol. More abstract. | |
| `$(folder)` + `$(symbol-file)` | Generic folder + symbol-file. Minimal visual change from current. | |
| `$(notebook)` + `$(terminal)` | Projects as workbook, scripts as terminal script icon. | |

**User's choice:** `$(project)` + `$(file-code)`.

---

## Active-Workspace Visual Cue (item #6)

### Q1: How should the active workspace be visually distinguished?

| Option | Description | Selected |
|--------|-------------|----------|
| Option (a): different codicon for active | Simplest, theme-friendly. Keep `$(cloud)` inactive, use distinct icon for active. | ✓ |
| Option (b): high-contrast ThemeColor | Keep `$(cloud)` on both, apply contrast color on active. | |
| Option (c): custom SVG cloud pair | Most work, matches "cloud filled vs outlined" mental model exactly. | |

**User's choice:** Option (a) — different codicon.

### Q2: Which codicon should mark the active workspace?

| Option | Description | Selected |
|--------|-------------|----------|
| `$(pass-filled)` | Reads as "selected/confirmed" — filled circle with check. | |
| `$(pinned)` | Reads as "pinned/active". Risk: clashes with future 999.2 favorites. | |
| `$(record)` | Filled circle — simple, neutral, no semantic clash. | |
| `$(bookmark)` | Reads as deliberate marker. Risks overlap with future favorites. | |
| `$(circle-filled)` | Minimal "this one" indicator. No semantic clash with future favorites. Pairs cleanly with `$(cloud)` inactive. | ✓ |

**User's choice:** `$(circle-filled)` — explicitly because it avoids semantic collision with 999.2 favorites (which will use star/pin).

### Q3: What about the inactive workspace icon and the existing "(active)" text suffix?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep `$(cloud)` inactive, drop the `(active)` text suffix | Icon difference carries the signal — redundant text removed. | ✓ |
| Keep `$(cloud)` inactive, keep `(active)` suffix | Belt-and-suspenders. | |
| Pair `$(circle-outline)` inactive + `$(circle-filled)` active | Cleaner contrast but loses cloud branding. | |

**User's choice:** Keep `$(cloud)` inactive, drop the `(active)` text suffix.

---

## Select-from-Node Command Shape (item #7)

### Q1: How should the workspace context-menu "Select" entry be wired?

| Option | Description | Selected |
|--------|-------------|----------|
| Option (a): new `altium365.workspace.selectFromNode` command | Takes `A365Node` directly, sets active without QuickPick. Cleaner separation. | ✓ |
| Option (b): parameterize existing `altium365.selectWorkspace` | Accept optional node arg; show QuickPick when absent. Fewer commands, one handler does two jobs. | |

**User's choice:** Option (a) — new dedicated command.

### Q2: Should the "Select" menu entry be hidden on the already-active workspace?

| Option | Description | Selected |
|--------|-------------|----------|
| Hide via dual contextValue (`workspaceNode-active` vs `-inactive`) | Idiomatic VS Code menu gating. Existing two menu entries adjusted to match both. | ✓ |
| Always show — no-op on active | Simpler implementation, less plumbing. | |
| Always show with different label on active | VS Code doesn't natively support disabled menu items; workaround needed. | |

**User's choice:** Dual contextValue split.

### Q3: Should select-from-node trigger the same side effects as QuickPick select?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing post-pick flow as a shared helper | Token exchange + global state + tree refresh + status bar refresh, all via `applyWorkspaceSelection` helper. | ✓ |
| Lazy — only update state + refresh tree | Defer token exchange until next workspace-scoped action. | |

**User's choice:** Reuse existing post-pick flow (shared helper).

---

## the agent's Discretion

None — every decision in this discussion was made by the user explicitly. All four "Recommended" defaults happened to be accepted.

## Deferred Ideas

- **Workspace favorites** — backlog 999.2. Phase 04 active-workspace icon (`$(circle-filled)`) was deliberately chosen to leave star/pin semantics free for favorites.
- **Progress feedback for async ops** — Phase 05.
- **Custom SVG cloud-filled/outline codicon pair** — rejected for Phase 04; revisit only if `$(circle-filled)` proves unsatisfying in dogfooding.
- **Keybindings for tree-context commands** — out of scope; if needed later, those commands will need to come back into `contributes.commands[]` (probably gated with `menus.commandPalette` `when: false` at that point).
- **Menu-ordering interaction between Phase 04, Phase 05, and 999.2** — all three layer on the workspace context menu. Phase 04 reserves no ordering decisions; 999.2 planning will re-evaluate when favorite/unfavorite entries are added.
