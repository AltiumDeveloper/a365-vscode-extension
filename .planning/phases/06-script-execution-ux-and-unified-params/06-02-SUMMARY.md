---
phase: 06-script-execution-ux-and-unified-params
plan: 02
subsystem: package.json menus + extension activation + scriptCommands + localScriptCache
tags: [editor-title, submenu, context-key, brand-icon, cache-rehydration, ux]
requires: [06-01, 06-03]
provides:
  - branded-editor-title-altium365-submenu
  - context-key-altium365-active-is-remote-script
  - sync-cache-rehydration-on-activate
  - brand-asset-pipeline-from-svg-source
affects:
  - package.json
  - src/extension.ts
  - src/scriptCommands.ts
  - src/localScriptCache.ts
  - resources/a365.svg (new source)
  - resources/altium365.svg (new monochrome variant)
  - resources/icon.png (regenerated 256×256 colorful)
  - media/altium365.png (new)
  - media/altium365@2x.png (new)
tech-stack:
  added:
    - "rsvg-convert (build-time only, for asset regeneration — not a runtime dep)"
  patterns:
    - "VS Code contributes.submenus declaration with editor/title attachment gated on resourceLangId == python (D-13/D-16)."
    - "setContext context key (altium365.activeIsRemoteScript) seeded synchronously BEFORE onDidChangeActiveTextEditor listener registration (RESEARCH §2.2 timing requirement)."
    - "Generic editor commands (altium365.runScript / altium365.debugScript taking Uri) wired to submenu Run/Debug rows; tree-only commands (altium365.script.*) wired to remote-specific rows — clean separation of contract."
    - "Sync cache rehydration on activate: directory walk of tmpdir()/altium365/<authId>/<scriptId>/*.py reconstructs the in-memory cache from the path-encoded identity. Sync I/O at activation is intentional — async lost the race against the seed call."
    - "Monochrome SVG using fill='currentColor' for Activity Bar theming; colorful PNGs for marketplace + submenu."
key-files:
  created:
    - resources/a365.svg
    - resources/altium365.svg
    - media/altium365.png
    - media/altium365@2x.png
  modified:
    - package.json
    - src/extension.ts
    - src/scriptCommands.ts
    - src/localScriptCache.ts
    - resources/icon.png (regenerated)
key-decisions:
  - "D-13/D-14/D-16 implemented as planned — three flat editor/title entries with resourceFilename =~ /^altium365-/ regex deleted; replaced with a single submenu attachment populated with 4 ordered items."
  - "D-15 implemented as planned — altium365.activeIsRemoteScript context key driven by onDidChangeActiveTextEditor, seeded before listener per RESEARCH §2.2."
  - "D-17 DESIGN CORRECTED post-UAT — the plan's standalone-.py fallback in runLocalFromScriptNode/debugLocalFromScriptNode never fired because VS Code passes the resource Uri (not undefined) when invoking from editor/title. Replaced with a cleaner wiring: submenu Run/Debug rows use the generic altium365.runScript/debugScript commands (which already take Uri and run any .py against active workspace), and the dead fallback was reverted."
  - "D-21/D-22/D-23 honored — no new config keys, no new withScriptProgress wraps, altium365.scriptParams.* untouched."
  - "Asset pipeline: brand assets generated from canonical resources/a365.svg via rsvg-convert. Three render targets — 16px colored PNG (submenu), 256px colored PNG (marketplace), 24px monochrome SVG using currentColor (Activity Bar theming)."
  - "Activity Bar icon swapped from $(circuit-board) codicon to resources/altium365.svg — bonus brand consistency win, scope-adjacent to the plan."
  - "Cache rehydration on activate (NOT in original plan): tmp-file tabs restored by VS Code from previous session lacked cache entries (in-memory only), so the context key stayed false on first frame. Implemented as sync directory walk of the GRID layout from Plan 06-01."
requirements-completed: [D-13, D-14, D-15, D-16, D-17, D-21, D-22, D-23]
duration: ~45 min (incl. 3 UAT cycles + 1 design correction + asset generation)
completed: 2026-05-22
---

# Phase 06 Plan 02: Branded Editor/Title Submenu + Cache Rehydration Summary

Replaced the three flat Altium 365 buttons in the editor title bar (Publish / Execute Remote / Debug, all gated on the legacy `resourceFilename =~ /^altium365-/` regex that no longer matches Plan 06-01's GRID layout) with a single branded Altium 365 dropdown that adapts its contents to whether the active `.py` is a tracked remote-tmp script or a standalone file. Closed SC-6 (branded submenu, redundant flat buttons gone) and SC-7 (submenu also serves standalone `.py` with context-appropriate items). Surfaced and fixed two follow-on bugs during UAT — submenu wiring contract mismatch and tmpdir cache rehydration on cold start.

## What Shipped

**Task 1 — `package.json` submenu wiring.** Added top-level `contributes.submenus['altium365.editorTitle']` with `media/altium365.png` icon. Replaced the three flat `editor/title` entries with a single submenu attachment gated on `resourceLangId == python` (D-13/D-16). Populated `contributes.menus['altium365.editorTitle']` with four ordered rows: Run Python Script + Debug Python Script (always visible on `.py`) and Execute Script Remotely + Publish Script (gated additionally on `altium365.activeIsRemoteScript`). Also removed pre-existing `commandPalette: when:false` entries for `executeRemote` and `publish` (Phase 4 D-02 regression — UAT-10 verifies palette eligibility).

**Task 2 — `extension.ts` context key + cache rehydration.** Added `updateActiveRemoteContext(editor)` helper mirroring the existing `updateSignedInContext` pattern; sets `altium365.activeIsRemoteScript` based on `editor.document.uri.scheme === 'file' && getLocalScript(fsPath)`. Inside `activate()`: rehydrate cache from disk synchronously → seed context key → register `onDidChangeActiveTextEditor` listener — strict ordering per RESEARCH §2.2 plus the UAT-3 race fix. Cache rehydration walks `tmpdir()/altium365/<authId>/<scriptId>/*.py` and reconstructs identity from the path-encoded GRID layout (Plan 06-01).

**Task 2 (original D-17 fallback) — REVERTED post-UAT.** The plan called for a `if (!node)` fallback in `runLocalFromScriptNode`/`debugLocalFromScriptNode` to handle standalone `.py` invocation from the submenu. UAT-1 proved this never fired: VS Code passes the resource `Uri` (truthy, non-`A365Node`) as the first arg from `editor/title` menus, so the guard was bypassed and `resolveScriptContext` returned undefined → "no script selected" error. Replaced with the cleaner contract below.

**Submenu wiring fix (UAT-1).** Rows 1-2 of the dropdown now point to `altium365.runScript` / `altium365.debugScript` (the existing generic Python commands that take `uri?: Uri` and execute against active workspace). Rows 3-4 stay on `altium365.script.executeRemote` / `altium365.script.publish` (tree-style commands — `resolveScriptContext` falls through to the active-editor cache-lookup branch which handles remote-tmp correctly). Tree-only `altium365.script.runLocal` / `debugLocal` re-hidden from palette via `when: false` (they assume an `A365Node` arg).

**Cache rehydration (UAT-2 + UAT-3).** Initial async implementation lost the race against the seed call — user saw the `Rehydrated N` log appear only after triggering an action. Converted `rehydrateLocalScriptCacheFromDisk()` to synchronous `fs.readdirSync` (walk is bounded — handful of dirs, dozens of files — sync I/O at activation is acceptable). Cache now populated before the seed fires, so restored remote-tmp tabs show all 4 dropdown items on first frame.

**Brand asset pipeline (out-of-plan, user-requested).** Generated three icon assets from a canonical SVG source (`resources/a365.svg`, user-provided):
- `media/altium365.png` (16px colorful) + `@2x` — submenu icon
- `resources/icon.png` (256px colorful, regenerated from prior 128px monochrome placeholder) — marketplace icon
- `resources/altium365.svg` (24px monochrome, `fill="currentColor"`) — Activity Bar icon (replaces `$(circuit-board)` codicon)

VSIX repackaged so the marketplace icon update propagates to installed extensions.

## UAT Observations (user-reported, 2026-05-22)

**APPROVED with notes** — all 12 scenarios pass after 3 fix cycles:

- **UAT-1 (scenario #4 failed):** "Run Script (Local)" on standalone `.py` errored with "no script selected". **Fix:** swap submenu rows 1-2 to `altium365.runScript`/`debugScript`. Commit `b12de4d`.
- **UAT-2 (scenario #6 partial):** Restored remote-tmp tabs not recognized on cold start. **Fix:** add `rehydrateLocalScriptCacheFromDisk()` walking the GRID layout. Commit `289671d`.
- **UAT-3 (UAT-2 follow-up):** Rehydration log appeared only after first action — async race with the seed call. **Fix:** convert to synchronous fs. Commit `b1ae373`.
- **Marketplace icon:** user reported still wrong; root cause was installed VSIX from May 19 containing the 958-byte monochrome placeholder. **Resolved:** rebuilt VSIX bundles the colorful 256×256 PNG.

## Files

| Path | Change |
|------|--------|
| `package.json` | Declared `contributes.submenus['altium365.editorTitle']` with `media/altium365.png` icon. Replaced 3 flat `editor/title` entries with 1 submenu attachment. Populated `altium365.editorTitle` menu key with 4 rows (rows 1-2 use generic `runScript`/`debugScript`, rows 3-4 use tree-style commands). Removed `commandPalette: when:false` for `executeRemote` + `publish`; kept it for `runLocal` + `debugLocal` (tree-only). Swapped Activity Bar `viewsContainers` icon from `$(circuit-board)` to `resources/altium365.svg`. |
| `src/extension.ts` | Added `getLocalScript` + `rehydrateLocalScriptCacheFromDisk` imports. New `updateActiveRemoteContext(editor)` helper. `activate()` now: rehydrates cache sync → seeds context key → registers editor-change listener. |
| `src/scriptCommands.ts` | No net change (added D-17 fallback in commit `817c691`, reverted in `b12de4d`). |
| `src/localScriptCache.ts` | Added sync `rehydrateLocalScriptCacheFromDisk()` that walks `tmpdir()/altium365/<authId>/<scriptId>/*.py` and calls `registerLocalScript()` per file. Best-effort: silently swallows ENOENT and per-entry errors. |
| `resources/a365.svg` (new) | Canonical brand SVG (user-provided). |
| `resources/altium365.svg` (new) | Monochrome variant using `fill="currentColor"` — Activity Bar icon. |
| `resources/icon.png` | Regenerated 256×256 colorful via `rsvg-convert` (was 958-byte programmatic monochrome). |
| `media/altium365.png` (new) | 16px colorful submenu icon. |
| `media/altium365@2x.png` (new) | 32px @2x retina variant. |
| `altium365-scripting-0.1.0.vsix` | Repackaged twice (post UAT-2, post UAT-3) — 110.76 KB. |

## Commits

- `1c65464` — `chore(assets): generate A365 brand icons from SVG source` (pre-task asset prep)
- `7927b81` — `feat(06-02): branded Altium 365 editor/title submenu replaces flat trio (D-13, D-14, D-16)` (Task 1)
- `817c691` — `feat(06-02): activeIsRemoteScript context key + node-less submenu invocation fallback (D-15, D-17)` (Task 2 — D-17 fallback subsequently reverted)
- `b12de4d` — `fix(06-02): wire submenu Run/Debug rows to generic Python commands (UAT-1)` (design correction)
- `289671d` — `fix(06-02): rehydrate localScriptCache from tmpdir on activate (UAT-2)` (async — superseded)
- `b1ae373` — `fix(06-02): make cache rehydration synchronous to win race vs seed (UAT-3)` (final)

## Deviation Notes

- **D-17 design flaw caught at UAT:** the plan assumed `editor/title` menu invocations pass `undefined` as the first arg, allowing a `if (!node)` fallback. VS Code actually passes the resource `Uri`. The plan's command choice (`altium365.script.runLocal/debugLocal`) was incompatible with the menu's invocation contract. Corrected by using the generic `altium365.runScript/debugScript` commands instead — semantically cleaner (the title bar is editor-centric, the tree is script-centric). Worth back-feeding into PATTERNS for future submenu plans.
- **Cache rehydration NOT in original plan:** the in-memory cache was a latent bug that became user-visible only when the submenu started consuming it for D-15. Implemented as part of plan close-out rather than as a separate plan because the fix is small (~70 lines), tightly scoped, and required to make D-15 work end-to-end.
- **Pre-existing palette regression fix:** `executeRemote` + `publish` were hidden from the Command Palette via `commandPalette: when:false` — violating Phase 4 D-02 (palette eligibility). UAT-10 was explicitly checking for this; removed the four `when: false` entries (later re-added two of them for `runLocal`/`debugLocal` which legitimately ARE tree-only per UAT-1's redesign).
- **Brand asset pipeline out-of-plan:** user requested icon generation from SVG source mid-Task-1 because `media/altium365.png` didn't exist (Task 1's `read_first` MANDATORY gate). Committed as `chore(assets): ...` separately from plan task commits to keep attribution clean.
