---
phase: 02-side-panel
plan: 06
subsystem: ui
tags: [vscode-commands, side-panel, placeholders, refactor]

requires:
  - phase: 02-side-panel
    provides: ScriptNode shape (kind/workspaceId/workspaceAuthId/workspaceUrl/script), package.json contributes.commands for altium365.script.*, view/item/context menu wiring
provides:
  - registerScriptCommands(ctx, output) factory wiring all four altium365.script.* commands
  - Exported runScriptAtPath(ctx, scriptPath) helper reusable from any caller (Phase 3 will consume for run-local)
  - Phase 3 placeholder UX contract: all four script commands surface "coming in Phase 3" info messages
affects: [phase-03-remote-script-operations]

tech-stack:
  added: []
  patterns:
    - "registerScriptCommands(ctx, output) -> Disposable[] factory wired via spread into the single ctx.subscriptions.push() in activate()"
    - "Behavior-preserving extraction: prepareRun(ctx, vscode.Uri | string) — string path bypasses active-editor resolution, vscode.Uri | undefined callers byte-identical"

key-files:
  created:
    - src/scriptCommands.ts
  modified:
    - src/extension.ts

key-decisions:
  - "D-09 / SCRIPT-01 deferred to Phase 3 — Task 1 human-verify of A365 file-download endpoint (Assumption A1) + package format (A2) returned BLOCKED; no live workspace available for verification"
  - "altium365.script.runLocal registered as a Phase 3 placeholder for now (per Task 3 BLOCKED-branch acceptance) so the right-click menu surfaces consistent UX with the other three Phase 3 commands"
  - "runScriptAtPath refactor (Task 2) shipped anyway — it stands on its own as a no-op behaviour change for the existing altium365.runScript command and is ready for Phase 3 to consume"

patterns-established:
  - "Command-factory module: registerScriptCommands(ctx, output) -> Disposable[] — caller (activate) spreads the result into ctx.subscriptions.push(...) alongside other disposables"
  - "Phase-deferral placeholder pattern: vscode.window.showInformationMessage('Altium 365: <Label> — coming in Phase <N>.') for commands declared in package.json but not yet implemented"

requirements-completed: [PANEL-05]

duration: 4 min
completed: 2026-05-19
---

# Phase 02 Plan 06: Script Commands Summary

**Registered all four `altium365.script.*` placeholder commands and extracted `runScriptAtPath(ctx, scriptPath)` from `runScript`; D-09 / SCRIPT-01 (run-local from tree) deferred to Phase 3 after Task 1 blocking human-verify returned BLOCKED.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T17:03:42Z (continuation from checkpoint)
- **Completed:** 2026-05-19
- **Tasks:** 2 of 3 executed (Task 1 was a blocking human-verify checkpoint; Task 3 executed via BLOCKED-branch acceptance)
- **Files modified:** 2 (1 created + 1 modified)

## Task 1 Resume Signal

**Posted by user:** `BLOCKED`

**Reason:** "cannot verify A365 file-download endpoint against a live workspace" — no live A365 workspace was available to confirm RESEARCH.md Assumption A1 (URL template + auth header for the GraphQL-issued `fileToken` indirection) or Assumption A2 (single `.py` text file vs zip archive containing the script package).

**Resulting strategy for Task 3:** Per the BLOCKED branch of Task 3's `<acceptance_criteria>`, all four `altium365.script.*` command IDs are still registered (so the right-click menu wired by Plan 02-03 never errors with "command not found" — Pitfall 7 / threat T-02-06-09), but `altium365.script.runLocal` points at the same `'coming in Phase 3'` placeholder handler used by `edit`, `executeRemote`, and `publish`. The `fetchScriptBody` helper and the `runLocalFromScriptNode` handler are intentionally NOT shipped, because the entire point of BLOCKED is that the file-download endpoint and package format are unverified.

## Accomplishments

- Extracted `runScriptAtPath(ctx, scriptPath)` from `runScript(ctx, uri?)` — behaviour-preserving refactor; existing editor-toolbar run/debug commands continue to work unchanged. `prepareRun` now accepts `vscode.Uri | string | undefined`; string is treated as an absolute path.
- Created `src/scriptCommands.ts` exporting `registerScriptCommands(ctx, output) -> vscode.Disposable[]` — registers all four `altium365.script.*` command IDs declared in `package.json`.
- Wired `registerScriptCommands` into `activate()` via the existing single `ctx.subscriptions.push(...)` (spread `...scriptCommandDisposables`, no second push).
- D-03 fully satisfied: the three Phase 3 commands (`edit`, `executeRemote`, `publish`) are registered and surface consistent `'Altium 365: <Label> — coming in Phase 3.'` info messages.
- PANEL-05 satisfied: right-clicking a script node now fires the registered command for every menu entry; no `'command not found'` UX regression.

## Task Commits

1. **Task 2: Extract runScriptAtPath** — `80c1b8d` (refactor)
2. **Task 3: scriptCommands.ts + wire into extension.ts (BLOCKED placeholder branch)** — `82d61e6` (feat)

**Plan metadata commit:** added below in the final commit.

## Files Created/Modified

- `src/scriptCommands.ts` (created) — `registerScriptCommands(ctx, output)` factory returning four `vscode.Disposable` registrations: `altium365.script.runLocal` (placeholder, BLOCKED branch), `altium365.script.edit`, `altium365.script.executeRemote`, `altium365.script.publish`. Module-level doc comment records the BLOCKED rationale and Phase 3 follow-up.
- `src/extension.ts` (modified) — three changes:
  1. New named import: `import { registerScriptCommands } from './scriptCommands';`
  2. `prepareRun(ctx, uriOrPath?: vscode.Uri | string)` accepts either a URI or an absolute path string; downstream resolution unchanged.
  3. New exported `runScriptAtPath(ctx, scriptPath)` extracted from `runScript`; `runScript` now resolves uri/editor target then delegates via `target.fsPath`.
  4. `activate()` constructs `scriptCommandDisposables = registerScriptCommands(context, outputChannel)` and spreads them into the single existing `ctx.subscriptions.push(...)` call.

## Decisions Made

- **D-09 + SCRIPT-01 deferred to Phase 3.** Live A365 workspace unavailable to verify endpoint pattern + package format. Phase 3 (Remote Script Operations) is the natural place to re-run this verification — the same plan needs the endpoint anyway for `gloScrUpdateScript` / `gloScrExecuteScript`.
- **Ship the `runScriptAtPath` refactor anyway.** It has no consumer in Phase 2 under the BLOCKED branch (the placeholder doesn't use it), but it is a behaviour-preserving no-op for the existing `altium365.runScript` command and Phase 3 can consume it without further refactor.
- **All four `script.*` commands registered (including runLocal) even though run-local isn't implemented.** Avoids the "command not found" UX regression that would occur if only three of the four declared command IDs were registered (Pitfall 7 / T-02-06-09).
- **Did NOT ship `fetchScriptBody` or `runLocalFromScriptNode`.** The whole point of the BLOCKED resume signal is that the endpoint pattern is unverified — shipping a `fetchScriptBody` against an unverified URL template would risk silently swallowing 404s or sending an incorrect auth header. Phase 3 will define these with the endpoint pattern confirmed against a live workspace.

## Deviations from Plan

None from the BLOCKED-branch path — the resume_state from the orchestrator explicitly authorized the BLOCKED-branch adaptation, and Task 3's `<acceptance_criteria>` includes the BLOCKED branch as a first-class outcome.

## Issues Encountered

None.

## Deferred Items (Phase 3)

| Item | Reason | Re-verify in Phase 3 |
|------|--------|----------------------|
| SCRIPT-01 (run an A365 script body locally) | Task 1 BLOCKED — file-download endpoint pattern unverified | Repeat Task 1 verification protocol against a live workspace |
| D-09 (fetch → tmpdir + 0o600 → runScriptAtPath → finally unlink) | Same as above — the implementation depends on the endpoint pattern | Implement `fetchScriptBody` + `runLocalFromScriptNode` in `src/scriptCommands.ts`; swap the runLocal placeholder for the real handler |
| RESEARCH.md Assumption A1 (file-download URL template + auth header) | Unverified | Curl the candidate endpoints against a live workspace |
| RESEARCH.md Assumption A2 (single .py vs zip archive) | Unverified | `file -b` the downloaded body; if archive, add unzip + entry-point selection rule |

## Self-Check

- [x] `src/scriptCommands.ts` exists (`[ -f ]` confirmed)
- [x] `src/extension.ts` modified (registerScriptCommands wired, runScriptAtPath exported)
- [x] `npm run compile` exits 0 (strict mode)
- [x] All four `altium365.script.*` IDs appear in `vscode.commands.registerCommand` calls inside `registerScriptCommands` (grep confirmed)
- [x] `registerScriptCommands(context, outputChannel)` called once in `activate()`; disposables spread into the single existing `ctx.subscriptions.push(...)` (grep confirmed, no second push statement)
- [x] Task commits exist on `main`: `80c1b8d` (refactor) and `82d61e6` (feat)
- [x] `runScript` / `debugScript` editor-toolbar commands behaviourally unchanged (delegation preserves the same `prepareRun` → spawn pipeline)

## Self-Check: PASSED

## Next Phase Readiness

- Phase 2 (Side Panel) ships with the right-click context menu fully wired: no "command not found" errors on any menu item.
- `runScriptAtPath(ctx, scriptPath)` is exported and ready for Phase 3 to consume from `runLocalFromScriptNode`.
- Phase 3's first task should re-run Plan 02-06 Task 1's human-verify protocol against a live A365 workspace, then implement `fetchScriptBody` + `runLocalFromScriptNode` and swap the runLocal placeholder for the real handler.

---
*Phase: 02-side-panel*
*Completed: 2026-05-19*
