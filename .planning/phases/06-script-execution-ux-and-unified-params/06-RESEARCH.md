# Phase 6: Script Execution UX & Unified Parameters - Research

**Researched:** 2026-05-22
**Domain:** VS Code extension UX surface (menus, submenus, TreeItem activation), workspace-targeted execution routing, tmp-file layout, parameter prompt unification
**Confidence:** HIGH (all claims grounded in the existing codebase or VS Code public API docs; CONTEXT.md already locks 25 decisions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
Decisions D-01..D-25 from `06-CONTEXT.md` are all locked. Summary (full text in CONTEXT.md):

- **D-01..D-03** — Workspace-context routing: transparent token, no active-workspace switch; plumb explicit `target?: {workspaceId, workspaceAuthId}` through `runScriptAtPath`/`debugScriptAtPath`; standalone `.py` falls back to active workspace.
- **D-04** — Save-back after Debug Local: NO CODE CHANGE; UAT scenario only (route already correct).
- **D-05..D-08** — Unified params (minimal bridge): bring remote up to local's `projectId` prompt level; reuse `pickProjectId` (refactored to accept `target?: WorkspaceInfo`); share `altium365.lastProjectId.<workspaceId>` cache key; gated by existing `altium365.promptForProjectId` config. Do NOT activate the reserved `altium365.scriptParams.<scriptId>` key.
- **D-09..D-12** — Tmp file layout: GRID synthesized client-side as `grid:workspace:{authId}:scripts:script/{scriptId}`; tmp path becomes `os.tmpdir()/altium365/<authId>/<scriptId>/<safeName>.py`; `mkdirSync(..., {recursive:true})` before write; no legacy migration.
- **D-13..D-18** — Branded "Altium 365" submenu in `editor/title`; four items (Run Local, Debug Local, Execute Remote, Publish) grouped `1_run`, `2_remote`, `3_publish`; context-sensitivity via single boolean context key `altium365.activeIsRemoteScript` set from `onDidChangeActiveTextEditor`; drop `resourceFilename =~ /^altium365-/` regex; add node-less code paths for `runLocal`/`debugLocal`; remove redundant `Publish Script` tree-context entry.
- **D-19..D-20** — TreeItem.command on script node for single-click → Edit (no double-click event exists in `TreeDataProvider`).
- **D-21..D-24** — Cross-cutting: no new GraphQL/auth/config; reuse `withScriptProgress`; preserve `altium365.scriptParams.*` reservation; manual UAT only.
- **D-25** — Three-plan breakdown (Quick Wins / Title-bar UX / Execution Correctness); planner has final say on wave structure.

### Discretion (Planner)
- Wave structure / plan ordering within the three-plan grouping (D-25 confirms but doesn't bind).
- Exact filename sanitization regex (D-10 suggests `[^\w.-]+` → `_`; planner may tighten).
- Whether to keep or relax `1_run`/`2_remote`/`3_publish` group names (D-14 ordering is locked, group naming is cosmetic).
- Defensive handler-level cache re-check inside submenu commands (D-15 calls it a "safety net"; planner decides depth).

### Deferred Ideas (OUT OF SCOPE)
Backlogged from CONTEXT.md:
- AWS-Lambda-style "test events" (Phase 999.3) — owns `altium365.scriptParams.*` key.
- Per-script "Set Parameters" command + editor UI.
- "Link to Remote Script" command for standalone `.py`.
- Cleanup of legacy `altium365-<scriptId>-<name>.py` flat tmp files.
- Diff / conflict UI for publish (SCRIPT-V2-03).
- Server-side `grid` GraphQL field.
- Migration of existing `withProgress` sites to `withScriptProgress`.
- Telemetry on cross-workspace routing.
- Tree multi-select for batch script ops.
</user_constraints>

<phase_requirements>
## Phase Requirements

REQUIREMENTS.md does not enumerate REQ-IDs for Phase 6 (Phase 6 row is "TBD — derive during /gsd-discuss-phase 6"). The authoritative requirement set is **CONTEXT.md decisions D-01..D-25** + **ROADMAP §Phase 6 success criteria SC-1..SC-7** (SC-8 "test events" dropped per D-25).

| ID | Description (from ROADMAP SC list) | Research Support |
|----|-------------------------------------|------------------|
| SC-1 | Run/Debug/Execute on a script node always uses script's owning workspace token | Finding §2.1 (D-02 plumbing path), §2.8 (apiServiceUrl per workspace) |
| SC-2 | Debug-local tmp file save publishes back | Finding §2.4 (cache invariants), §2.5 (collision risk) — UAT only |
| SC-3 | Same parameter model for local/remote ("project-related" preset reproduces today's prompt) | Finding §2.6 (`pickProjectId` callers), §2.7 (Block B insertion point) |
| SC-4 | Double-click script node opens Edit | Finding §2.3 (TreeItem.command single-click semantics) |
| SC-5 | Tmp file named after script's GRID; tab title meaningful | Finding §2.4 (nested layout + cache key) |
| SC-6 | Editor title bar = single branded "Altium 365" dropdown; redundant tree Publish removed | Finding §2.1 (submenu shape), §2.2 (setContext timing) |
| SC-7 | Dropdown also appears for standalone local `.py` | Finding §2.2 (context-key gating), CONTEXT D-15/D-17 |
| ~~SC-8~~ | ~~Test events~~ | **DROPPED — Phase 999.3** |
</phase_requirements>

## 1. Phase Summary

Phase 6 takes the run/debug/execute surface — currently three sibling features that drifted apart — and makes it cohere. Concretely it: (a) routes local run/debug through the script node's owning workspace token instead of the active one (matching what remote execute already does), (b) brings remote execute's parameter handling up to local's `projectId`-prompt level via the existing `pickProjectId` helper, (c) re-lays out tmp files as `tmpdir/altium365/<authId>/<scriptId>/<name>.py` so tab titles become readable, (d) replaces the three flat `editor/title` buttons with a single branded "Altium 365" submenu that adapts to whether the active file is a tracked remote-tmp or a standalone `.py`, (e) wires single-click activation on script tree nodes to Edit, and (f) removes the redundant tree-context Publish entry. Pure TypeScript + `package.json` refactor — no new GraphQL, no auth changes, no new config keys, manual UAT only.

## 2. Technical Findings

### 2.1 VS Code `contributes.submenus` shape + gotchas

**Confidence:** HIGH.

The required `package.json` shape (D-13, D-14) is well-documented in VS Code's API ([CITED: code.visualstudio.com/api/references/contribution-points#contributes.submenus]):

```jsonc
"contributes": {
  "submenus": [
    {
      "id": "altium365.editorTitle",
      "label": "Altium 365",
      "icon": { "light": "media/altium365.png", "dark": "media/altium365.png" }
    }
  ],
  "menus": {
    "editor/title": [
      { "submenu": "altium365.editorTitle", "group": "navigation@1",
        "when": "resourceLangId == python" }
    ],
    "altium365.editorTitle": [
      { "command": "altium365.script.runLocal", "group": "1_run@1",
        "when": "resourceLangId == python" },
      { "command": "altium365.script.debugLocal", "group": "1_run@2",
        "when": "resourceLangId == python" },
      { "command": "altium365.script.executeRemote", "group": "2_remote@1",
        "when": "resourceLangId == python && altium365.activeIsRemoteScript" },
      { "command": "altium365.script.publish", "group": "3_publish@1",
        "when": "resourceLangId == python && altium365.activeIsRemoteScript" }
    ]
  }
}
```

**Render behavior in `editor/title`:** A submenu attached to `editor/title` with `group: "navigation@1"` and an `icon` renders as a single icon button (toolbar slot) that opens a dropdown on click. Without an `icon`, it would collapse into the "..." overflow menu instead. The Altium brand icon is already shipped at `media/altium365.png` (used by the activity bar in `package.json`; verified [VERIFIED: codebase]).

**`when` clause semantics on submenu items vs the parent submenu entry** [CITED: code.visualstudio.com/api/references/when-clause-contexts]:
- The `when` on the parent menu entry (in `editor/title`) controls **whether the submenu button is rendered at all**.
- The `when` on each item inside `menus["altium365.editorTitle"]` controls **whether that item appears in the opened dropdown**.
- If every item's `when` evaluates false, the dropdown opens to an empty menu (still rendered). Practical mitigation: gate the parent on `resourceLangId == python` so the button only appears on `.py` files; gate individual items further.

**Known issue:** Submenu items do NOT appear in the Command Palette regardless of their command's palette eligibility — palette eligibility is controlled separately by `contributes.menus["commandPalette"]` (or omission of a `when: false`). The existing four script commands are already palette-eligible from Phase 4 D-02; that whitelist is unchanged.

**Citations:** [CITED: code.visualstudio.com/api/references/contribution-points#contributes.submenus], [CITED: code.visualstudio.com/api/extension-guides/tree-view#view-actions]

### 2.2 `setContext` + `onDidChangeActiveTextEditor` timing

**Confidence:** HIGH.

Findings:

1. **Initial state on activation.** `setContext` is only as fresh as the last call. `onDidChangeActiveTextEditor` does NOT fire automatically for the editor already active at the moment a listener is registered. The extension MUST seed the context key on activation: read `vscode.window.activeTextEditor` once inside `activate()` and call `setContext(..., …)` synchronously, THEN register the `onDidChangeActiveTextEditor` listener. Otherwise the submenu shows the wrong items until the user clicks another tab. [CITED: code.visualstudio.com/api/references/vscode-api#window.activeTextEditor]

2. **`activeTextEditor === undefined`.** When focus is in a non-editor view (terminal, side panel, etc.) `activeTextEditor` becomes `undefined` and `onDidChangeActiveTextEditor` fires with `undefined`. The listener MUST handle this — clear the context key to `false` rather than leaving it stale.

3. **Race on tab close + reopen.** Closing the editor and opening a different one can fire the listener twice in quick succession (close → undefined → new editor → newEditor). Idempotent `setContext` calls are fine — no debounce needed.

4. **Pre-`activate()` calls are not silently dropped.** They are deferred until activation completes. But D-15's pattern (seed-in-activate then listen) avoids the timing window entirely.

**Implementation pattern for D-15:**
```ts
function updateActiveRemoteContext(editor: vscode.TextEditor | undefined) {
    const isRemote = editor?.document.uri.scheme === 'file'
        && getLocalScript(editor.document.uri.fsPath) != null;
    vscode.commands.executeCommand('setContext',
        'altium365.activeIsRemoteScript', !!isRemote);
}
// inside activate():
updateActiveRemoteContext(vscode.window.activeTextEditor);              // seed
context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateActiveRemoteContext) // listen
);
```

Note: The cache is also mutated by `registerLocalScript` calls from `downloadScriptToTmp` (`scriptCommands.ts:373`). When a fresh download completes for the currently active editor, the context key needs to be re-evaluated. The simplest fix is to call `updateActiveRemoteContext(vscode.window.activeTextEditor)` from inside `registerLocalScript` callers after registration — but cleaner is to have `downloadScriptToTmp` re-run the update once after `registerLocalScript`. Planner decides.

### 2.3 `TreeItem.command` single-click vs double-click semantics

**Confidence:** HIGH. CONTEXT D-19's claim is correct.

**Findings:**
- There is no double-click event in `vscode.TreeDataProvider`. Setting `TreeItem.command = { command, title, arguments }` causes VS Code to **invoke the command on single-click** of a leaf node. [CITED: code.visualstudio.com/api/references/vscode-api#TreeItem.command]
- Existing precedent in the codebase: `sidePanel.ts:197` sets `item.command` on the error node (verified [VERIFIED: codebase] — `command: 'altium365.tree.retryNode'`). Phase 6 follows that exact pattern.
- **User setting `workbench.list.openMode`** is a window-level preference: `singleClick` (default) or `doubleClick`. If a user has set it to `doubleClick`, the activation requires a double-click. This is OS-wide for all list/tree views and is not extension-controllable. No mitigation needed — it's the user's explicit preference. Document in UAT scenario only.
- The source todo (item 4) uses the word "double-click" colloquially. The actual VS Code behavior is single-click activation with the default `workbench.list.openMode`. D-20 captures this for the README.

**Implementation (matches D-19 verbatim):**
```ts
// sidePanel.ts case 'script' (currently lines 173-184)
item.command = {
    command: 'altium365.script.edit',
    title: 'Edit Script',
    arguments: [n],
};
```

### 2.4 `registerLocalScript` save-bridge behavior across nested subdirectories

**Confidence:** HIGH. D-04's claim holds.

The cache (`src/localScriptCache.ts:40-60`, verified [VERIFIED: codebase]) keys on `key(fsPath)` where `key` is a path normalization (lowercase on Windows; raw on POSIX). It is fsPath-agnostic with respect to directory depth — a path like `/tmp/altium365/<authId>/<scriptId>/<name>.py` is just another string from the cache's perspective.

The save bridge (`localScriptCache.ts:80-125`, verified [VERIFIED: codebase]) does `getLocalScript(doc.uri.fsPath)` and proceeds if a hit is found. No path normalization, no parent-directory walking, no depth assumption.

**Side note (worth flagging in plan):** the save bridge guards `doc.uri.scheme !== 'file'` and returns early. The new nested path is still `file://` scheme — no issue. The bridge also bypasses `vscode.workspace.fs.writeFile` (per the comment block at `:75-79` re UAT-7) and calls `remoteFs.writeFile` directly — that path doesn't touch fsPath structure.

**No code change required to `localScriptCache.ts`** to support D-10's new layout.

### 2.5 Pre-existing tmp file collision risk

**Confidence:** MEDIUM-HIGH. Risk is real but bounded.

Scenario: user previously opened `/tmp/altium365-S123-foo.py` (old flat layout) which lives in the cache under that fsPath. They click Edit Script on the same script again → new download writes to `/tmp/altium365/<authId>/S123/foo.py` and calls `registerLocalScript(newPath, identity)`. Cache now has TWO entries pointing to the same `{workspaceAuthId, scriptId, scriptName}` identity.

**Behavior of the save bridge in this state** (analyzed against `localScriptCache.ts:80-125`):
- Both files are independently saveable.
- Saving the OLD path → save bridge hits → publishes to the remote script (correct, just stale-looking path).
- Saving the NEW path → save bridge hits → publishes to the remote script (correct).
- **No conflict, no data loss** — both paths converge on the same remote scriptId via `buildScriptUri(authId, scriptId, name)`.

**The user-visible weirdness** is having two tabs open for the same logical script. The OUTPUT channel will log two distinct paths. D-11 explicitly accepts this — "Old files purge naturally via OS tmp cleanup or extension reinstall."

**Find-by-remote-id quirk:** `findLocalScriptByRemoteId(scriptId)` (verified [VERIFIED: codebase], `localScriptCache.ts:65-73`) returns the FIRST entry it encounters. After a fresh download under the new layout, this could return either the old or new path depending on insertion order. The Publish Script command (still wired from the new submenu via D-14) uses this lookup. Risk: it may save the wrong (old, stale) buffer if the user has both tabs open and modified both. **Probability low** (most users won't have a stale old-layout tab open after Phase 6 ships), but worth a one-line mitigation: `findLocalScriptByRemoteId` could prefer entries whose path starts with the new prefix `os.tmpdir()/altium365/`. Planner call.

### 2.6 `pickProjectId` refactor surface

**Confidence:** HIGH. There is exactly ONE caller today.

`pickProjectId` is defined at `src/extension.ts:773` (signature `(context, endpoint, accessToken, last) => Promise<string | undefined>`) [VERIFIED: codebase].

`grep "pickProjectId" src/**/*.ts` (executed) returns:
- `extension.ts:717` — call site inside `prepareRun`
- `extension.ts:773` — declaration

**That's it. One internal caller, no exports.**

D-08 refactor:
```ts
async function pickProjectId(
    context: vscode.ExtensionContext,
    endpoint: string,
    accessToken: string,
    last: string,
    target?: WorkspaceInfo   // NEW — default: read getSelectedWorkspace
): Promise<string | undefined> {
    const wsName = (target ?? getSelectedWorkspace(context))?.name || '-';
    // … rest unchanged …
}
```

Migration impact:
- `prepareRun` call site (`extension.ts:717`) → no change; passes 4 args, `target` defaults to undefined → preserves existing behavior.
- New caller in `remoteExecution.ts` (per D-06) → passes 5 args with the script's `WorkspaceInfo`.
- D-08 also requires `pickProjectId` to be **exported** from `extension.ts` (or moved to a shared module) so `remoteExecution.ts` can import it. Currently it's a `async function` (no `export`). Planner decides: export from `extension.ts` (simple) vs. extract to `src/projectPicker.ts` (cleaner). **Recommendation:** extract — `extension.ts` is already 484 lines (per AGENTS.md), adding remoteExecution imports back into it grows the import graph awkwardly.

### 2.7 `executeRemoteScript` Block B param-resolution control flow

**Confidence:** HIGH.

Today (`remoteExecution.ts:158`, verified [VERIFIED: codebase]):
```ts
// ----- Block B: parameters (D-05) -----
const parameters = resolveScriptParameters(args.context, args.scriptId);
```
`resolveScriptParameters` (`:234-253`) checks `workspaceState['altium365.scriptParams.<scriptId>']`. If absent → returns `undefined`. If present → returns array of `{key, value:String(v)}`. **No prompt today.** Returning `undefined` causes `executeScript` to omit the `parameters` field, server uses script defaults.

**D-06 insertion point:** Inside Block B, AFTER the `resolveScriptParameters` call, BEFORE Block C. Logic:

```ts
let parameters = resolveScriptParameters(args.context, args.scriptId);

// D-06: if no per-script params AND user opted into the prompt,
// fall through to pickProjectId with the SCRIPT'S workspace target.
if (parameters === undefined) {
    const wcfg = vscode.workspace.getConfiguration('altium365');
    if (wcfg.get<boolean>('promptForProjectId', true)) {
        const lastKey = `altium365.lastProjectId.${args.workspaceId}`;
        const last = args.context.globalState.get<string>(lastKey, '');
        const picked = await pickProjectId(
            args.context, apiUrl, wsToken, last, ws  // pass target workspace
        );
        if (picked === undefined) return undefined;  // cancel → bubble silent
        if (picked) {
            await args.context.globalState.update(lastKey, picked);
            parameters = [{ key: 'projectId', value: picked }];
        }
    }
}
```

**Critical:** Place this INSIDE the existing `withScriptProgress` wrapper (Block A/B are already wrapped at `remoteExecution.ts:93`). The prompt is interactive but `withScriptProgress` is cancellable; a user cancelling the progress UI mid-prompt should abort the whole flow. D-22 explicitly says "no extra wrap needed."

### 2.8 Cross-workspace `apiServiceUrl` resolution

**Confidence:** HIGH.

Phase 02.3 D-19 locks: `getWorkspaceApiUrl(workspaceInfo, envGlobalEndpoint)` resolves per-workspace API URL with env-global fallback. Signature verified in `src/workspace.ts` (imported in `extension.ts:16`, `remoteExecution.ts:12`).

Current usage:
- `extension.ts:665` (`prepareRun`): `getWorkspaceApiUrl(getSelectedWorkspace(context), envGlobalEndpoint)` — reads **active** workspace. **Must change for D-02** to use the `target` workspace when provided.
- `remoteExecution.ts:148` (Block A): `getWorkspaceApiUrl(ws, args.envGlobalEndpoint)` — already correct (uses script's `ws`).

**D-02 implementation requires Block A's pattern to be replicated inside `prepareRun`:** when `target?: WorkspaceInfo` is passed in, look up the workspace (or accept it pre-resolved from caller), call `ensureWorkspaceToken({workspaceId: target.workspaceId, authId: target.authId})` (bypassing `getActiveAccessToken`'s active-workspace read at `auth.ts:587-600`), and call `getWorkspaceApiUrl(target, envGlobalEndpoint)`.

**Asymmetry to resolve:** `prepareRun` accepts only an fsPath + context today; the caller (`runLocalFromScriptNode`) already has the full `WorkspaceInfo` available via its node (`scriptCommands.ts:289`). Easiest plumbing: `prepareRun(context, uriOrPath, target?)` where `target` is `WorkspaceInfo` (matching D-02's contract). Inside, branch on `target` for endpoint + token; fall through to existing active-workspace logic when `target === undefined`.

**Dispatcher complication (LANDMINE — see §5):** `runLocalFromScriptNode` does NOT currently resolve full `WorkspaceInfo` — it has a `ScriptContext` from `resolveScriptContext` (`scriptCommands.ts:140`) which only carries `{workspaceAuthId, scriptId, scriptName}` plus `workspaceId` from the node. To call `getWorkspaceApiUrl(ws, ...)` cleanly, the caller needs the full `WorkspaceInfo` (which carries `apiServiceUrl`). Phase 03 D-08 + remoteExecution's Block A already solved this by falling back to `listWorkspaces` when active workspace doesn't match. D-02's plumbing should reuse that pattern: pass `{workspaceId, workspaceAuthId}` (not the full WorkspaceInfo) and let `prepareRun` resolve `WorkspaceInfo` via the same `getSelectedWorkspace + listWorkspaces fallback` pattern. **Mirror remoteExecution.ts:99-127 verbatim.**

## 3. Validation Architecture

TESTING.md confirms manual UAT only (no automated framework). One scenario per success criterion:

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None — manual UAT (per TESTING.md and 03 D-13) |
| Config file | n/a |
| Quick run command | n/a |
| Full suite command | `npm run compile` (build gate only) |

### Phase Requirements → UAT Scenarios

| Req | Scenario | Pass Criteria |
|-----|----------|---------------|
| SC-1 | **Cross-workspace run/debug routing.** Active workspace = A. In side panel, expand workspace B, right-click a script, "Run Script (Local)". | OutputChannel header shows `workspace=B` (NOT A). Script executes successfully. Active workspace in tree remains A (workspace cue unchanged). Repeat for "Debug Script (Local)". |
| SC-2 | **Debug-local save-back.** Debug a remote script. Edit a line in the opened tmp tab. Press Cmd+S. | Status bar shows `Altium 365: published <scriptName>`. Refresh side panel → server-side script reflects edit. (If repro fails, raise a defensive plan per D-04.) |
| SC-3 | **Unified projectId prompt.** Set `altium365.promptForProjectId: true`. Right-click a remote script → Execute Remotely. Pick a project. Then trigger Run (Local) on the same script in the same workspace. | Remote execute prompted for project; selected project sent as `parameters: [{key:'projectId', value:…}]`. Subsequent Run (Local) QuickPick pre-fills with the last value (shared cache key `altium365.lastProjectId.<workspaceId>`). Reverse direction also works (Local → Remote inherits). |
| SC-4 | **Single-click → Edit.** Open the side panel, single-click a script leaf node. | Edit Script command runs; file opens in editor; identical behavior to right-click → Edit Script. (Tested with `workbench.list.openMode: singleClick`, VS Code default.) |
| SC-5 | **GRID tmp layout + readable tab title.** Edit a remote script named "Bom Report". | Tab title displays as `Bom_Report.py` (NOT `altium365-S123-Bom_Report.py`). On disk, file lives at `os.tmpdir()/altium365/<authId>/<scriptId>/Bom_Report.py`. Two scripts of the same name in different workspaces do NOT collide. |
| SC-6 | **Branded submenu replaces flat buttons; tree Publish removed.** Open a remote tmp file. Look at editor title bar. Right-click a script tree node. | Editor title shows ONE Altium 365 brand icon button. Clicking it opens a dropdown with: Run Local, Debug Local, Execute Remote, Publish (in that order). The three old flat buttons are gone. The tree context menu shows: Run Local, Debug Local, Execute Remote, Edit Script (NO Publish). |
| SC-7 | **Submenu on standalone .py.** Open any local `.py` file (NOT a tracked remote tmp). Look at editor title bar. | Altium 365 brand icon appears. Dropdown contains ONLY Run Local + Debug Local. Publish and Execute Remote items are hidden. Running Run Local uses the active workspace (per D-03). |

### Sampling Rate
- **Per task commit:** `npm run compile` (build must pass).
- **Per wave merge:** `npm run compile` + visual smoke check (open VS Code, click into the side panel).
- **Phase gate:** Full UAT script above, executed once end-to-end before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] None — no test infrastructure to add. UAT scripts are documented inline in plans and consolidated in the eventual VERIFICATION.md when `/gsd-verify-work` runs.

## 4. MVP Slice Recommendation

CONTEXT D-25 confirms a three-plan breakdown. Mapping to vertical-slice MVP thinking:

**Slice 1 — Quick Wins (ships first, observable UX win immediately).**
- D-19 (single-click Edit) — 1-line `package.json`-style change in `sidePanel.ts`.
- D-18 (drop redundant tree Publish entry) — `package.json` deletion.
- D-09..D-12 (GRID tmp layout) — single chokepoint refactor in `downloadScriptToTmp` (`scriptCommands.ts:339-391`).
- Independent of all other slices. Users see: meaningful tab titles + cleaner tree menu + single-click open. **Ship as one plan, one commit per item.**

**Slice 2 — Title-bar UX (depends on Slice 1's D-16 reference to new tmp layout).**
- D-13..D-17 (submenu + setContext + node-less handlers).
- Touches `package.json` (submenu declaration + 4 item entries + 3-4 removed entries), `extension.ts` (setContext listener + activate-time seed), `scriptCommands.ts` (node-less paths for runLocal/debugLocal).
- Depends on D-16's removal of the `resourceFilename =~ /^altium365-/` regex, which only makes sense after the new layout (Slice 1's D-10) is in place.
- **Why slice 2:** without Slice 1, the regex change would break the existing tmp file detection on day 1.

**Slice 3 — Execution Correctness (independent of Slices 1 & 2; parallel-safe).**
- D-01..D-08 (workspace routing + projectId bridge + shared cache + UAT scenario D-24).
- Touches `extension.ts` (`prepareRun`, `pickProjectId` refactor), `scriptCommands.ts` (dispatcher target plumbing), `remoteExecution.ts` (Block B insertion), `auth.ts` (no change — `ensureWorkspaceToken` already correct).
- Largest surface area but logically independent. **Could ship before, after, or parallel to Slices 1+2.**

**Recommendation:** Plan 1 = Slice 1 (Quick Wins). Plan 2 = Slice 2 (Title-bar UX). Plan 3 = Slice 3 (Execution Correctness). Waves: **W1 = Plan 1 + Plan 3 in parallel** (no shared files of concern — Plan 1 touches `scriptCommands.ts`'s `downloadScriptToTmp`, Plan 3 touches `runLocalFromScriptNode`/`debugLocalFromScriptNode` + `prepareRun`; **MERGE CONFLICT RISK in `scriptCommands.ts`** — see Landmine §5.6). **W2 = Plan 2** (sequential after Plan 1 lands because of D-16 dependency).

Alternative if planner wants stricter sequencing: **W1 = Plan 1, W2 = Plan 2 + Plan 3 in parallel** (Plan 3 only touches `runLocalFromScriptNode` body; Plan 2 only adds node-less code paths to the same function — still some risk, but less than W1).

**Thinnest end-to-end demo:** Slice 1 alone gives "tab title is now readable; single-click opens; tree menu is cleaner." That's already a shippable improvement on its own.

## 5. Landmines

### 5.1 Submenu icon path
**Trap:** `contributes.submenus[].icon` path is resolved relative to the extension root and must exist on disk; a missing file silently degrades to the default chevron with no error in the developer console.
**Mitigation:** `media/altium365.png` already exists (verified — used by the activity bar). Use the same path. Confirm `npm run package` includes `media/` in the VSIX (it does today per Phase 1).

### 5.2 `setContext` not seeded on activation
**Trap:** `onDidChangeActiveTextEditor` does NOT fire for the editor already active when the extension activates. If you only register the listener without seeding, the submenu items are invisible/wrong until the user clicks another editor.
**Mitigation:** Inside `activate()`, call the context-updater function once synchronously against `vscode.window.activeTextEditor` BEFORE registering the listener (see §2.2 code pattern). Also re-fire after `registerLocalScript` mutates the cache for the currently active editor.

### 5.3 Stale Command Palette entries after removing menu entries
**Trap:** Removing entries from `contributes.menus["editor/title"]` while keeping the commands in `contributes.commands[]` causes the commands to remain palette-discoverable. Phase 4 D-02 whitelisted these four commands for palette deliberately (`category: "Altium 365"`).
**Mitigation:** Confirm Phase 4 D-02 whitelist is still intended. CONTEXT D-21 + D-25's "no new config" implies yes. All four commands (runLocal, debugLocal, executeRemote, publish) stay palette-visible per their existing `category` field — no action needed, just confirm. Do NOT add `"when": "false"` to their palette entries — they need to remain palette-invocable so power users can bind keyboard shortcuts.

### 5.4 Workspace name in OutputChannel header
**Trap:** D-01 mandates "no active-workspace switch." But the OutputChannel header in `remoteExecution.ts:176` reads `args.workspaceName`, which today is populated in `scriptCommands.ts:433` as `'<workspace-name unknown>'` when the active workspace doesn't match the script's workspace (verified — `scriptCommands.ts:436-441`). Cross-workspace execute today already produces ugly headers like `workspace=<workspace-name unknown>`.
**Mitigation:** D-02's plumbing must resolve the target workspace's name. The Block A fallback in `remoteExecution.ts:99-127` already does `listWorkspaces` to find the WorkspaceInfo by `workspaceId`; the result has `.name`. Update Block A to OVERWRITE `args.workspaceName` (or set it) using the resolved ws.name before Block C runs the header. Same fix applies to the new local run/debug routing (D-02) — the OutputChannel header in `runScriptAtPath` should report the target workspace name, not the active one. Verify no other call site reads `args.workspaceName` as immutable.

### 5.5 `pickProjectId` double-prompt risk
**Trap:** If a caller passes parameters AND `pickProjectId` is still invoked downstream, the user sees the QuickPick after already configuring params.
**Mitigation:** D-06's guard is `if (parameters === undefined)` — the only path that enters the prompt is when `resolveScriptParameters` returned undefined AND config is enabled. `resolveScriptParameters` reads only the reserved `altium365.scriptParams.<scriptId>` key (which D-23 keeps reserved/unused this phase) — so the guard always evaluates `undefined` today, and the prompt always runs (when config enabled). No double-prompt because there's no other params source feeding remote execute. When Phase 999.3 lands, it will own this guard and replace the prompt entirely.

### 5.6 `scriptCommands.ts` merge conflict between Slice 1 + Slice 3
**Trap:** Slice 1 rewrites `downloadScriptToTmp` (`:339-391`). Slice 3 modifies `runLocalFromScriptNode` (`:289`) + `debugLocalFromScriptNode` (`:308`). Same file, adjacent functions — git auto-merge usually fine but not guaranteed.
**Mitigation:** Either sequence (Slice 1 first, then Slice 3) or have the planner ensure both plans annotate the file as "touched" in the wave manifest. Atomic per-plan commits make conflict resolution trivial.

### 5.7 Legacy tmp file double-registration
**Trap:** §2.5 scenario — user has old flat tmp tab open, triggers fresh download → cache holds two entries for one remote scriptId.
**Mitigation:** Accept per D-11 (no migration). Optionally bias `findLocalScriptByRemoteId` toward new-layout paths (path starts with `<tmpdir>/altium365/`). Planner decides.

### 5.8 `pickProjectId` is not exported
**Trap:** D-06 needs `remoteExecution.ts` to call `pickProjectId`, but it's a private `async function` in `extension.ts` (no `export`).
**Mitigation:** Either `export` it from `extension.ts` (minimal change), or extract to `src/projectPicker.ts` (cleaner separation per AGENTS.md "no module-level state"). **Recommend extraction** — `extension.ts` is already 484 lines and importing from it creates a circular-ish dependency (remoteExecution → extension → remoteExecution chain risk).

### 5.9 Submenu icon overrides item icons
**Trap:** When a submenu is rendered in `editor/title`, individual command icons inside the dropdown are NOT shown (it's a flat label list). Don't waste effort defining icons on the four submenu commands — they only render text.
**Mitigation:** None needed; just don't expect a $(play) icon next to "Run Local" in the dropdown.

### 5.10 `resourceFilename` regex removal interaction
**Trap:** Today's `editor/title` entries gate on `resourceScheme == altium365 || resourceFilename =~ /^altium365-/`. After D-16 + D-10, both halves go away. But the `view/item/context` menu doesn't use this regex — it uses `viewItem == scriptNode`. No interaction. Verified by reading package.json:290-345.
**Mitigation:** None needed — flagged here only to head off "what about the regex elsewhere" questions during plan review.

## 6. Open Questions for Planner

1. **Where does `pickProjectId` live after refactor?** `export` from `extension.ts` (1-word change) vs extract to `src/projectPicker.ts` (cleaner, ~30 lines moved). Both honor D-08. Recommend extraction; planner has final say.

2. **`findLocalScriptByRemoteId` ordering bias.** Add a "prefer new-layout paths" tiebreak (defensive against §5.7) or accept current behavior? Low impact either way; pragmatic call.

3. **Wave structure within D-25 grouping.** §4 recommends `W1 = Plan 1 + Plan 3 parallel`, `W2 = Plan 2`. Planner may prefer strict sequence (W1=Plan 1, W2=Plan 2, W3=Plan 3) to eliminate the §5.6 merge-conflict risk entirely.

4. **Submenu icon styling — light + dark variants?** D-13 says one icon path. `media/altium365.png` is currently a single asset. If it doesn't render legibly in both themes, do we add `light`/`dark` variants now or defer? (Likely defer — current activity-bar icon is already single-asset.)

5. **`runLocal`/`debugLocal` node-less behavior on standalone .py — UI feedback when no workspace selected?** D-17 + D-03 say "fall back to active workspace" → if no active workspace, "the existing 'select workspace first' prompt fires." Confirm the existing prompt text (in `prepareRun`) is appropriate, or do we need a more contextual message ("Run Local from standalone .py requires an active Altium 365 workspace — select one first")? Cosmetic, planner call.

6. **Should `downloadScriptToTmp` also call `updateActiveRemoteContext` after `registerLocalScript`?** §2.2 flags this — fresh download for the active editor doesn't auto-update the context key. Cleanest fix is a callback hook; planner decides whether to add it now or defer until reported as a real bug.

## 7. Sources

### Primary (HIGH confidence)
- **Codebase (VERIFIED):** `src/extension.ts:514, :562, :634, :699-736, :773`; `src/scriptCommands.ts:289, :308, :339-391, :433-441`; `src/remoteExecution.ts:88-260`; `src/localScriptCache.ts:40-125`; `src/sidePanel.ts:173-205`; `src/auth.ts:580-610`; `package.json:45-380`
- **GSD planning artifacts:** `.planning/phases/06-script-execution-ux-and-unified-params/06-CONTEXT.md` (25 locked decisions); `.planning/ROADMAP.md` §Phase 6; `.planning/codebase/CONVENTIONS.md`, `STRUCTURE.md`, `TESTING.md`
- **Prior-phase CONTEXTs:** 02.2, 02.3 (D-19), 03 (D-05, D-08, D-09), 04 (D-02, D-04, D-13), 05 (D-05, D-07)

### Secondary (CITED — official docs)
- VS Code Extension API — `contributes.submenus` + `contributes.menus`: [code.visualstudio.com/api/references/contribution-points#contributes.submenus]
- VS Code Extension API — `when` clause contexts: [code.visualstudio.com/api/references/when-clause-contexts]
- VS Code Extension API — `TreeItem.command`: [code.visualstudio.com/api/references/vscode-api#TreeItem]
- VS Code Extension API — `window.activeTextEditor` + `onDidChangeActiveTextEditor`: [code.visualstudio.com/api/references/vscode-api#window]
- VS Code Extension API — Tree View Actions: [code.visualstudio.com/api/extension-guides/tree-view#view-actions]

### Tertiary (none)
No LOW-confidence claims in this research — all findings ground in the codebase or VS Code's first-party API docs.

## 8. Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `media/altium365.png` will render legibly as a single asset in both light and dark editor themes | §5.1, §5.9 | Submenu button looks bad in one theme. Easy late fix (add `light`/`dark` variants). |
| A2 | `findLocalScriptByRemoteId`'s "first match wins" semantics don't cause user-visible incorrect-buffer publishes during the legacy-tmp transition window | §2.5, §5.7 | Wrong buffer published to remote. Mitigated by D-11's "no legacy migration" + low probability of having both old + new tmp tabs open simultaneously. |
| A3 | The Phase 4 D-02 palette whitelist for the four script commands remains intentional and unchanged | §5.3 | Commands disappear from palette. CONTEXT D-21 implies no change; verify with planner. |

## 9. Environment Availability

Skipped — Phase 6 is pure code/config changes (TypeScript + `package.json`). No new external dependencies, runtimes, or tools.

## Metadata

**Confidence breakdown:**
- Submenu / menu surface (§2.1, §2.2, §5.1-5.3, §5.9): HIGH — VS Code API is stable and well-documented.
- TreeItem activation (§2.3): HIGH — existing precedent at `sidePanel.ts:197` plus official docs.
- Cache + save bridge (§2.4, §2.5): HIGH — read the cache implementation directly; no edge cases hidden.
- `pickProjectId` refactor (§2.6): HIGH — one caller, trivial migration.
- Block B insertion (§2.7): HIGH — control flow read directly.
- Cross-workspace endpoint resolution (§2.8, §5.4): MEDIUM-HIGH — pattern exists in Block A but Block A's plumbing is more elaborate than `prepareRun` will need; one landmine (workspaceName plumbing) flagged.
- Wave structure (§4): MEDIUM — pragmatic recommendation; planner has final say.

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (30 days — VS Code API surface is stable; codebase pointers are line-numbered and may drift on file edits, but file structure is well-anchored).

## RESEARCH COMPLETE

**Phase:** 6 - Script Execution UX & Unified Parameters
**Confidence:** HIGH

### Key Findings
- CONTEXT.md already locks 25 implementation decisions; this research validates each against the codebase and surfaces 10 concrete landmines.
- `pickProjectId` has exactly ONE caller (`extension.ts:717`) — refactor is low-risk; recommend extracting to `src/projectPicker.ts` rather than exporting from the already-bloated `extension.ts`.
- Cross-workspace `workspaceName` plumbing (§5.4) is the highest-impact landmine — today the OutputChannel header shows `<workspace-name unknown>` when active≠target; Plan 3 must fix this alongside D-02 routing.
- §2.5 + §5.7: legacy tmp file collision risk is real but bounded — the save bridge handles double-registration correctly; only `findLocalScriptByRemoteId` has a tiebreak ambiguity worth a one-line defensive bias.
- Three-plan structure from D-25 is sound. Recommended waves: W1 = Plan 1 (Quick Wins) + Plan 3 (Execution Correctness) parallel, W2 = Plan 2 (Title-bar UX, depends on D-16 → D-10). Alternative: strict sequential to eliminate §5.6 merge risk.

### File Created
`.planning/phases/06-script-execution-ux-and-unified-params/06-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack (none added) | HIGH | No new dependencies per D-21. |
| Architecture (submenu, setContext, routing) | HIGH | VS Code API stable; codebase patterns already established. |
| Pitfalls | HIGH | 10 landmines surfaced with concrete mitigations. |
| Validation (manual UAT) | HIGH | One scenario per SC, mapped to D-24's coverage list. |

### Open Questions
6 questions for the planner in §6 — all narrow tactical decisions (file layout, ordering bias, wave structure, theming, UX copy, cache-update hook).

### Ready for Planning
Research complete. Planner can now create three PLAN.md files matching the D-25 grouping.
