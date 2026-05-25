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
- [x] **Phase 4: UI Polish** - Trim noise from side-panel UX and workspace picker (command titles, QuickPick, icons, env header, active-workspace cue, Select context menu) (completed 2026-05-21)
- [x] **Phase 5: Progress Feedback for Async Operations** - Consistent `withProgress` UI for every user-triggered network/IO action (completed 2026-05-22)
- [ ] **Phase 6: Script Execution UX & Unified Parameters** - 9-item UX cleanup of the run/debug/execute flows (workspace-context routing, save-back fix, parameter unification, double-click open, redundant menu removal, GRID-named tmp files, branded title-bar dropdown, dropdown for any .py, AWS-Lambda-style test events)

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

### Phase 4: UI Polish — context menus + workspace picker

**Goal**: Trim noise from the side-panel UX and workspace picker that surfaced during Phase 3 UAT — clean command titles, cleaner QuickPick, differentiated icons, env name in header, stronger active-workspace cue, and a Select action in the workspace context menu.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: TBD (derive during /gsd-discuss-phase 04)
**Success Criteria** (what must be TRUE):

  1. Command Palette shows commands as `Altium 365: <Title>` (no double prefix); context-menu entries show clean titles without the redundant `Altium 365:` prefix
  2. Workspace QuickPick no longer exposes the GRID URN; it shows workspace name on line 1 and the raw authId on line 2
  3. Command Palette only lists user-actionable commands (`signIn`, `signOut`, `selectWorkspace`, `selectEnvironment`, `runScript`, `debugScript`); tree-context commands are hidden from the palette but still wired to context menus
  4. Projects and Scripts category nodes use visually distinct codicons
  5. The A365 tree view header shows the current environment name as `treeView.description`
  6. The active workspace is visually distinguishable from inactive workspaces by more than dimmed color alone
  7. Workspace tree nodes expose a `Select` context menu entry that activates the workspace directly (hidden on the already-active workspace)

**Plans**: TBD (run /gsd-plan-phase 04 to break down)
**Source**: Promoted from backlog 999.1 (7 items, captured 2026-05-21 post Phase 3 closure)
**UI hint**: yes

### Phase 5: Progress Feedback for Async Operations

**Goal**: Provide consistent visual feedback whenever a user-triggered action does network/IO work that takes more than ~200ms, so the user never wonders "is anything happening?"
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: TBD (derive during /gsd-discuss-phase 05)
**Success Criteria** (what must be TRUE):

  1. `altium365.script.edit` wraps the `openTextDocument` + language-set + `showTextDocument` sequence in `vscode.window.withProgress` so the user sees a spinner during the GraphQL fetch
  2. `altium365.script.publish` and the setup phase of remote execution (`remoteExecution.ts` Block A) also show progress affordance before their network round-trip
  3. A single `ProgressLocation` convention (Notification vs Window) is chosen and applied consistently across all remote-script commands
  4. Where appropriate (e.g. Edit), progress is `cancellable: true` and cancellation aborts the in-flight GraphQL request

**Plans**: 3 plans
Plans:
**Wave 1**

- [ ] 01-helper-and-download-PLAN.md — src/progress.ts helper + wrap downloadScriptToTmp (SC-1, SC-3, SC-4 cooperative)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 02-publish-save-bridge-PLAN.md — wrap registerLocalScriptSaveBridge body in withScriptProgress non-cancellable (SC-2 publish half, SC-3)
- [ ] 03-execute-remote-setup-PLAN.md — wrap executeRemoteScript Block A+B cancellable (SC-2 executeRemote half, SC-3, SC-4)

**Source**: Promoted from backlog 999.3 (3 items + 3 open questions, captured 2026-05-21 post Phase 3 closure)

### Phase 6: Script Execution UX & Unified Parameters

**Goal**: Make the run/debug/execute flows feel coherent — execution always runs in the script's own workspace context, save-back works after debug, parameters behave identically across local and remote, and the editor surface (tabs, title bar, default activation) matches what users expect from a first-class A365 integration.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: TBD (derive during /gsd-discuss-phase 6)
**Success Criteria** (what must be TRUE — to be refined in discuss):

  1. Run/Debug/Execute on a script node always uses the script's owning workspace token (auto-routes or transparently switches), not the active workspace
  2. Editing a tmp file opened by Debug (Local) and saving it publishes back to the remote script — same path as Edit Script today
  3. The same parameter model is used for local run, local debug, and remote execute; "project-related" preset reproduces today's projectId prompt
  4. Double-clicking a script node in the side panel opens it for Edit (same code path as the Edit context action)
  5. Tmp file is named after the script's GRID so the editor tab title is meaningful
  6. Editor title bar shows a single branded "Altium 365" dropdown (Publish / Execute Local / Debug Local / Execute Remote) instead of separate buttons; the redundant "Publish Script" context-menu entry is removed
  7. The "Altium 365" dropdown also appears for any standalone local `.py` file, not only remote-tmp files
  8. (Stretch) AWS-Lambda-style named "test events" let users save/switch multiple parameter templates per script, shared across local and remote runs

**Plans:** 1/3 plans executed

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Quick wins: single-click Edit, GRID-derived nested tmp layout, drop redundant tree Publish entry (D-09..D-12, D-18..D-20 → SC-4, SC-5, SC-6 partial)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-03-PLAN.md — Execution correctness: workspace-context routing for local run/debug, unified projectId prompt for remote execute, shared last-pick cache (D-01..D-08 → SC-1, SC-2, SC-3) — wave 2, depends on 06-01

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-02-PLAN.md — Title-bar UX: branded Altium 365 submenu replacing flat trio, context-key visibility, node-less submenu invocation for standalone .py (D-13..D-17 → SC-6, SC-7) — wave 3, depends on 06-01 + 06-03

Note: SC-8 (AWS-Lambda-style test events) deferred to Phase 999.3 per D-23.

**Source**: `.planning/todos/completed/2026-05-22-phase-05-candidates.md` (9 items captured during Phase 04 UAT, promoted 2026-05-22 after Phase 5 closure)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 02.1 → 02.2 → 02.3 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Packaging | 2/2 | Complete   | 2026-05-19 |
| 2. Side Panel | 6/6 | Complete | 2026-05-19 |
| 02.1 Side-Panel UX Closure | 5/5 | Complete   | 2026-05-19 |
| 02.2 Auth Hardening | done | Complete | 2026-05-20 |
| 02.3 ActionWait Auth Flow | 5/5 | Complete (partial UAT) | 2026-05-20 |
| 3. Remote Script Operations | 5/5 | Complete (partial UAT) | 2026-05-21 |
| 4. UI Polish | 4/4 | Complete | 2026-05-21 |
| 5. Progress Feedback for Async Ops | 3/3 | Complete   | 2026-05-22 |
| 6. Script Execution UX & Unified Params | 1/3 | In Progress|  |

## Backlog

Unsequenced items parked for a future milestone. Promote with `/gsd-review-backlog` when ready to plan.

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

### Phase 999.3: Script Test-Events (COMPLETED)

**Goal:** AWS-Lambda-style named "test events" for script parameters. Users save and switch between multiple named parameter templates per script, used identically for local run, local debug, and remote execute. Subsumes the current ad-hoc `*.params.json` files and the projectId-prompt fallback shipped in Phase 6.

**Captured items:**

1. **Storage** — per-script blob in workspaceState under the reserved key `altium365.scriptParams.<scriptId>` (reservation from Phase 3 D-05, preserved through Phase 6 D-23). Shape: `{ defaultEventName: string, events: { [name: string]: object } }`. One default event marked for unattended runs (palette commands, no UI prompt).
2. **UI surface** — title-bar dropdown next to the Altium 365 submenu (or a sub-item of it): "Test events ▾" with quick-switch + "Create new…" + "Edit current…". "Edit current…" opens a JSON document (virtual or temp file) for inline editing; save commits back to workspaceState. Pattern reference: AWS Toolkit Lambda test events.
3. **Built-in presets** — at minimum a `project-related` preset that reproduces today's `{projectId: <picked>}` payload using `pickProjectId`. User can edit/clone to customize.
4. **Local + remote share the same model** — `prepareRun` (local) and `executeRemoteScript`'s Block B (remote) both resolve params via the same `resolveScriptParameters(scriptIdentity)` helper. Removes the divergence Phase 6 D-05 only patched at the surface.
5. **Sibling `.params.json` migration** — on first run of a local .py with a sibling `.params.json` and no existing workspaceState entry, offer to import as a named test event. After import, sibling file is no longer consulted (workspaceState wins). Or keep sibling as a separate "file-backed event" — design decision.
6. **Standalone .py support** — test events keyed by an identity derived from the file (workspace path? hash?) for files not registered in `localScriptCache`. Or restrict to scripts with a remote identity for v1. Design decision.

**Open questions (resolve during /gsd-discuss-phase 999.3):**

- Workspaceless storage vs globalState — should test events follow the user across workspaces, or be scoped per VS Code workspace?
- Default event semantics — does invoking a palette command (`altium365.runScript`) on the active editor use the default event silently, or always prompt?
- Sibling `.params.json` interop — full migration (consume + delete) vs coexistence (file overrides state when present)?
- Test event sharing — should test events round-trip with the script via a special remote-stored blob (so co-developers see the same events)?
- Edit UI — virtual doc with JSON schema validation, or a structured form? JSON is cheaper to ship.
- Maximum number of stored events per script (to bound workspaceState bloat).

**Requirements:** SCRIPT-V2-04 (Test Events; 10 sub-bullets — see REQUIREMENTS.md)
**Depends on:** Phase 6 (minimal projectId bridge + workspace-context routing must be in place)
**Plans:** 6 plans

Plans:

- [x] 999.3-01-PLAN.md — Foundation: schema + store + identity (Wave 1)
- [x] 999.3-02-PLAN.md — ATOMIC: unified resolver + prepareRun + executeRemoteScript migration + sibling import (Wave 2)
- [x] 999.3-03-PLAN.md — Editor surface: FileSystemProvider on altium365-event:// + jsonValidation registration (Wave 3)
- [x] 999.3-04-PLAN.md — Picker + 5 commands + first-run prompt UI + soft-warning hook (Wave 4)
- [x] 999.3-05-PLAN.md — Menu wiring: Placement A (submenu sub-row) + Placement B (title-bar button) + setting description updates (Wave 5)
- [x] 999.3-06-PLAN.md — Polish + A/B UAT + README docs (Wave 6) ✅ Complete 2026-05-25

**Captured at:** 2026-05-22 (deferred from Phase 6 stretch goal during discuss)

### Phase 7: Remote execute log-dedup fix

**Goal:** Eliminate duplicate log batches in the OutputChannel during remote script execution. Each user-emitted log line currently appears once per poll tick that the script remains alive (observed 3× duplication for a ~4s script during Phase 6 Plan 06-03 UAT, 2026-05-22). Promoted from backlog 2026-05-25 after Phase 999.3 closeout.

**Captured items:**

1. **Root cause** — `src/remoteExecution.ts:343-345` advances the `nextToken` poll cursor only when the server returns a truthy value:
   ```ts
   if (logPage.nextToken) { nextToken = logPage.nextToken; }
   ```
   When the server returns null/empty (its "no more logs since X" signal), the cursor stays put and the next tick re-fetches and re-prints the same page.

2. **Investigation** — confirm `getExecutionLogs` (in `src/workspace.ts`) pagination semantics: is `nextToken` an opaque continuation token (advance only when non-empty) or a "since X" high-water mark (advance unconditionally on success)? The current code assumes the former but the duplication suggests the server returns empty when there are no NEW logs, not when all logs are consumed.
3. **Fix candidates** (pick after investigation):
   - Track already-printed line count locally and slice the returned `logs[]` before printing.
   - Advance `nextToken` unconditionally when `logs.length === 0` (treat empty page as "caught up — next call should ask from latest").
   - Switch to a server-side `since: ISO8601` filter if the API supports one.
4. **Regression test** — add a remote-execute UAT scenario that runs a script printing N distinct numbered lines and asserts the OutputChannel contains exactly N occurrences.

**Open questions:**

- What is `nextToken`'s actual contract on the server side? Need to inspect the GraphQL schema for `gloScrScriptExecutionLogs` (or wherever logs come from).
- Does an empty `logs[]` always imply "caught up", or can it mean "page is empty but more exist past this cursor" (e.g. server pagination quirk)?

**Requirements:** REMOTE-EXEC-02 (Log fidelity)
**Depends on:** Phase 6 (remote execution surface)
**Plans:** 1 plan ✅

Plans:

- [x] 07-01-PLAN.md — vitest bootstrap + extract dedupLogPage helper + integrate + 5-case unit test ✅ Complete 2026-05-25

### Phase 8: distinct-vsix-version-per-build

**Goal:** Every push to `main` produces a uniquely-versioned VSIX (`${BASE}-ci.${RUN}+${SHA7}`) attached to an auto-created GitHub Release; the extension polls GitHub Releases on a 24h-debounced activation hook (toggleable via `altium365.checkForUpdates` setting) and a palette-visible manual command, offering a one-click download → install → reload flow when a newer release exists.
**Requirements**: CI-VER-01, CI-VER-02, CI-VER-03, CI-VER-04, UPD-01, UPD-02, UPD-03, UPD-04, UPD-05, UPD-06, UPD-07
**Depends on:** Phase 7
**Plans:** 3 plans

Plans:
**Wave 1**

- [ ] 08-01-PLAN.md — CI versioning + GitHub Release publishing in .github/workflows/ci.yml (CI-VER-01..04)
- [ ] 08-02-PLAN.md — Pure SemVer comparator src/semverCompare.ts + vitest spec test/compareVersions.test.ts (UPD-01)

**Wave 2** *(blocked on Wave 1 — 08-02 specifically)*

- [ ] 08-03-PLAN.md — src/updater.ts (registerUpdater factory + GitHub poll + redirect-following download + install + reload) wired into src/extension.ts + package.json command/setting (UPD-02..07)
