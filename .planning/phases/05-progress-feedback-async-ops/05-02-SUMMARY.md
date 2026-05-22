---
phase: 05-progress-feedback-async-ops
plan: 02
subsystem: ui-progress
tags: [vscode-extension, progress, publish, save-bridge]
requires: [withScriptProgress]
provides: []
affects: [registerLocalScriptSaveBridge]
tech-stack:
  added: []
  patterns: [withProgress-helper, non-cancellable-mutation]
key-files:
  created: []
  modified: [src/localScriptCache.ts]
key-decisions: [D-01b, D-03, D-10]
requirements-completed: [SC-2-publish-half, SC-3]
duration: 5 min
completed: 2026-05-22
---

# Phase 5 Plan 2: Publish Save-Bridge Summary

Wrapped the `onDidSaveTextDocument` save-back handler in `withScriptProgress('Publishing script...', ..., { cancellable: false })`. Cmd+S and the explicit Publish Script command now surface a branded notification during the previously-silent `remoteFs.writeFile` round-trip.

## What Shipped

- **`src/localScriptCache.ts`** — `registerLocalScriptSaveBridge` body wrapped. Outer scheme/identity guards stay outside the wrap (no spinner on unrelated saves). Existing try/catch with `output.appendLine` + `vscode.window.showErrorMessage` + `setStatusBarMessage(...,3000)` success flash all stay inside the op closure — error and success paths byte-identical apart from the spinner (RESEARCH Landmine 2 — catch does not re-throw, preserving Phase 3 D-02 last-write-wins).

## Tasks

1. Wrap save-bridge body in helper, non-cancellable — PASS (`6c330e9`).
2. Human UAT (Tests A/B/C/D) — APPROVED.

## Verification

- `npx tsc --noEmit` → 0
- `npm run compile` → 0
- Manual UAT: all four tests PASS (Cmd+S spinner; Publish menu spinner; failure path still surfaces error toast; non-bridged saves silent).

## Deviations from Plan

None - plan executed exactly as written.

## Key Decisions Honored

- D-01b save bridge is one of the four wrap sites.
- D-03 publish is non-cancellable (cancel mid-mutation is worse than completed write).
- D-10 title wording `'Publishing script...'`.

## Issues Encountered

None.

## Next Phase Readiness

Ready for Plan 05-03 (executeRemoteScript Block A wrap). Helper from Plan 01 already in place; no further blockers.
