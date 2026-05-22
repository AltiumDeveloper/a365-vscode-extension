# Phase 6: Script Execution UX & Unified Parameters - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the run / debug / execute surface of the extension feel like one coherent feature instead of three sibling features that drifted. Eight concrete UX/correctness items from the source todo (item 9 "test events" deferred):

1. **Workspace-context routing for local run/debug.** Today `runScript` / `debugScript` use the *active* workspace token regardless of which script node was clicked. Remote execute already routes by the node's owning workspace. Local must match.
2. **Save-back after Debug Local** — verify via UAT (code path already routes through `downloadScriptToTmp` → `registerLocalScript` per scout); add explicit UAT scenario, no code change planned.
3. **Unified params (minimal bridge).** Remote execute today reads only `workspaceState['altium365.scriptParams.<scriptId>']`. Local prompts for `projectId` and caches per workspace. Bring remote up to local's level (`projectId` prompt + shared cache); the full AWS-Lambda-style "test events" UI is deferred.
4. **Double-click a script tree node → Edit.** Currently no default activation.
5. **GRID-derived tmp file layout.** New layout: `os.tmpdir()/altium365/<workspaceAuthId>/<scriptId>/<safeName>.py`. Tab title becomes the readable script name.
6. **Editor title-bar consolidation.** Replace the flat trio of `editor/title` buttons with a single branded "Altium 365" `contributes.submenu` containing Publish / Execute Remote / Run Local / Debug Local. Items are context-sensitive (see §7).
7. **Submenu surfaces on standalone `.py` too** — Run Local / Debug Local only; Publish / Execute Remote suppressed when the file isn't in `localScriptCache`.
8. **Remove the redundant `Publish Script` tree-context entry** (Cmd+S via save bridge already publishes; the menu is confusing).

**Stretch item 9 (AWS-Lambda named "test events") is OUT OF SCOPE for Phase 6.** Captured as Phase 999.3 in the backlog.

**Not in this phase:**
- Test events UI / data model (Phase 999.3)
- Per-script params editor / "Set Parameters" command (still reserved per 03 D-05)
- Server-side script GRID as a new GraphQL field (we synthesize the GRID client-side from `authId` + `scriptId`)
- Telemetry, conflict UI, version detection, multi-workspace simultaneous-edit safety nets
- Cleanup of legacy flat `altium365-*.py` tmp files
- Migration of existing `withProgress` sites to `withScriptProgress` (still a future chore per 05 D-07)

</domain>

<decisions>
## Implementation Decisions

### Workspace-context routing (item 1, item 7)
- **D-01:** **Transparent token, no active-workspace switch.** When the user invokes run/debug/execute on a script node from a non-active workspace, the operation runs against that script's owning workspace token + `apiServiceUrl` for one execution only. The active workspace selection and tree state are untouched. Matches today's `executeRemoteScript` behavior (`remoteExecution.ts:101-141`) and avoids surprise UI churn.
- **D-02:** **Plumb workspace identity through `runScriptAtPath` / `debugScriptAtPath`.** Both helpers gain an optional `target?: { workspaceId: string; workspaceAuthId: string }` arg. `runLocalFromScriptNode` / `debugLocalFromScriptNode` (`scriptCommands.ts:289, :308`) pass the node's workspace explicitly. Palette commands (`altium365.runScript`, `altium365.debugScript`) pass `undefined`. Internally, when `target` is set, swap `getActiveAccessToken` for `ensureWorkspaceToken({workspaceId, authId})` and `getWorkspaceApiUrl(workspace, envGlobalEndpoint)`. NOT via cache-lookup inside `prepareRun` (rejected — implicit lookups hide the routing decision and break for standalone `.py`).
- **D-03:** **Standalone `.py` falls back to active workspace.** When run/debug is invoked on a regular local `.py` (palette, editor title, explorer context) with no node context AND no `localScriptCache` hit, use `getActiveAccessToken` / `getSelectedWorkspace` as today. If no active workspace, the existing "select workspace first" prompt fires. (Rejected: requiring a cache hit or auto-linking to a remote script — too aggressive for v1.)

### Save-back after Debug Local (item 2)
- **D-04:** **No code change; UAT-only.** Per scout: `debugLocalFromScriptNode` (`scriptCommands.ts:308-330`) routes through `downloadScriptToTmp` (`:339`) which calls `registerLocalScript(tmpPath, identity)` (`:373`), exactly as `editScript` / `runLocalFromScriptNode` do. The save bridge (`localScriptCache.ts:80-125`) fires on any save of any registered fsPath. The original UAT report is likely stale (predates Phase 5 plumbing). Phase 6 UAT MUST include one scenario: "Debug Local on a remote script → edit in editor → Cmd+S → publish toast appears and remote script content updates." If repro succeeds, no code change. If repro confirms a bug, add a defensive plan.

### Unified params (item 3)
- **D-05:** **Minimal bridge in Phase 6 — defer full test-events to 999.3.** Bring remote execute's param model up to local's existing level, no further. `executeRemoteScript` Block B (`remoteExecution.ts:158, resolveScriptParameters :234`) gains a `projectId` prompt fallback identical to `prepareRun`'s (`extension.ts:699-736`). Per-script persistent storage (the reserved `altium365.scriptParams.<scriptId>` key from 03 D-05) is NOT activated — it stays reserved for Phase 999.3's test-events UI to own end-to-end.
- **D-06:** **`projectId` prompt logic for remote.** When remote execute has no params:
  - If `altium365.promptForProjectId` config is `false`, send empty params (current behavior preserved).
  - Otherwise, call the existing `pickProjectId` (`extension.ts:773`) helper with the script's workspace id (NOT the active workspace's), using its workspace token. Resulting `{projectId}` is sent as the params payload. No sibling `.params.json` lookup for remote — tmp/virtual files don't have meaningful siblings, and the local-only path is unchanged.
- **D-07:** **Shared last-pick cache.** Both local and remote use the same workspaceState key `altium365.lastProjectId.<workspaceId>`. Pre-fill the QuickPick with the last value picked from EITHER local or remote (in the same workspace). Reuses the existing key from `prepareRun` (`extension.ts:715`); no new key.
- **D-08:** **`pickProjectId` must accept an explicit workspace target** (matching D-02's plumbing). Refactor `pickProjectId` (`extension.ts:773`) to accept `target?: WorkspaceInfo`; default behavior (no target) keeps reading active workspace. Remote execute passes the script's workspace.

### Tmp file naming + GRID (item 5)
- **D-09:** **Script GRID is synthesized client-side, not fetched.** Format: `grid:workspace:{workspaceAuthId}:scripts:script/{scriptId}`. Both fields are already present on `ScriptNodeArgs` / `ScriptInfo` — no schema changes, no researcher spike required. Document the format in `src/scriptCommands.ts` near the tmp-path builder.
- **D-10:** **Subdirectory hierarchy with readable filename.** New layout: `os.tmpdir()/altium365/<workspaceAuthId>/<scriptId>/<safeName>.py` where `safeName = scriptName.replace(/[^\w.-]+/g, '_')` ensures `.py` suffix. Tab title displays as `<safeName>.py` — meaningful to the user. Two scripts named the same in different workspaces cannot collide. The `<workspaceAuthId>/<scriptId>` segments encode the GRID identity in the path without polluting the tab title.
- **D-11:** **No legacy migration.** Existing flat `altium365-<scriptId>-<name>.py` tmp files keep working (cache lookup keys on fsPath — old entries remain valid). Old files purge naturally via OS tmp cleanup or extension reinstall. No startup scan, no clobbering of open editors.
- **D-12:** **`downloadScriptToTmp` ensures the directory exists.** `mkdirSync(dirname, {recursive: true})` before writing the file. The directory tree is cheap; no cleanup logic needed.

### Branded "Altium 365" submenu (items 6, 7, 8)
- **D-13:** **Use `contributes.submenus`.** Declare a new submenu id `altium365.editorTitle` with `label: "Altium 365"` and an `icon` (Altium 365 brand icon already shipped in `media/`). Attach to `editor/title` via `contributes.menus["editor/title"]: [{ submenu: "altium365.editorTitle", group: "navigation@1" }]`. VS Code renders it as a single icon button that opens the submenu on click. The four existing flat title-bar entries (Publish, Execute Remote, Debug — `package.json:297-313`) are REMOVED from `editor/title` and re-registered under `contributes.menus["altium365.editorTitle"]`.
- **D-14:** **Submenu items + ordering.**
  1. `altium365.script.runLocal` — Run Local (group `1_run@1`)
  2. `altium365.script.debugLocal` — Debug Local (group `1_run@2`)
  3. `altium365.script.executeRemote` — Execute Remote (group `2_remote@1`)
  4. `altium365.script.publish` — Publish (group `3_publish@1`)
  Local actions first (most common), remote actions second, publish last (lifecycle action). Groups give visual separation.
- **D-15:** **Context-sensitive item visibility.**
  - **Remote-tmp file** (file fsPath is in `localScriptCache`): all four items visible.
  - **Standalone .py** (Python file NOT in `localScriptCache`): only Run Local + Debug Local visible. Publish + Execute Remote hidden — there's no remote identity to push to / execute against.
  - Implementation: combine a `when` clause + a context key. Add `setContext('altium365.activeIsRemoteScript', boolean)` from an `onDidChangeActiveTextEditor` listener that does `localScriptCache.getLocalScript(fsPath) != null`. Submenu items gate on `resourceLangId == python && altium365.activeIsRemoteScript` (for Publish/Execute Remote) or `resourceLangId == python` (for Run/Debug Local). Handler-level safety net: each command also re-checks cache lookup and shows a friendly toast if invoked against a stale state.
- **D-16:** **Drop the filename regex `resourceFilename =~ /^altium365-/`.** The new tmp layout (D-10) puts files under `altium365/<authId>/<scriptId>/<name>.py` — the regex would no longer match. The context-key approach (D-15) is the only source of truth.
- **D-17:** **`runLocal` / `debugLocal` also need node-less variants.** Today `altium365.script.runLocal` / `debugLocal` are registered to take a `ScriptNode`; the submenu invokes them without one. Add a tree-less code path: when no node arg is provided, fall back to "use active editor's fsPath + cache lookup → if cache hit, derive node identity; if no cache hit, run as standalone .py using active workspace per D-03."
- **D-18:** **Remove the redundant `Publish Script` tree-context entry** (`package.json:372-376`). Save bridge handles publishing on Cmd+S; the explicit menu entry is confusing. Edit Script context entry stays. No replacement; users who want explicit publish use Cmd+S or the new submenu.

### Double-click → Edit (item 4)
- **D-19:** Set `item.command = { command: 'altium365.script.edit', title: 'Edit Script', arguments: [node] }` on the script TreeItem in `sidePanel.ts:173-182` (the `case 'script'` branch). VS Code wires this to single-click activation (which is the default for tree items — there is no "double-click" event in `TreeDataProvider`; single-click on a leaf with a command runs it). Matches behavior of the explicit "Edit Script" context entry.
- **D-20:** Workflow tip embedded in README (future docs phase): "single-click a script in the side panel to open it for editing; right-click for run / execute / publish actions."

### Cross-cutting
- **D-21:** **No new GraphQL queries, no auth changes, no new package.json configuration settings.** Phase 6 is pure TS surface change + `package.json` `contributes.commands` / `menus` / `submenus` shuffling.
- **D-22:** **Reuse `withScriptProgress` from Phase 5** for any new async sites (e.g. the new `pickProjectId` call from remote execute already runs inside `executeRemoteScript`'s Block A wrap — no extra wrap needed). No new helpers needed.
- **D-23:** **Workspace-state key reservations preserved.** `altium365.scriptParams.<scriptId>` (per 03 D-05) stays reserved and unused this phase. Phase 999.3 (test events) will own it.
- **D-24:** **Manual UAT only** (per `.planning/codebase/TESTING.md` and Phase 3 D-13). UAT scenarios for Phase 6 cover: cross-workspace run/debug routing, debug-then-save publishes back, double-click opens, tmp tab title shows script name, submenu visibility on remote-tmp vs standalone .py, redundant Publish entry no longer in tree menu, remote execute prompts for projectId, shared last-pick cache survives across local↔remote.

### Plan-breakdown reaffirmed
- **D-25 [informational]:** Roadmap candidate breakdown is confirmed (item 9 dropped). This decision is realized by the phase plan structure itself (06-01/06-02/06-03), not by any single plan's task list, so it is not tracked in the per-plan decision-coverage gate.
  - **Plan 1 — Quick wins:** double-click → Edit (D-19), remove Publish context menu (D-18), GRID-based tmp layout (D-09..D-12). No dependencies; ships first.
  - **Plan 2 — Title-bar UX:** branded submenu + context-sensitive visibility + standalone .py support (D-13..D-18). Depends on Plan 1 (D-16 references new tmp layout from D-10).
  - **Plan 3 — Execution correctness:** workspace-context routing + projectId prompt for remote + shared last-pick cache + save-back UAT (D-01..D-08, D-24 UAT scenarios). Independent of Plans 1+2; can wave in parallel with Plan 1.
  - Planner has final say on wave structure.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & history
- `.planning/ROADMAP.md` §"Phase 6: Script Execution UX & Unified Parameters" — phase goal, 8 success criteria (item 8 "test events" dropped to backlog per D-25)
- `.planning/ROADMAP.md` §"Phase 999.3: Script test-events" (added by this phase) — deferred AWS-Lambda-style test events feature
- `.planning/todos/completed/2026-05-22-phase-05-candidates.md` — original 9-item capture; items 1-8 covered here, item 9 backlogged

### Codebase intelligence
- `.planning/codebase/CONVENTIONS.md` — `altium365.*` command prefix, async/await, `graphqlRequest` reuse, OutputChannel singleton, no module-level state, `Promise<T | undefined>` for cancellable
- `.planning/codebase/STRUCTURE.md` — where new commands/menus live (`package.json` contributes, `extension.ts` handlers, `src/scriptCommands.ts` for script-scoped logic)
- `.planning/codebase/TESTING.md` — manual UAT only; no automated test infrastructure

### Prior-phase decisions still binding
- `.planning/phases/02.3-actionwait-auth/02.3-CONTEXT.md` D-19 — per-workspace `apiServiceUrl` resolved via `getWorkspaceApiUrl(workspaceInfo, envGlobalEndpoint)` — applies to every GraphQL call this phase touches
- `.planning/phases/02.2-auth-hardening/02.2-CONTEXT.md` — auth surface invariants (`ensureWorkspaceToken`, mutex, secret storage); D-02 below must call `ensureWorkspaceToken`, not bypass it
- `.planning/phases/03-remote-script-ops/03-CONTEXT.md` D-05 — workspaceState key `altium365.scriptParams.<scriptId>` is RESERVED for per-script params; D-22/D-23 here preserve that reservation
- `.planning/phases/03-remote-script-ops/03-CONTEXT.md` D-08 — every workspace-scoped GraphQL call uses `ensureWorkspaceToken`
- `.planning/phases/03-remote-script-ops/03-CONTEXT.md` D-09 — single shared `outputChannel`
- `.planning/phases/04-ui-polish/04-CONTEXT.md` D-04 — context-only commands removed from `contributes.commands[]`; the new submenu items (D-14) follow this rule
- `.planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md` D-05/D-07 — reuse `withScriptProgress` for new async sites; do NOT migrate existing wraps this phase

### Code locations referenced in decisions
- `src/extension.ts:514, :562` — `runScript` / `debugScript` palette handlers (D-02)
- `src/extension.ts:634, :699-736, :773` — `prepareRun`, `pickProjectId`, projectId prompt + caching (D-06, D-07, D-08)
- `src/extension.ts:668, :715` — `getActiveAccessToken` call site, `altium365.lastProjectId.<wsId>` key (D-07)
- `src/extension.ts:665` — `getWorkspaceApiUrl(getSelectedWorkspace(context), envGlobalEndpoint)` call to replace with target-aware variant (D-02)
- `src/scriptCommands.ts:289, :308` — `runLocalFromScriptNode` / `debugLocalFromScriptNode` (D-02)
- `src/scriptCommands.ts:339-391` — `downloadScriptToTmp` (D-10, D-12)
- `src/scriptCommands.ts:361-368` — current flat tmp naming pattern (D-10 replaces)
- `src/scriptCommands.ts:373` — `registerLocalScript(tmpPath, identity)` (D-04 — already-correct save-back path)
- `src/scriptCommands.ts:138` — `getLocalScript(fsPath)` cache lookup (D-15)
- `src/localScriptCache.ts:47-51, :80-125` — `getLocalScript`, `registerLocalScriptSaveBridge` (D-04, D-15)
- `src/remoteExecution.ts:88-141` — `executeRemoteScript` Block A (already correctly workspace-scoped; D-01 reference impl)
- `src/remoteExecution.ts:158, :234-253` — Block B `resolveScriptParameters` (D-05, D-06 — add projectId prompt fallback here)
- `src/sidePanel.ts:173-182` — script TreeItem builder, `case 'script'` (D-19 — add `item.command`)
- `src/sidePanel.ts:197` — example of a TreeItem with `command` set (error node) — pattern reference for D-19
- `src/workspace.ts:256-260` — `ScriptInfo` shape (has `scriptId`, `name`, `description`; no `grid` field — D-09 synthesizes from `workspaceAuthId` + `scriptId`)
- `src/auth.ts:587-600` — `getActiveAccessToken` reads selected workspace (D-02 — bypass when `target` provided)
- `package.json:45-132` — `contributes.commands` for script commands (D-17 — `runLocal`/`debugLocal` may need node-less invocation path)
- `package.json:297-313` — current flat `editor/title` entries (D-13 — remove, move to submenu)
- `package.json:314-337` — current `editor/title/run` and `explorer/context` entries gating on `resourceLangId == python` (D-15 reference)
- `package.json:372-376` — `altium365.script.publish` `view/item/context` entry (D-18 — REMOVE)
- `package.json:182-186` — `altium365.promptForProjectId` config schema (D-06 — config respected by remote)

### VS Code API references
- `contributes.submenus` + `contributes.menus."<submenuId>"` — submenu declaration + population (D-13, D-14)
- `vscode.commands.executeCommand('setContext', key, value)` — for `altium365.activeIsRemoteScript` (D-15)
- `vscode.window.onDidChangeActiveTextEditor` — driver for the setContext call (D-15)
- `TreeItem.command` — `{ command, title, arguments }` shape (D-19); see also `sidePanel.ts:197`
- `vscode.workspace.getConfiguration('altium365').get<boolean>('promptForProjectId')` — D-06

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`executeRemoteScript` Block A** (`remoteExecution.ts:88-141`) is the reference implementation for workspace-targeted execution: workspace lookup + `ensureWorkspaceToken({workspaceId, authId})` + `getWorkspaceApiUrl(workspaceInfo, envGlobalEndpoint)`. D-02 generalizes this pattern across local run/debug.
- **`pickProjectId`** (`extension.ts:773`) — existing QuickPick for project selection. Refactor to accept an optional workspace target (D-08) and remote execute reuses it.
- **`altium365.lastProjectId.<wsId>` workspaceState key** (`extension.ts:715`) — already populated by local runs; D-07 shares it with remote.
- **`localScriptCache` registry** (`localScriptCache.ts:47-51`) — already the source of truth for "is this fsPath a remote-tmp script?" — D-15's setContext call reads from it.
- **Existing TreeItem-with-command pattern** (`sidePanel.ts:197`, error node) — exact shape `D-19` needs for the script node.
- **`downloadScriptToTmp`** (`scriptCommands.ts:339`) — single chokepoint for tmp file creation; only one place to change for the new GRID layout (D-10).
- **`withScriptProgress`** (`src/progress.ts`, Phase 5 D-05) — new async sites get a progress UI for free by wrapping in this helper.

### Established Patterns
- **`when` clause + handler check for menu gating** — 04 D-13 established the pattern (regex on `viewItem` + runtime verification). D-15 uses the same shape with `setContext` instead of `viewItem` because we're gating on file state, not tree-node state.
- **Two registration tiers for commands** — palette-eligible commands in `contributes.commands[]` (with `category: "Altium 365"` per 04 D-01..D-04); context-only commands registered only via `vscode.commands.registerCommand` in `extension.ts`. New submenu items are context-only (they're invoked from menus, not the palette).
- **`Promise<T | undefined>` for cancellable ops** (CONVENTIONS.md, 05 D-05) — D-06's projectId prompt returns `undefined` on cancel; caller exits silently.
- **No module-level state except `outputChannel`** — the `setContext` listener (D-15) registers its disposable into `context.subscriptions`, no module-level cache.
- **`graphqlRequest` reuse** — no new GraphQL ops needed; routing changes use existing `listScripts`-style calls if any.

### Integration Points
- **`src/extension.ts`** — refactor `runScriptAtPath`/`debugScriptAtPath` (D-02), `pickProjectId` (D-08); register new `setContext` listener for `altium365.activeIsRemoteScript` (D-15); update `runScript`/`debugScript` palette handlers for no-target case (D-03).
- **`src/scriptCommands.ts`** — pass `target` from `runLocalFromScriptNode`/`debugLocalFromScriptNode` (D-02); rewrite tmp path builder in `downloadScriptToTmp` (D-10, D-12); ensure cache registration still works with new layout.
- **`src/remoteExecution.ts`** — extend `resolveScriptParameters` to fall through to a projectId prompt when no params present (D-05, D-06); pass script's workspace to `pickProjectId` (D-08).
- **`src/sidePanel.ts`** — add `item.command` on script TreeItem (D-19).
- **`package.json`** — declare new submenu `altium365.editorTitle` (D-13); remove four flat `editor/title` entries (D-13); add four submenu menu entries (D-14); remove redundant Publish from `view/item/context` (D-18); confirm `runLocal`/`debugLocal` palette eligibility unchanged per 04 D-02 whitelist.
- **`src/localScriptCache.ts`** — no changes; cache contract already supports D-15 lookups.
- **`src/auth.ts`** — no changes; `ensureWorkspaceToken` is already the right entry point for D-02.

</code_context>

<specifics>
## Specific Ideas

- **GRID format is canonical from Altium platform docs.** `grid:workspace:{workspaceAuthId}:scripts:script/{scriptId}` — embed this comment in `scriptCommands.ts` near the tmp path builder so future readers know why the directory layout looks the way it does.
- **Resist the temptation to over-engineer the projectId prompt for remote.** D-06 is intentionally a minimal bridge: same `pickProjectId`, same cache key, same config flag. Test-events (999.3) will replace this entire flow with a richer UI; don't pre-invest in scaffolding for it now.
- **`altium365.activeIsRemoteScript` is a single boolean context key.** Don't proliferate variants (e.g. `isRemoteTmp`, `hasRemoteIdentity`). One key, set on editor change, drives all submenu visibility decisions.
- **Submenu icon = Altium 365 brand icon.** Reuse `media/altium365.png` (already shipped for the activity bar). The submenu trigger looks like a branded button, not a generic chevron.
- **Cross-workspace flow audit.** Plan 3 UAT MUST exercise: workspace A active, click Run Local on a script in workspace B → script runs against B's token + B's `apiServiceUrl`, output channel shows correct workspace name in header, active workspace remains A throughout.
- **Single-click is the default `TreeItem.command` activation** — there's no "double-click" event in `TreeDataProvider`. Source todo item 4 says "double-click" but VS Code's actual behavior on a leaf with `command` set is single-click. Document this in the plan to avoid confusion.

</specifics>

<deferred>
## Deferred Ideas

- **Item 9: AWS-Lambda-style named "test events" for script parameters.** Multiple named parameter templates per script, editable and switchable, shared across local and remote. Subsumes the current `.params.json` convention and would unify the param model end-to-end with a real UI. **Added to backlog as Phase 999.3.** Depends on this phase's projectId-prompt bridge (D-06) being in place. Will own the reserved `altium365.scriptParams.<scriptId>` workspaceState key (03 D-05).
- **Per-script "Set Parameters" command + editor UI** — subset of item 9; still deferred.
- **"Link to Remote Script" command on standalone .py** — would let users associate a local .py with a workspace+script and unlock Publish / Execute Remote from the submenu. Captured as an option in D-15 discussion but deferred — adds a new workspace+script picker UI and a persistent local↔remote mapping store. Revisit after item 9.
- **Cleanup of legacy `altium365-<scriptId>-<name>.py` flat tmp files** — rejected in D-11 due to risk of clobbering open editors. If tmp clutter becomes a real problem, future phase can add a guarded cleanup (skip files with open editors).
- **Diff / conflict resolution UI** for publish — still deferred to `SCRIPT-V2-03` (per 03 deferred section).
- **Server-side script GRID as a real GraphQL field** — we synthesize it client-side (D-09). If Altium adds a first-class `grid` field to script entities later, swap in.
- **Migration of existing `withProgress` sites to `withScriptProgress`** — still a future cleanup chore (per 05 D-07). Not Phase 6's scope.
- **Telemetry on cross-workspace routing** (e.g. how often users invoke a script from a non-active workspace) — would inform whether the transparent-token UX is correct or whether the prompt option should resurface. No telemetry pipeline yet.
- **Tree multi-select for batch script operations** — not raised by the source todo; mentioning here only to explicitly say it's out of scope.

</deferred>

---

*Phase: 06-script-execution-ux-and-unified-params*
*Context gathered: 2026-05-22*
