---
phase: 04-ui-polish
plan: 01
subsystem: ui
tags: [vscode-extension, package.json, command-palette, contributes]

requires:
  - phase: 02-side-panel
    provides: contributes.commands[] catalog with all 16 command IDs
  - phase: 02.1-side-panel-polish
    provides: tree/workspace/project open-in-browser command registrations
  - phase: 03-remote-scripts
    provides: scriptCommands.ts registrations for runLocal/edit/executeRemote/publish
provides:
  - "package.json contributes.commands[] trimmed to 6 user-actionable entries"
  - "Removed redundant 'Altium 365:' prefix from every command title — VS Code now renders palette as 'Altium 365: <X>' (category-prepended) and context menus as plain '<X>'"
  - "Backwards-compat guarantee: every removed command ID still resolves via vscode.commands.registerCommand in TS sources"
affects: [phase-04 ui-polish, marketplace-readme]

tech-stack:
  added: []
  patterns:
    - "Menus may reference command IDs that are NOT in contributes.commands[] — registration via registerCommand is the actual privilege grant; contributes.commands[] only governs Command Palette visibility"

key-files:
  created: []
  modified:
    - package.json

key-decisions:
  - "Chose D-04 option (a): delete entries from contributes.commands[] rather than guard them with menus.commandPalette.when=false — simpler manifest, identical UX outcome"
  - "Preserved $(globe) icon on altium365.selectEnvironment because the view/title menu references it"
  - "Reordered surviving entries to whitelist order (auth → workspace → environment → run/debug) for manifest readability"

patterns-established:
  - "Command Palette catalog hygiene: only commands invokable without tree-node context belong in contributes.commands[]"

requirements-completed: [D-01, D-02, D-03, D-04, D-16]

duration: 6 min
completed: 2026-05-21
---

# Phase 04 Plan 01: package.json command catalog cleanup Summary

**Command Palette filter `Altium 365:` now lists exactly 6 user-actionable entries, and the redundant `Altium 365:` prefix is gone from every context-menu label.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-21T00:30:00Z (approx)
- **Completed:** 2026-05-21T00:36:00Z (approx)
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Stripped `Altium 365: ` from all 16 `contributes.commands[].title` strings; `category: "Altium 365"` retained so VS Code prepends it automatically in the palette
- Trimmed `contributes.commands[]` from 16 entries to the 6-command whitelist (`signIn`, `signOut`, `selectWorkspace`, `selectEnvironment`, `runScript`, `debugScript`)
- Verified the 10 removed command IDs (`tree.refresh`, `tree.retryNode`, `tree.copyId`, `statusBar.click`, `script.runLocal`, `script.edit`, `script.executeRemote`, `script.publish`, `workspace.openInBrowser`, `project.openInBrowser`) all remain wired through `vscode.commands.registerCommand` in `extension.ts`, `treeCommands.ts`, or `scriptCommands.ts`
- `npm run compile` clean

## Task Commits

1. **Task 1: Strip `Altium 365:` prefix from every command title** — `87a7de3` (fix)
2. **Task 2: Reduce `contributes.commands[]` to 6-entry palette whitelist** — `c07aa94` (fix)

## Files Created/Modified

- `package.json` — Title prefix removed from 16 entries; `contributes.commands[]` trimmed from 16 → 6 entries; `contributes.menus` untouched

## Decisions Made

- **Whitelist order:** Reordered the 6 surviving entries to auth-first (signIn/signOut), then workspace/environment, then run/debug — better matches typical first-run UX progression
- **Preserve `$(globe)` icon** on `selectEnvironment` even though `view/title` also declares an inline icon — keeps the palette entry visually consistent if VS Code ever surfaces icons there

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Plan-spec mismatch] Plan said 17 entries; actual file had 16**
- **Found during:** Task 1 (initial read)
- **Issue:** Plan Task 1 enumerated 16 IDs but described them as "all 17 current entries"
- **Fix:** Applied the prefix strip to whatever entries existed (the 16 actual entries) — same outcome
- **Files modified:** none additional
- **Verification:** Post-strip `node -e` check confirmed zero entries still match `/^Altium 365:/`
- **Committed in:** `87a7de3`

**2. [Rule 3 — Verifier false-negative] Plan Task 2 verifier missed multi-line `registerCommand` calls**
- **Found during:** Task 2 read_first verification
- **Issue:** Plan's automated check uses `registerCommand('<id>'` on a single line; `treeCommands.ts` and `scriptCommands.ts` format the call across multiple lines (`registerCommand(\n  'altium365.xxx',\n  ...)`), so the check reported 7 IDs missing
- **Fix:** Ran a stricter `grep -E "altium365\.(script|tree|workspace|project)\."` over the same files and visually confirmed every removed ID appears as the first arg to a `registerCommand(...)` block. No source files modified.
- **Files modified:** none
- **Verification:** All 7 IDs confirmed present in `treeCommands.ts`/`scriptCommands.ts`; `npm run compile` passes
- **Committed in:** (n/a — verification adjustment only)

---

**Total deviations:** 2 auto-fixed (1 plan-spec mismatch, 1 verifier false-negative). Both are documentation/verification noise — no implementation deviation. **Impact:** zero.

## Issues Encountered

None.

## User Setup Required

None — pure manifest cleanup.

## Self-Check: PASSED

- `package.json` exists and is valid JSON
- `node -e` whitelist check: exits 0 (6 entries, exact IDs)
- `node -e` prefix check: exits 0 (no title starts with `Altium 365:`)
- `npm run compile`: exits 0
- Commits `87a7de3` and `c07aa94` present in `git log`
- All 10 removed command IDs still appear in `src/extension.ts`, `src/treeCommands.ts`, or `src/scriptCommands.ts` `registerCommand` calls

## Next Phase Readiness

- Phase 4 Plan 02 (next plan, if any) can proceed against the cleaned manifest
- Marketplace README and CHANGELOG updates downstream now show the curated 6-command surface
- Manual UAT (Extension Development Host F5 → Command Palette filter `Altium 365:` → confirm 6 entries; right-click script tree node → confirm no `Altium 365:` prefix in context menu) deferred to user, since headless VS Code launch isn't part of CI

---
*Phase: 04-ui-polish*
*Completed: 2026-05-21*
