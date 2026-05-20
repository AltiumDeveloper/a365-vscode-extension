---
phase: 03-remote-script-ops
plan: 05
slug: uat-readme-error-map
status: awaiting-uat-sign-off
completed: pending
requirements: [SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05]
provides:
  - friendly-graphql-error-mapping
  - phase-3-uat-document
  - phase-3-readme-feature-blurb
key-files:
  modified:
    - src/scriptCommands.ts
    - README.md
  created:
    - .planning/phases/03-remote-script-ops/03-UAT.md
---

# Phase 3 Plan 05: UAT + README + Error Mapping Summary

Polish + sign-off plan. Tasks 1–3 (auto) complete; Task 4 (`checkpoint:human-verify`, gate=blocking) is **awaiting operator sign-off** of `03-UAT.md`. No new functional code — only friendly-error mapping, the UAT scenario document, and user-facing README updates.

## What landed (Tasks 1–3)

### Task 1 — `src/scriptCommands.ts` D-11 friendly-error mapping

- New helper `mapGraphQLErrorToUserMessage(code, rawMessage)` — curated mapping for `AUTH_NOT_AUTHENTICATED`, `UNAUTHORIZED`, `BAD_USER_INPUT`, `NOT_FOUND`. Unknown codes fall through to the raw message (T-03-05-01: better to leak an internal code than misclassify a failure).
- All three live command handlers (`editScript`, `publishScript`, `executeRemoteFromUi`) re-routed: catch reads `(err as { code?: string }).code`, calls the mapper, appends the raw `err.message` + `code` (if any) + `err.stack` to OutputChannel, and surfaces the curated text via `showErrorMessage`.
- `runLocal` placeholder branch is **untouched** (Phase 02 BLOCKED — out of scope per 03-CONTEXT scoping and the file's existing inline comments).

### Task 2 — `.planning/phases/03-remote-script-ops/03-UAT.md`

- 5 numbered scenarios covering the SCRIPT-02..05 surface:
  1. Open remote script (SCRIPT-02)
  2. Edit + Save Publish (SCRIPT-03 happy path)
  3. Publish failure preserves dirty state (D-03 + D-11)
  4. Execute Remotely happy path (SCRIPT-04 + SCRIPT-05)
  5. Execute Remotely cancellation (D-10)
- Each scenario has fixed Prerequisites / Steps / Expected Outcome blocks plus blank `Observed Outcome` and `Pass/Fail` rows for the operator.
- Observations section captures (a) every distinct terminal `status` value seen — feeds Pitfall 5 / `TERMINAL_STATUSES` tightening — and (b) free-form deviations.
- Quick regression-sanity checklist (sign-in, env switch, workspace switch, runLocal placeholder unchanged) below the scenarios.
- Sign-off block at the bottom (Signed off by / Date / PASS-FAIL / failing scenarios / notes).

### Task 3 — `README.md` Remote scripts section

- New top-level `## Remote scripts` section inserted between Switching Environments and Commands Reference. Mirrors the OAuth section's writing style.
- Three subsections: **Open + Edit + Publish**, **Execute Remotely**, **Authentication + workspaces**.
- Both required user-visible caveats present in plain language:
  - **Last-write-wins caveat (D-02)** — "the most recent save wins — coordinate edits out-of-band" + "diff/conflict UI is planned but is not in this release".
  - **Cancellation caveat (D-10)** — verbatim string `Remote execution cancelled (server-side execution continues)` quoted.
- No internal references (Phase numbers, SCRIPT-IDs, D-XX) appear in user-facing copy.

## Decisions / Deviations

- None vs plan. All three tasks landed exactly as specified in `<interfaces>` / `<action>`.
- Helper signature `mapGraphQLErrorToUserMessage(code: string | undefined, rawMessage: string): string` — kept synchronous, no I/O, pure function. Localization is intentionally **not** introduced (phase-out-of-scope; see 03-CONTEXT).

## Threat Mitigations Verified

| Threat ID  | Status |
|------------|--------|
| T-03-05-01 | mitigated — internal codes only land in OutputChannel; toast uses curated text. Unknown codes fall through to raw message rather than risking misclassification. |
| T-03-05-02 | accept — UAT compliance is informational; the checkpoint forces a deliberate pause but cannot enforce that scenarios were actually run. |
| T-03-05-SC | n/a — no new packages added. |

## Invariants confirmed

- D-02 — README documents the blind-overwrite caveat ✅
- D-09 — error path appends to module-level `outputChannel` only; no new channels ✅
- D-10 — README contains "server-side execution continues" verbatim ✅
- D-11 — friendly mapping is the ONLY transformation at command boundary; full body unchanged in OutputChannel ✅
- D-12 / D-13 — no automated tests added ✅
- D-14 — 02.2 auth surface NOT touched; 02.3 D-17/D-18/D-19 NOT touched ✅
- `runLocal` placeholder UNCHANGED (Phase 02 BLOCKED) ✅
- No new commands; no `package.json` change ✅

## Self-Check: PASSED (Tasks 1–3)

- [x] `mapGraphQLErrorToUserMessage` defined in `src/scriptCommands.ts` and referenced ≥ 4 times.
- [x] `AUTH_NOT_AUTHENTICATED` and `BAD_USER_INPUT` cases present.
- [x] `runLocal` placeholder + "Phase 02 BLOCKED" inline comments still present.
- [x] `.planning/phases/03-remote-script-ops/03-UAT.md` exists with 5 `## Scenario` sections and a Sign-off block.
- [x] README has `## Remote scripts`, "last-write-wins" / "coordinate edits" copy, and "server-side execution continues" verbatim.
- [x] `npm run compile` clean.

## Awaiting (Task 4 — `checkpoint:human-verify` gate=blocking)

Operator must:

1. F5 the workspace to launch the Extension Development Host.
2. Execute Scenarios 1–5 in `03-UAT.md`, filling in Observed Outcome + Pass/Fail rows.
3. Capture terminal `status` values observed in the Observations section (feeds Pitfall 5 follow-up).
4. Sign the Sign-off block.

After sign-off, this SUMMARY will be amended with:

- Final status (PASS / FAIL).
- Distinct terminal `status` values observed (so `TERMINAL_STATUSES` in `src/remoteExecution.ts` can be tightened in a follow-up if needed).
- Any fix-forward items deferred to a v2 phase or backlog.
- Closing line: "Phase 3 (Remote Script Operations) complete — SCRIPT-02..05 closed."

## Next

Awaiting operator UAT sign-off. No further executor work until `approved` is signalled or fix-forward items are listed.
