---
phase: 06-script-execution-ux-and-unified-params
plan: 01
subsystem: side-panel + script-commands + manifest
tags: [ux, side-panel, tmp-layout, grid, menu-cleanup]
requires: [03-remote-script-ops]
provides:
  - single-click-edit-on-script-tree
  - grid-derived-tmp-layout
  - readable-editor-tab-titles
  - no-publish-in-tree-context-menu
affects: [src/sidePanel.ts, src/scriptCommands.ts, package.json]
tech-stack:
  added: []
  patterns:
    - "TreeItem.command on leaf items (matches existing `case 'error'` shape)"
    - "GRID-derived nested tmp path: $TMPDIR/altium365/<authId>/<scriptId>/<name>.py"
    - "fs.mkdir(dir, { recursive: true }) before fs.writeFile"
key-files:
  created: []
  modified:
    - src/sidePanel.ts
    - src/scriptCommands.ts
    - package.json
key-decisions:
  - "D-09/D-10/D-12 implemented as planned — tmp layout `$TMPDIR/altium365/<authId>/<scriptId>/<safeName>.py` with on-demand mkdir; GRID format documented inline in `downloadScriptToTmp`."
  - "D-11 honored — no migration of legacy flat `altium365-<id>-<name>.py` files; localScriptCache keys on fsPath so legacy tabs keep working until closed."
  - "D-18 (drop tree Publish) implemented; `altium365.script.publish` removed from `view/item/context` only. Command remains in `contributes.commands[]` because editor/title (Plan 06-02 surface) and the Cmd+S save-bridge still depend on it."
  - "D-19 (single-click Edit) implemented using `TreeItem.command` on the `case 'script'` branch, matching the exact shape already used by `case 'error'` for retry."
  - "D-22 honored — no nested `withScriptProgress` around the new mkdir+write; existing wrapper covers the entire body (count stayed at 1)."
  - "Palette visibility for `altium365.script.publish`: confirmed during UAT that the pre-existing `menus.commandPalette` entry with `when: false` (package.json:280-283) already hides it from the palette. The plan's RESEARCH §5.3 assumption that the command was palette-eligible was outdated; user explicitly prefers the current hidden state. No code change made."
requirements-completed: [D-09, D-10, D-11, D-12, D-18, D-19, D-20, D-21, D-22, D-23]
duration: ~15 min
completed: 2026-05-22
---

# Phase 06 Plan 01: User-Facing Wins (Single-Click Edit, GRID Tmp Layout, Drop Tree Publish) Summary

Shipped three independently observable UX wins as preparation for Plan 06-02 (editor/title submenu refactor) and Plan 06-03 (execution routing): single-click on a script tree leaf now opens it for Edit (D-19/SC-4); downloaded remote scripts land at `$TMPDIR/altium365/<workspaceAuthId>/<scriptId>/<safeName>.py` with readable tab titles like `Bom_Report.py` (D-09..D-12/SC-5); the redundant "Publish Script" entry is gone from the script tree right-click menu while Cmd+S still publishes via the save bridge (D-18/SC-6 partial).

**Duration:** ~15 min (2026-05-22 22:08Z → 2026-05-22 22:13Z, including UAT round-trip)
**Tasks:** 3 (2 auto-coded + 1 human-verify checkpoint)
**Files modified:** 3 (`src/sidePanel.ts`, `src/scriptCommands.ts`, `package.json`)

## Task Results

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Wire single-click→Edit on script TreeItem; remove tree Publish menu entry | `70ecbc9` | `src/sidePanel.ts`, `package.json` |
| 2 | Rewrite `downloadScriptToTmp` to produce GRID-derived nested tmp layout | `6a0f74b` | `src/scriptCommands.ts` |
| 3 | Human UAT — single-click Edit + readable tab title + no Publish in tree menu | — (checkpoint) | n/a |

## Verification

- `npm run compile` exits 0 after each commit.
- `grep "altium365-\${" src/scriptCommands.ts` returns no matches inside `downloadScriptToTmp` (legacy flat template literal gone).
- `grep "path.join(...os.tmpdir(), 'altium365'..." src/scriptCommands.ts` confirms new nested layout.
- `grep "fs.mkdir(...recursive: true...)" src/scriptCommands.ts` confirms on-demand directory creation.
- `grep "grid:workspace" src/scriptCommands.ts` confirms inline D-09 documentation.
- `grep -c "withScriptProgress(" src/scriptCommands.ts` returns 1 (D-22 — no nested progress wrap).
- `git diff src/localScriptCache.ts` is empty (cache contract unchanged per D-11).
- `node -e "..."` package.json sanity check confirms `altium365.script.publish` removed from `view/item/context` but retained in `contributes.commands[]`.
- Human UAT (Task 3) signed off all six scenarios (SC-4 single-click, SC-5 tab title + on-disk layout, SC-5 cross-workspace collision, SC-6 partial menu cleanup, D-11 legacy interop, palette regression).

## Deviations from Plan

None — plan executed exactly as written.

UAT observation (not a deviation): step 6 ("Command Palette regression — confirm `Altium 365: Publish Script` is still listed") found the command is NOT listed in the palette. Investigation showed this is the pre-existing state — `package.json:280-283` already has a `menus.commandPalette` entry with `when: false` that hides the command from the palette. No code change made; the plan's RESEARCH §5.3 assumption was outdated, and the user explicitly prefers the current hidden state. Captured in `key-decisions` above.

**Total deviations:** 0 auto-fixed.
**Impact:** None. Plan ships exactly as specified; Plan 06-02 (editor/title submenu) and Plan 06-03 (execution routing) are unblocked.

## Issues Encountered

None.

## Next Phase Readiness

Plan 06-03 (execution correctness across local + remote routing) is now unblocked — it depends on `downloadScriptToTmp` having stable identity-bearing tmp paths (which Task 2 now provides via the nested layout).

Plan 06-02 (unified Altium 365 editor/title dropdown) becomes available after 06-03 completes (wave 3, depends on both 06-01 and 06-03).

Ready for Wave 2 — Plan 06-03.
