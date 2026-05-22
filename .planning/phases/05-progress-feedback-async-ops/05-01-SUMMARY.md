---
phase: 05-progress-feedback-async-ops
plan: 01
subsystem: ui-progress
tags: [vscode-extension, progress, withProgress, abortcontroller]
requires: []
provides: [withScriptProgress]
affects: [editScript, runLocalFromScriptNode, debugLocalFromScriptNode]
tech-stack:
  added: []
  patterns: [withProgress-helper, cooperative-abort]
key-files:
  created: [src/progress.ts]
  modified: [src/scriptCommands.ts]
key-decisions: [D-05, D-06, D-08, D-09, D-10, D-04]
requirements-completed: [SC-1, SC-3, SC-4]
duration: 25 min
completed: 2026-05-22
---

# Phase 5 Plan 1: Helper and Download Summary

Shipped `withScriptProgress<T>` (the project-wide branded-notification helper) and wired it into `downloadScriptToTmp`, the 3-for-1 chokepoint behind Edit Script / Run Script (Local) / Debug Script (Local).

## What Shipped

- **`src/progress.ts`** (new, 59 LoC) — `withScriptProgress<T>(label, op, opts?)`. Wraps `vscode.window.withProgress` with the `Altium 365: ${label}` title convention (D-08), `ProgressLocation.Notification` (D-09 always-show), per-call `AbortController`, cancellation-token → `controller.abort()` bridge, silent-cancel return-undefined (D-04), non-cancel error re-throw (D-06). JSDoc explicitly documents the cooperative-cancel limitation (RESEARCH Landmine 1).
- **`src/scriptCommands.ts`** — `downloadScriptToTmp` body wrapped in `withScriptProgress(`${actionLabel}: loading...`, ..., { cancellable: true })`. `resolveScriptContext` + no-selection error stay outside the wrap. Cancel-path `finally` best-effort `fs.unlink` of any partial tmp file; unlink failures log to output channel only. Success return guarded by `signal.aborted` (cancel-race fix).

## Tasks

1. Create `src/progress.ts` with `withScriptProgress` helper — PASS (`d15137a`).
2. Wrap `downloadScriptToTmp` body in helper with cancel cleanup — PASS (`b8ce8d8`).
3. Human UAT (Tests A/B/C/D) — APPROVED after one fix cycle (`82837d9`).

## Verification

- `npx tsc --noEmit` → 0
- `npm run compile` → 0
- Manual UAT:
  - Test A (Edit happy path, SC-1) — PASS
  - Test B (Run/Debug 3-for-1) — PASS
  - Test C (Cancel mid-fetch, SC-4 cooperative) — PASS after fix
  - Test D (Title format `Altium 365: ...` + Notification location, SC-3) — PASS

## Deviations from Plan

**[Rule 1 — Bug] Cancel-race left tmpPath returned after unlink** — Found during: Task 3 UAT Test C | Issue: op `return tmpPath` ran even when `signal.aborted` was true; helper resolved to a string, caller opened the just-unlinked file, VS Code surfaced `Unable to resolve nonexistent file ...` | Fix: added `if (signal.aborted) return undefined;` immediately before the success return inside the op closure, so the cancel-race path resolves to `undefined` and the caller's existing `if (!tmpPath) return;` short-circuits | Files modified: `src/scriptCommands.ts` | Verification: re-ran Test C — notification dismisses, no editor opens, no error toast | Commit hash: `82837d9`

**Total deviations:** 1 auto-fixed (Rule 1 — bug surfaced by UAT). **Impact:** Plan acceptance criteria all satisfied; no scope change.

## Key Decisions Honored

- D-04 silent cancel + cleanup unlink, no "Cancelled" toast.
- D-05 helper signature (`label`, `op(signal, progress)`, `opts?.cancellable`).
- D-06 non-cancel errors re-thrown by helper; existing per-command error toasts unchanged.
- D-08 title prefix `Altium 365: `, caller-supplied trailing punctuation.
- D-09 always-show, no delay-show threshold.
- D-10 download title pattern `${actionLabel}: loading...`.

## Issues Encountered

None unresolved. Cancel-race bug found and fixed during UAT (see Deviations).

## Next Phase Readiness

Ready for Plan 05-02 (publish save-bridge wrap) and Plan 05-03 (executeRemoteScript Block A wrap). Both depend on `src/progress.ts` shipped here; no further blockers.
