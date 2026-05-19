---
phase: 02-side-panel
plan: 05
subsystem: ui
tags: [vscode-extension, status-bar, quickpick, event-emitter]

requires:
  - phase: 02-side-panel/02-02
    provides: onAuthStateChanged, getActiveUserLabel, getStoredTokens, AuthState
  - phase: 02-side-panel/02-03
    provides: altium365.statusBar.click command declaration in package.json
  - phase: 02-side-panel/02-04
    provides: extension.ts activate() single-push subscription block + fireAuthStateChanged on env switch
provides:
  - src/statusBar.ts (createStatusBar factory + StatusBarHandle interface)
  - altium365.statusBar.click command handler with 3-option QuickPick delegating to existing commands
  - Reactive status bar item that auto-renders on every onAuthStateChanged event
affects: [02-06 script commands (status bar already reflects current workspace/env after env switch)]

tech-stack:
  added: []
  patterns:
    - "Factory-returns-handle pattern for disposable bundles: createStatusBar returns { item, subscription } so the caller centralizes ctx.subscriptions.push"
    - "Whitelisted-delegation QuickPick: 3 hard-coded { label, command } items; no user input ever becomes a command id (T-02-05-02 mitigation)"
    - "Stale-label prevention via Plan 04's fireAuthStateChanged on env switch — verified during Task 2 (one call present, no duplicate)"

key-files:
  created:
    - src/statusBar.ts
  modified:
    - src/extension.ts

key-decisions:
  - "Status bar item created at alignment Right priority 100 — far-right cluster next to other identity/account items, matching Git/GitHub extension UX"
  - "render() uses stateHint?.signedIn/user/environment when present, falling back to getStoredTokens + getActiveUserLabel + settings — avoids redundant async reads when the emitter already has the answer"
  - "onStatusBarClick lives at module scope (not inside activate) so registerCommand keeps its lambda small and the QuickPick handler is testable in isolation"
  - "No defensive duplicate of fireAuthStateChanged added — Plan 04 already wired it inside doSelectEnvironment; grep confirmed exactly one call"

patterns-established:
  - "Status-bar disposal: BOTH StatusBarItem and the EventEmitter subscription must be pushed into ctx.subscriptions; the factory returns them as a tuple to make this explicit"
  - "Codicon-in-label convention for QuickPick items extended to 3 new icons: sign-out, globe, repo"

requirements-completed: [PANEL-06]

duration: 3 min
completed: 2026-05-19
---

# Phase 02 Plan 05: Status Bar Summary

**Right-aligned status bar item rendering `$(account) A365: <user> • <env>` per D-04, reactive to every onAuthStateChanged event, with a click handler that opens a 3-option QuickPick delegating to existing Sign Out / Switch Environment / Switch Workspace commands.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-19T17:01:00Z (approx)
- **Completed:** 2026-05-19T17:04:00Z (approx)
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- New `src/statusBar.ts` (72 lines) exporting `createStatusBar(context, output): StatusBarHandle` and the `StatusBarHandle` interface
- Status bar item text format exactly matches D-04: `$(account) A365: <user> • <env>` with U+2022 bullet
- Subscribes to `onAuthStateChanged` and re-renders on sign-in, sign-out, and env switch — `AuthState.environment` from Plan 04's env-switch broadcast is honored
- Empty/unset env renders as `default`; missing user falls back to `(signed in)` via `getActiveUserLabel`
- `altium365.statusBar.click` registered in `activate()` (per PATTERNS.md — registration belongs to activation site); both `statusBar.item` and `statusBar.subscription` pushed into the existing single `ctx.subscriptions.push(...)` call
- QuickPick contains exactly 3 whitelisted items (`altium365.signOut`, `altium365.selectEnvironment`, `altium365.selectWorkspace`); cancellation is a no-op; delegated errors surface via `vscode.window.showErrorMessage('Altium 365: ' + msg)` and the output channel
- No new module-level mutable state; no new dependencies; `npm run compile` exits 0 after each task

## Task Commits

1. **Task 1: Create src/statusBar.ts with createStatusBar factory + auth-state subscription** — `6ffbf2d` (feat)
2. **Task 2: Wire createStatusBar + altium365.statusBar.click into extension.ts activate()** — `18aee60` (feat)

**Plan metadata:** _to follow_ (this SUMMARY docs commit)

## Files Created/Modified

- `src/statusBar.ts` — **new**: `StatusBarHandle` interface, `createStatusBar(context, output)` factory; private `render(stateHint?)` helper that derives `signedIn`/`user`/`env` (preferring hint over async lookups), formats text per D-04, calls `item.show()`/`item.hide()`; wrapped in try/catch that logs to outputChannel and hides on failure
- `src/extension.ts` — added `import { createStatusBar } from './statusBar';`; `const statusBar = createStatusBar(context, outputChannel);` after TreeView creation; appended `statusBar.item`, `statusBar.subscription`, and `vscode.commands.registerCommand('altium365.statusBar.click', () => onStatusBarClick())` to the existing single subscriptions.push call; added module-scope `async function onStatusBarClick()` with the 3-item QuickPick + try/catch delegation

## Decisions Made

- **Hint-first render:** when the emitter event carries `signedIn`/`user`/`environment`, those values are used directly instead of re-reading SecretStorage and settings. Reduces async work on the hot path and avoids any race where the emitter has fresher data than disk.
- **No defensive `fireAuthStateChanged` duplicate:** Plan 04 Task 2 step 6 already added the env-switch broadcast (line 203 of extension.ts). `grep -c "fireAuthStateChanged" src/extension.ts` reports 2 (one import + one call inside `doSelectEnvironment`) — exactly the count required by the plan's step 5 verification. No new call added.
- **`onStatusBarClick` at module scope:** keeps `activate()` small and matches the existing pattern of module-level `doSignIn`/`doSignOut`/`doSelectEnvironment` handlers.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Verification

- `npm run compile` → exit 0 (TypeScript strict) after each task commit
- `grep -nE "^export function createStatusBar" src/statusBar.ts` → 1 match (line 23)
- `grep -n "createStatusBarItem(vscode.StatusBarAlignment.Right" src/statusBar.ts` → 1 match (line 27)
- `grep -n 'A365: ${user} • ${env}' src/statusBar.ts` → 1 match (line 57) — U+2022 bullet present
- `grep -n "onAuthStateChanged" src/statusBar.ts` → 2 matches (import + subscribe call)
- `grep -n "createStatusBar(context" src/extension.ts` → 1 match (line 43)
- `grep -n "altium365.statusBar.click" src/extension.ts` → 1 match (line 74)
- `grep -nE "^(async )?function onStatusBarClick" src/extension.ts` → 1 match (line 82)
- `grep -c "altium365.signOut" src/extension.ts` → 2 (registerCommand + QuickPick item)
- `grep -c "altium365.selectEnvironment" src/extension.ts` → 2 (registerCommand + QuickPick item)
- `grep -c "altium365.selectWorkspace" src/extension.ts` → 2 (registerCommand + QuickPick item)
- `grep -c "fireAuthStateChanged" src/extension.ts` → 2 (import + one call inside doSelectEnvironment — no duplicate added)

## Self-Check: PASSED

- `src/statusBar.ts` exists with `createStatusBar` exported and the StatusBarHandle interface
- `src/extension.ts` instantiates the factory, registers `altium365.statusBar.click`, and pushes item + subscription into ctx.subscriptions
- Both task commits present in `git log`: `6ffbf2d` (statusBar) and `18aee60` (extension wiring)
- All acceptance criteria for Tasks 1 and 2 verified by greps above
- `npm run compile` exits 0 with strict mode
- No new module-level mutable state added beyond pre-existing `outputChannel` singleton

## Next Phase Readiness

- Wave 2 complete (Plans 04 + 05): tree view + status bar both fully reactive to onAuthStateChanged
- Wave 3 Plan 02-06 (script commands) can now assume the status bar reflects the active workspace/env at all times — no extra UI plumbing needed for script execution feedback
- Status bar's QuickPick gives users a discoverable entry point to all three account-management commands without needing the Command Palette

---
*Phase: 02-side-panel*
*Completed: 2026-05-19*
