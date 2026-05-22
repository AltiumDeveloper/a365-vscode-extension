---
phase: 06-script-execution-ux-and-unified-params
verified: 2026-05-23T00:00:00Z
status: human_needed
score: 7/7 must-haves verified (SC-8 deferred per ROADMAP)
overrides_applied: 0
human_verification:
  - test: "Cross-workspace Run Local — token routing"
    expected: "Open side panel, expand a workspace that is NOT the currently-active one, right-click a script → Run Script (Local). OutputChannel header reads `[Altium 365] Workspace: <that other workspace's name>` and the script lists projects from that workspace (not the active one). Active workspace selection in the side panel is unchanged."
    why_human: "End-to-end OAuth + cross-workspace GraphQL call requires real A365 tenant credentials and at least two accessible workspaces; cannot be exercised offline."
  - test: "Debug Local save-back publishes to remote (SC-2)"
    expected: "Right-click script → Debug Script (Local). Once debugpy is attached, edit the file in the editor, hit Cmd+S. Status bar shows `Altium 365: published <name>`; refresh the workspace and confirm the remote body reflects the edit."
    why_human: "Requires running debugpy session against a live A365 script; save bridge fires on `onDidSaveTextDocument` but its end-to-end publish round trip is only observable against a real workspace."
  - test: "Unified projectId prompt symmetry (SC-3)"
    expected: "Run Local on script A in workspace W → pick projectId X. Then Execute Remotely on script B in the same workspace W → QuickPick should pre-select X (shared cache key `altium365.lastProjectId.<workspaceId>`). Reverse direction also works."
    why_human: "Verifies behavioral coherence across local↔remote flows; requires live workspace + projects."
  - test: "Double-click → Edit (SC-4) under default settings"
    expected: "With `workbench.list.openMode` left at default, single-click on a script tree leaf opens the file (Edit). No double-click required."
    why_human: "Visual UX confirmation — code wires `TreeItem.command` correctly but only a human can observe the click-feel matches expectations."
  - test: "Tab title is readable script name (SC-5)"
    expected: "Edit/Run/Debug a remote script named e.g. `Bom Report`. Editor tab reads `Bom_Report.py` (not `altium365-<id>-Bom_Report.py`). Two scripts with identical names in different workspaces open in distinct tabs (no collision)."
    why_human: "Visual confirmation of the tab title and on-disk GRID layout (`$TMPDIR/altium365/<authId>/<scriptId>/<name>.py`)."
  - test: "Branded submenu in editor title bar (SC-6)"
    expected: "Open any `.py` file. Title bar shows a single Altium 365 branded dropdown (with the brand icon, not a codicon) — clicking opens 4 items: Run Python Script, Debug Python Script, then on remote-tmp tabs also Execute Script Remotely and Publish Script. No flat trio of buttons remains. Tree right-click on a script node no longer shows `Publish Script` (Edit/Run Local/Debug Local/Execute Remotely only)."
    why_human: "UI surface confirmation — code wiring is correct (single submenu attachment in `editor/title`, four entries in `altium365.editorTitle` menu key, gating context keys present), but visual presence of the icon and adaptive item visibility on tab switching must be eyeballed."
  - test: "Standalone .py dropdown adapts (SC-7)"
    expected: "Open a random local `.py` file (not downloaded from A365). Title bar Altium 365 dropdown shows only Run Python Script + Debug Python Script. Execute Remotely + Publish do not appear. Both visible items work against the active workspace."
    why_human: "Context-key driven visibility (`altium365.activeIsRemoteScript`) must be observed flipping per active editor; sync cache rehydration is also indirectly verified by reopening previously-tracked remote tmp tabs."
---

# Phase 06: script-execution-ux-and-unified-params Verification Report

**Phase Goal:** Make the run/debug/execute flows feel coherent — execution always runs in the script's own workspace context, save-back works after debug, parameters behave identically across local and remote, and the editor surface (tabs, title bar, default activation) matches what users expect from a first-class A365 integration.

**Verified:** 2026-05-23
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth (Success Criterion)                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                  |
| -- | ---------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | SC-1: Run/Debug/Execute on a script node uses script's owning workspace token + endpoint                  | ✓ VERIFIED | `src/extension.ts:723-766` — `prepareRun` accepts `target?: { workspaceId, workspaceAuthId }`; resolves the workspace via `getSelectedWorkspace` ?? `listWorkspaces().find`, mints a workspace-scoped token via `ensureWorkspaceToken`, sources endpoint from `getWorkspaceApiUrl(resolvedWs, ...)`. `src/scriptCommands.ts:302-305, 339-342` — tree callers pass `target` when `sc.workspaceId` is non-empty. `src/remoteExecution.ts:99-163` already used Block-A pattern; now also overwrites `args.workspaceName = ws.name` (line 139) to fix header. Needs live human UAT (see below). |
| 2  | SC-2: Debug Local save-back publishes to remote                                                            | ✓ VERIFIED | `src/localScriptCache.ts:149-194` — `registerLocalScriptSaveBridge` listens on `onDidSaveTextDocument`, looks up identity from cache (keyed on fsPath), calls `remoteFs.writeFile` on the `altium365:` URI. `downloadScriptToTmp` (used by Debug Local too) registers the tmp path in cache at line 402-406. Save bridge is path-scheme-agnostic. UAT-confirmed in 06-03 SUMMARY (D-04). Live re-verify needed. |
| 3  | SC-3: Same parameter model (projectId prompt) across local run, local debug, remote execute               | ✓ VERIFIED | Local: `src/extension.ts:820-851` — calls `pickProjectId(...)` with workspace-scoped cache key `altium365.lastProjectId.<wsId>`. Remote: `src/remoteExecution.ts:175-200` — same `pickProjectId` import, same cache key prefix using `args.workspaceId`. Shared module: `src/projectPicker.ts` (103 lines). Both honor `altium365.promptForProjectId` config. |
| 4  | SC-4: Double-click (default single-click) script node opens for Edit                                       | ✓ VERIFIED | `src/sidePanel.ts:186-190` — `case 'script'` TreeItem assigns `item.command = { command: 'altium365.script.edit', title: 'Edit Script', arguments: [n] }`. VS Code honors `TreeItem.command` on leaf items under default `workbench.list.openMode: singleClick`. |
| 5  | SC-5: Tmp file named after GRID (meaningful tab title)                                                     | ✓ VERIFIED | `src/scriptCommands.ts:383-397` — `safeBase` is the script name sanitized to `[\w.-]`; directory = `os.tmpdir()/altium365/<workspaceAuthId>/<scriptId>`; `fs.mkdir(dir, { recursive: true })` precedes write. Path is GRID-derived (per inline comment referencing `grid:workspace:{authId}:scripts:script/{scriptId}`). Tab title becomes `<safeBase>.py`. Same-name scripts in different workspaces resolve to distinct paths (different authId or scriptId segment). |
| 6  | SC-6: Editor title bar shows single branded "Altium 365" dropdown; tree Publish removed                   | ✓ VERIFIED | `package.json:254-263` — `contributes.submenus['altium365.editorTitle']` with `media/altium365.png` icon, label "Altium 365". `package.json:299-304` — single `editor/title` entry attaches the submenu, gated `resourceLangId == python`. `package.json:306-326` — 4 items: `altium365.runScript`, `altium365.debugScript`, `altium365.script.executeRemote` (gated on `activeIsRemoteScript`), `altium365.script.publish` (same gate). `package.json:365-385` — `view/item/context` for `viewItem == scriptNode` contains runLocal/debugLocal/executeRemote/edit only — **no publish entry** (`grep` confirmed). Brand assets present at `media/altium365.png`, `resources/altium365.svg`, `resources/icon.png`. |
| 7  | SC-7: Dropdown appears for any standalone local `.py` file                                                 | ✓ VERIFIED | Submenu attachment in `editor/title` is gated only on `resourceLangId == python` (`package.json:303`), independent of `activeIsRemoteScript`. Run/Debug rows (1-2) likewise only need python; remote rows (3-4) hide when not a tracked remote-tmp file. `src/extension.ts:38-45, 185-188` — `updateActiveRemoteContext` seeded synchronously before listener registration; `src/extension.ts:170` rehydrates cache from disk on activate so restored tabs aren't false-negative. |
| 8  | SC-8 (stretch): AWS-Lambda-style test events                                                               | — DEFERRED | Per ROADMAP and phase brief, explicitly out of scope → Phase 999.3. Not counted in score. |

**Score:** 7/7 must-haves verified (SC-8 deferred per ROADMAP)

### Required Artifacts

| Artifact                  | Expected                                                                                | Status     | Details                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `src/projectPicker.ts`    | Shared `pickProjectId(context, endpoint, token, last, target?, output?)` (new, 06-03)   | ✓ VERIFIED | 103 lines; exports `pickProjectId`; imported by `extension.ts` and `remoteExecution.ts`.             |
| `src/extension.ts`        | `prepareRun`/`runScriptAtPath`/`debugScriptAtPath` accept `target?`; context-key helper | ✓ VERIFIED | Lines 38-45 (`updateActiveRemoteContext`), 170 (`rehydrateLocalScriptCacheFromDisk`), 579/634 (target plumbing), 723-790 (target branch), 820-851 (unified prompt). |
| `src/scriptCommands.ts`   | GRID tmp layout; tree handlers pass `target`                                            | ✓ VERIFIED | Lines 302-305, 339-342 (target), 383-397 (GRID layout + mkdir), 402-406 (registerLocalScript).        |
| `src/remoteExecution.ts`  | Block A workspaceName overwrite; Block B prompt fallback                                | ✓ VERIFIED | Lines 139-140 (workspaceName), 165-200 (Block B with shared cache key).                              |
| `src/sidePanel.ts`        | Single-click Edit on script leaf                                                        | ✓ VERIFIED | Lines 173-191 (`case 'script'` sets `item.command`).                                                  |
| `src/localScriptCache.ts` | `rehydrateLocalScriptCacheFromDisk` (06-02); save bridge intact                         | ✓ VERIFIED | Sync rehydration present; save bridge at lines 149-194 publishes via `remoteFs.writeFile`.            |
| `package.json` submenu    | `contributes.submenus['altium365.editorTitle']` + 4 items + tree Publish removed        | ✓ VERIFIED | Lines 254-263 (submenu), 299-326 (editor/title + items), 365-385 (view/item/context without publish). |
| Brand assets              | `media/altium365.png`, `resources/altium365.svg`, `resources/icon.png` (256×256)        | ✓ VERIFIED | All present on disk with expected sizes.                                                              |

### Key Link Verification

| From                                     | To                                                              | Via                              | Status     |
| ---------------------------------------- | --------------------------------------------------------------- | -------------------------------- | ---------- |
| `sidePanel.ts case 'script'`             | `altium365.script.edit` command                                 | `TreeItem.command`               | ✓ WIRED    |
| `scriptCommands.ts downloadScriptToTmp`  | `registerLocalScript(tmpPath, identity)`                        | direct call                      | ✓ WIRED    |
| `scriptCommands.ts run/debug LocalFrom*` | `extension.ts runScriptAtPath/debugScriptAtPath(ctx, path, target)` | imported + invoked with target | ✓ WIRED    |
| `extension.ts prepareRun (target branch)`| `ensureWorkspaceToken` + `getWorkspaceApiUrl`                   | direct call                      | ✓ WIRED    |
| `remoteExecution.ts Block B`             | `projectPicker.pickProjectId`                                   | imported + invoked              | ✓ WIRED    |
| `extension.ts run/debug local prompt`    | `projectPicker.pickProjectId`                                   | imported + invoked              | ✓ WIRED    |
| `package.json editor/title`              | `altium365.editorTitle` submenu                                 | `submenu` attribute              | ✓ WIRED    |
| `package.json altium365.editorTitle`     | 4 commands (runScript/debugScript/executeRemote/publish)        | menu items + context-key gates  | ✓ WIRED    |
| `localScriptCache.onDidSaveTextDocument` | `remoteFs.writeFile(altium365:...)`                             | save bridge                     | ✓ WIRED    |

### Data-Flow Trace (Level 4)

| Artifact                          | Data Variable          | Source                                   | Produces Real Data | Status     |
| --------------------------------- | ---------------------- | ---------------------------------------- | ------------------ | ---------- |
| `prepareRun` (target branch)      | `token` (workspace)    | `ensureWorkspaceToken` (live OAuth)      | Yes (auth.ts)      | ✓ FLOWING  |
| `prepareRun` (target branch)      | `endpoint`             | `getWorkspaceApiUrl(resolvedWs)`         | Yes (real URL)     | ✓ FLOWING  |
| `remoteExecution Block B`         | `parameters`           | `pickProjectId` → live `listProjects`    | Yes                | ✓ FLOWING  |
| Submenu visibility                | `altium365.activeIsRemoteScript` | `updateActiveRemoteContext(editor)` from cache lookup | Yes (rehydrated sync on activate) | ✓ FLOWING |
| Save bridge                       | `identity`             | `getLocalScript(fsPath)` from cache      | Yes                | ✓ FLOWING  |

### Behavioral Spot-Checks

| Behavior                              | Command                                              | Result        | Status |
| ------------------------------------- | ---------------------------------------------------- | ------------- | ------ |
| TypeScript compiles cleanly           | `npm run compile`                                    | exit 0, no output | ✓ PASS |
| Submenu declared in package.json      | `grep '"id": "altium365.editorTitle"' package.json`   | 1 match        | ✓ PASS |
| Tree Publish entry removed            | `grep -c 'altium365.script.publish' package.json` within `view/item/context` slice | 0 matches in that section | ✓ PASS |
| Shared `pickProjectId` module exists  | `ls src/projectPicker.ts`                            | 103 lines     | ✓ PASS |
| GRID tmp layout in scriptCommands     | `grep "os.tmpdir(),\s*'altium365'" src/scriptCommands.ts` | 1 match     | ✓ PASS |
| Single-click Edit wired               | `grep "altium365.script.edit" src/sidePanel.ts`      | 1 match       | ✓ PASS |
| Cross-workspace token path present    | `grep ensureWorkspaceToken src/extension.ts`         | 2 matches      | ✓ PASS |
| Brand assets on disk                  | `ls media/altium365.png resources/altium365.svg resources/icon.png` | all present (770, 2237, 20708 bytes) | ✓ PASS |

### Probe Execution

No probe scripts declared in this phase's PLAN files (`scripts/.../probe-*.sh` not used by this project). Step skipped — N/A.

### Requirements Coverage

This project tracks decision IDs (D-01..D-24) per phase rather than REQ-IDs against `.planning/REQUIREMENTS.md`. All 22 decisions claimed across the three SUMMARYs (D-01..D-24 minus D-15-only of 06-02, D-08, etc. — see per-plan `requirements-completed`) map directly to the success criteria above. No orphaned REQ-IDs found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None | — | Clean: `grep -E "TBD\|FIXME\|XXX\|HACK\|PLACEHOLDER\|TODO"` against all 6 phase-touched source files returned 0 matches. |

One known carry-over (NOT a regression, flagged in 06-03 SUMMARY as out-of-scope, captured as backlog item 999.4 per commit `47ce9cc`): `src/remoteExecution.ts:343-345` pagination cursor advances only on truthy `nextToken`, causing remote-execute log batches to print 3× during the poll loop. Pre-existing bug surfaced only because projectId prompt makes Execute Remotely a routine action now. Not a Phase 6 gap.

### Human Verification Required

7 items listed in YAML frontmatter above. The phase code is correctly wired and compiles, but the goal — "feels coherent" — is fundamentally a UX claim that requires a live A365 tenant + real workspaces + a debug session + multiple workspaces accessible to one account. Plan 06-02 had 3 UAT cycles for good reason; the goal-level coherence claim deserves a final pass.

### Gaps Summary

No gaps blocking the phase goal. All seven in-scope success criteria are observably wired in the codebase with correct data flow. SC-8 was explicitly deferred to Phase 999.3 per the phase brief. The phase goal — coherent execution UX with workspace-scoped routing, unified params, branded title bar — is **structurally achieved**; live human UAT is the appropriate final gate (per the project's `workflow.human_verify_mode = end-of-phase` posture) and is captured above.

---

_Verified: 2026-05-23_
_Verifier: the agent (gsd-verifier)_
