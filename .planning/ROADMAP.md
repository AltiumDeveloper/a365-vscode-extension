# Roadmap: Altium 365 VS Code Extension

## Overview

Three phases take the existing brownfield extension (OAuth, local run/debug, workspace switching all working) from a developer-only internal build to a distributable, publicly presentable tool with a rich side panel and full remote script workflow. Phase 1 makes it shippable, Phase 2 makes it navigable, Phase 3 makes remote scripting first-class.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Packaging** - Produce a distributable VSIX with CI pipeline and Marketplace-ready metadata (completed 2026-05-19)
- [x] **Phase 2: Side Panel** - Activity Bar tree showing workspaces, projects, and scripts with context actions (completed 2026-05-19)
- [x] **Phase 3: Remote Script Operations** - Open, edit, publish, and execute server-side scripts from the tree (completed 2026-05-21 — partial UAT, Scenarios 3+5 deferred)

## Phase Details

### Phase 1: Packaging
**Goal**: The extension is distributable as a signed VSIX with a one-command build and a CI pipeline that produces artifacts on every push
**Mode:** mvp
**Depends on**: Nothing (brownfield foundation already working)
**Requirements**: PKG-01, PKG-02, PKG-03, PKG-04, PKG-05
**Success Criteria** (what must be TRUE):
  1. Running `npm run package` produces a `.vsix` file installable in VS Code
  2. `package.json` contains icon, description, categories, keywords, and publisher fields so the extension renders correctly in Marketplace
  3. `README.md` explains installation steps and lists all features clearly enough for an external developer to get started
  4. GitHub Actions workflow runs compile → package → upload VSIX artifact on every push without manual steps
**Plans**: 2 plans
Plans:
- [x] 01-01-PLAN.md — Package tooling, metadata, and icon (PKG-01, PKG-02, PKG-03)
- [x] 01-02-PLAN.md — README rewrite and GitHub Actions CI pipeline (PKG-04, PKG-05)

### Phase 2: Side Panel
**Goal**: Users can navigate their A365 workspaces, projects, and scripts via a dedicated Activity Bar side panel without running any commands manually
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PANEL-01, PANEL-02, PANEL-03, PANEL-04, PANEL-05, PANEL-06, SCRIPT-01
**Success Criteria** (what must be TRUE):
  1. An A365 icon appears in the Activity Bar and opens the side panel
  2. The panel top level shows all workspaces the signed-in user has access to
  3. Expanding a workspace reveals its projects and its scripts as separate child nodes
  4. Right-clicking a script node shows context menu actions: Run Script, Edit Script, Execute Remotely, Publish Script
  5. The panel header or VS Code status bar shows the currently signed-in user and active environment
**Plans**: 6 plans
- [x] 02-01-PLAN.md — Add listScripts() + ScriptInfo to src/workspace.ts (SCRIPT-01 GraphQL plumbing)
- [x] 02-02-PLAN.md — Per-workspace token cache + auth-state event emitter + getActiveUserLabel in src/auth.ts (PANEL-06 foundation)
- [x] 02-03-PLAN.md — package.json contributes: viewsContainers, views, viewsWelcome, 7 commands, view/title + view/item/context menus (PANEL-01, PANEL-05)
- [x] 02-04-PLAN.md — src/sidePanel.ts A365TreeDataProvider + extension.ts wiring (PANEL-01..04, D-05, D-07)
- [x] 02-05-PLAN.md — src/statusBar.ts factory + altium365.statusBar.click QuickPick (PANEL-06)
- [x] 02-06-PLAN.md — src/scriptCommands.ts: register all four altium365.script.* commands, implement run-local via two-step fetch + tmpdir (PANEL-05, SCRIPT-01, D-09); blocking human checkpoint for A1/A2 — **SCRIPT-01/D-09 deferred to Phase 3 (BLOCKED on live-workspace verification)**
**UI hint**: yes

### Phase 02.1: Side-Panel UX Closure (INSERTED)
**Goal**: Close the 5 UX gaps surfaced by Phase 02 human UAT so the side panel is ergonomically usable in day-to-day work (grouped hierarchy, clean labels, active-workspace cue, in-panel env switcher, browser-link shortcuts)
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: PANEL-07, PANEL-08, PANEL-09, PANEL-10, PANEL-11
**Success Criteria** (what must be TRUE):
  1. Expanding a workspace shows two category nodes — `Projects (n)` and `Scripts (n)` — each lazy-loading its real children (reverses Phase 02 D-05/PANEL-04)
  2. Tree labels for workspaces, projects, and scripts no longer contain backend GUIDs; a `Copy ID` context menu item is available on each node
  3. The active workspace is visually distinguishable from inactive workspaces in the tree
  4. The A365 view title exposes a globe-icon action that runs the existing `altium365.selectEnvironment` command
  5. Workspace and project context menus include `Open in Browser`, which opens the node's A365 URL in the system browser
**Plans**: 5 plans
Plans:
- [x] 02.1-01-PLAN.md — Category-grouped workspace children (G-01 / PANEL-07)
- [x] 02.1-02-PLAN.md — Globe-icon view-title env switcher (G-04 / PANEL-10)
- [x] 02.1-03-PLAN.md — Drop GUIDs from labels + Copy ID command (G-02 / PANEL-08)
- [x] 02.1-04-PLAN.md — Active-workspace cue in tree (G-03 / PANEL-09)
- [x] 02.1-05-PLAN.md — Open in Browser for workspace + project (G-05 / PANEL-11)
**Source**: `.planning/phases/02-side-panel/02-HUMAN-UAT.md` (gaps G-01..G-05)

### Phase 02.2: Auth Hardening (INSERTED)
**Goal**: Resolve outstanding auth/security findings carried forward from Phase 02 and Phase 02.1 code reviews — refresh-token flow, expiry-aware token reuse in `pickAndExchangeWorkspace`, and any remaining CR-01/CR-02/WR-05 items before Phase 3 introduces remote script mutations that depend on a hardened auth layer.
**Mode:** mvp
**Depends on**: Phase 02.1
**Requirements**: TBD (derive from 02-REVIEW.md CR-01/CR-02/WR-01 + 02.1-REVIEW.md WR-05)
**Success Criteria** (what must be TRUE):
  1. `pickAndExchangeWorkspace` and `ensureWorkspaceToken` honor token expiry and trigger refresh before reuse
  2. Carry-forward findings CR-01 / CR-02 / WR-01 from `.planning/phases/02-side-panel/02-REVIEW.md` are resolved or explicitly documented as accepted risk
  3. WR-05 from `.planning/phases/02.1-side-panel-ux/02.1-REVIEW.md` is closed without leaking workspace-scoped tokens into `listWorkspaces`
  4. No regression in existing OAuth2 PKCE flow or per-workspace token cache (Phase 02 UAT scenarios still pass)
**Plans**: TBD
**Source**: 02-REVIEW.md, 02.1-REVIEW.md, 02.1-REVIEW-FIX.md (WR-05 skip rationale)

### Phase 02.3: ActionWait Auth Flow (INSERTED)

**Goal:** Replace the loopback HTTP-server OAuth callback with Altium's ActionWait long-poll service. Desktop app opens a long-poll connection to `actionWaitEndpoint` keyed by a `connection_token` (also used as the OAuth `state` param) and uses a fixed `redirect_uri=https://auth.altium.com/authCompleted`. UnifiedLogin POSTs the authorization code to ActionWait, which releases the long-poll. Extension then exchanges the code at `/connect/token` using its `code_verifier`. Loopback flow is removed entirely.
**Mode:** mvp
**Requirements:**
- AUTH-AW-01: Replace loopback HTTP server with ActionWait long-poll callback
- AUTH-AW-02: Use fixed redirect_uri per environment; remove dynamic port allocation
- AUTH-AW-03: Use `connection_token` (GUID) as OAuth `state` and ActionWait connection key
- AUTH-AW-04: Honour env-specific `actionWaitEndpoint` settings already in package.json
- AUTH-AW-05: Remove all loopback-related code (no opt-in fallback per discuss decision)
**Success Criteria:**
1. Sign-in works end-to-end against dev/uat/prod environments via ActionWait
2. No local HTTP server is started during sign-in; no port permission prompt
3. `redirect_uri` registered in Altium auth client matches the fixed `authCompleted` URL
4. Long-poll handles timeout/reconnect, network errors, and user-cancellation cleanly
5. Existing Phase 02.2 auth hardening (token routing, mutex, hygiene) remains intact
6. Manual UAT covers happy path, cancel, network failure, timeout, and state-mismatch (CSRF)
**Depends on:** Phase 02.2
**Plans:** TBD (run /gsd-plan-phase 02.3 to break down)
**Source:** ActionWait flow spec provided by user (2026-05-20 session)

### Phase 3: Remote Script Operations
**Goal**: Users can open, edit, publish, and trigger execution of remote A365 scripts entirely from within VS Code, with execution output streamed back to the editor
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05
**Success Criteria** (what must be TRUE):
  1. Clicking "Edit Script" on a tree node opens the script content as a VS Code editor document
  2. After editing, "Publish Script" pushes the updated content back to A365 via the GraphQL mutation
  3. "Execute Remotely" triggers server-side execution of the script and shows a progress indicator
  4. Remote execution output appears in the VS Code Output Channel, streaming in real time
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 02.1 → 02.2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Packaging | 2/2 | Complete   | 2026-05-19 |
| 2. Side Panel | 6/6 | Complete | 2026-05-19 |
| 02.1 Side-Panel UX Closure | 5/5 | Complete   | 2026-05-19 |
| 02.2 Auth Hardening | done | Complete | 2026-05-20 |
| 02.3 ActionWait Auth Flow | 5/5 | Complete (partial UAT) | 2026-05-20 |
| 3. Remote Script Operations | 5/5 | Complete (partial UAT) | 2026-05-21 |

## Backlog

Unsequenced items parked for a future milestone. Promote with `/gsd-review-backlog` when ready to plan.

### Phase 999.1: UI polish — context menus + workspace picker (BACKLOG)

**Goal:** Trim noise from the side-panel UX and workspace picker that surfaced during Phase 3 UAT.

**Captured items:**

1. **Drop the `Altium 365: ` prefix from command titles (fixes double-prefix bug)** — every command in `package.json` contributes.commands[] sets both `category: "Altium 365"` AND `title: "Altium 365: ..."`. VS Code automatically prepends the category in the Command Palette, so commands currently render as `Altium 365: Altium 365: Select Workspace` (double prefix). In tree-node context menus only the `title` is shown, so they render as `Altium 365: Select Workspace` (single but redundant prefix). **Fix:** strip the literal `Altium 365: ` from every `title` and keep `category`. Result — Command Palette shows `Altium 365: Select Workspace` (category prepended); context menus show clean `Select Workspace`. Applies to all ~10 commands in package.json.
2. **Workspace selection QuickPick: drop GRID line, show authId clean** — current picker renders workspace name + full GRID (`grid:global::platform:workspace/<uuid>`) on the first line and `authId: <guid>` on the second. Replace with workspace name on line 1 and the raw authId (no `authId: ` prefix) on line 2. GRID is internal plumbing and shouldn't be user-visible. Likely in `src/extension.ts` or `src/workspace.ts` where the QuickPick items are built.
3. **Audit which commands need palette registration vs context-menu only** — all 17 commands in `package.json` `contributes.commands[]` are currently Command Palette–discoverable, but most make no sense without tree-node context (e.g., `altium365.tree.copyId`, `altium365.script.edit`, `altium365.script.publish` do nothing useful when invoked from the palette). **Keep palette-visible:** `signIn`, `signOut`, `selectWorkspace`, `selectEnvironment`, `runScript`, `debugScript`. **Hide from palette (keep handlers via `commands.registerCommand` so context menus still work):** `tree.copyId`, `tree.refresh`, `tree.retryNode`, `tree.openInBrowser`, all `script.*` commands (`edit`, `publish`, `executeRemote`, `runLocal`), `workspace.openInBrowser`, `project.openInBrowser`, `statusBar.click`. **Implementation options:** (a) remove from `contributes.commands[]` entirely (cleanest), or (b) keep them registered but add `menus.commandPalette` entries with `when: false` to suppress. Option (a) is simpler; option (b) preserves the title/category metadata if needed elsewhere. Decide during planning.

**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD — promote with `/gsd-review-backlog` when ready

**Captured at:** 2026-05-21 (post Phase 3 closure)

### Phase 999.2: Workspace favorites (BACKLOG)

**Goal:** Let users star frequently-used workspaces. Favorites render at the top of the tree, sorted alphabetically by name; non-favorites render below, current ordering preserved.

**Captured items:**

1. **Storage** — persist starred workspace IDs in `context.globalState` under a key like `altium365.favoriteWorkspaces` (array of `workspaceId` GRIDs or `authId` strings — decide during planning, but GRID is more durable since `authId` can theoretically change). Keep it strictly user-scoped (globalState, not secrets) — it's preference, not credential.
2. **Commands** — register `altium365.workspace.favorite` and `altium365.workspace.unfavorite` (or a single toggle). Wire into `view/item/context` menu in `package.json` with `when: viewItem == workspace && !altium365.isFavorite` / `viewItem == workspace && altium365.isFavorite` (or use a contextValue suffix like `workspace-fav` vs `workspace`).
3. **Tree rendering** — in `src/sidePanel.ts` `A365TreeDataProvider.getChildren(root)`, partition workspaces into `favorites` and `rest`. Sort favorites alphabetically by `displayName`. Concatenate. Consider an optional `TreeItem` separator or just rely on the star icon for visual grouping.
4. **Visual cue** — star icon on favorited workspaces. Reuse VS Code codicon `$(star-full)` for favorites and either omit or use `$(star-empty)` for non-favorites. Combines with existing active-workspace cue (Phase 02.1-04) — needs a design decision: does active-workspace styling override or combine with the favorite star?
5. **Migration** — none needed (additive feature; empty favorites set = current behavior).

**Open questions (resolve during /gsd-discuss-phase):**

- Key by `workspaceId` (GRID) or `authId`? GRID is durable but ugly; authId is human-readable but Altium docs don't guarantee immutability.
- Single toggle command vs. two commands (favorite + unfavorite)? Two is more explicit; one is less menu clutter.
- Sort favorites alphabetically (per user spec) — confirm case-insensitive.
- Behavior when a favorited workspace disappears from the user's access (revoked, deleted)? Silent prune on next list, or surface as ghost?
- Interaction with active-workspace cue from Phase 02.1-04 — combine icons, or favorite takes precedence?

**Requirements:** TBD (likely PANEL-12 — Workspace favorites)
**Plans:** 0 plans

Plans:
- [ ] TBD — promote with `/gsd-review-backlog` when ready

**Captured at:** 2026-05-21 (post Phase 3 closure)
