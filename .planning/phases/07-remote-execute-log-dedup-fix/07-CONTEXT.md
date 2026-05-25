---
phase: 07-remote-execute-log-dedup-fix
type: context
created: 2026-05-25
discuss_mode: default
spec_loaded: false
---

# Phase 7 Context: Remote Execute Log-Dedup Fix

<domain>
Eliminate duplicate log batches printed to the OutputChannel during remote script execution.

Observed during Phase 6 Plan 06-03 UAT (2026-05-22): a ~4 second remote script emitted each user log line ~3× because the poll loop re-fetches the same logs page when the server returns an empty `nextToken` and our cursor-advance guard (`src/remoteExecution.ts:292-294`) treats empty as "don't advance" rather than "page exhausted / cursor invalid".

Phase 7 ships ONE fix — client-side dedup via `printedCount` — plus a unit test on the extracted dedup helper. Other log-fidelity observations are out of scope.
</domain>

<canonical_refs>
- `src/remoteExecution.ts:250-309` — `pollExecutionLoop` (the poll tick) and the buggy cursor-advance guard at lines 292-294
- `src/workspace.ts:514-547` — `getExecutionLogs` GraphQL query `gloScrScriptExecutionResult.logs(limit, nextToken) { logs, nextToken }`; `ExecutionLogPage` shape `{logs, nextToken}`
- `.planning/ROADMAP.md:319-345` — original backlog write-up (root cause + 3 fix candidates + open questions)
- `.planning/codebase/CONVENTIONS.md` — `[Altium 365]` log prefix convention; async/await + Promise.all patterns
- `.planning/codebase/TESTING.md` — existing test conventions (review when designing the unit test)

No external specs/ADRs. The GraphQL server contract is opaque (`nextToken: String`); Strategy A is intentionally contract-agnostic so we never need to verify it.
</canonical_refs>

<code_context>
- `pollExecutionLoop` already extracts the poll tick cleanly; the dedup logic is a single helper function `dedupLogs(returned: string[], printedCount: number) → { fresh: string[], newPrintedCount: number }` that consumes the returned page and the running count, returns the un-printed suffix.
- Promise.all pattern (line 274-277) batches `getExecutionResult` + `getExecutionLogs` — preserve this; dedup happens AFTER the await, before `appendLine`.
- `[Altium 365]` log prefix convention applies to NEW log lines we emit (status / footer / errors) but NOT to script-emitted log lines forwarded from `logPage.logs[]` — those are user content, printed verbatim.
- Terminal-status check (line 302) is `result.status.toLowerCase()`-based. The final-batch render before terminal-check (line 287-291 comment) is intentional and must survive the refactor.
- `MAX_WALLCLOCK_MS` (10min) backstop remains the only upper bound; dedup state is bounded by execution length so no separate cap needed.
</code_context>

<decisions>

### D-01 — Fix Strategy: A (Client-side dedup via `printedCount`)

Track `printedCount: number` in the poll loop. After each successful `logPage`, slice `logPage.logs.slice(printedCount)` to get unprinted lines, append those to OutputChannel, then update `printedCount = logPage.logs.length` (NOT `+= sliced.length` — set to the total count so the next tick's slice is correct against the next returned page).

Rationale: contract-agnostic. Works whether `nextToken` is a continuation token (current assumption), a since-filter, or a session token. If the server re-sends overlapping prefixes (the observed behavior), we ignore them. If the server eventually returns clean non-overlapping pages, our slice is a no-op. Adds one integer of state.

Rejected:
- **B (cursor-advance heuristic):** assumes a server contract we haven't verified; if `null` cursor means "start from scratch" the bug gets worse.
- **C (server-side `since:` filter):** requires GraphQL surface we haven't confirmed; bigger query rewrite.
- **A + B combined:** unnecessary belt-and-suspenders — A is correct on its own.

### D-02 — Investigation: skip

Do NOT introspect the GraphQL schema, instrument diagnostic log lines, or otherwise verify the server contract before shipping. Strategy A is correct in every possible server-semantic, so verification is wasted ceremony.

### D-03 — Test format: Unit test on extracted dedup helper

Extract dedup into a pure helper (e.g. `dedupLogPage(returnedLogs: string[], printedCount: number) → { fresh: string[]; newPrintedCount: number }`) in `src/remoteExecution.ts` (or a small new file if it's cleaner). Add a unit test (vitest/jest — match existing testing convention) covering:

- Empty first page → no output, printedCount stays 0.
- First page returns 3 lines → all 3 printed, printedCount = 3.
- Second page returns same 3 lines + 2 new → only 2 new printed, printedCount = 5.
- Second page returns fewer lines than printedCount (server bug — defensive) → no output, no crash, printedCount unchanged.
- Tick after terminal: page returns full final batch → only new tail printed.

No mocking of `getExecutionLogs` needed — helper is pure. Manual UAT is NOT required (the unit test fully covers the regression).

### D-04 — Scope: dedup only

Phase 7 fixes ONLY the dedup bug + ships the unit test. Other log-fidelity observations from Phase 6 UAT (status flip cadence, footer formatting, error-tick visibility, log ordering relative to status changes) are deferred to a future polish phase. Capture any found-while-reading items in `<deferred_ideas>` below; do not bundle into Phase 7.

</decisions>

<deferred_ideas>

For future log-polish phase (capture as discovered during Phase 7 implementation):

- Status-flip log line (line 299) only fires on change — confirm this matches user expectation vs always-show.
- Footer (line 326-328) format consistency review.
- Error-tick visibility — currently `[Altium 365] poll tick failed (will retry): ...` (line 280-282) on every retry. Consider exponential backoff messaging or single "transient errors suppressed" line if N+ ticks fail consecutively.
- Log ordering: Promise.all races `getExecutionResult` + `getExecutionLogs` — if logs from tick N-1 are still in-flight while tick N status flips terminal, ordering may be confusing.

None block Phase 7. Capture as backlog item via `/gsd-add-backlog` if observed.

</deferred_ideas>

<plan_outline>

Single-plan phase. Estimated 1 plan:

- **07-01-PLAN.md** — Extract `dedupLogPage` helper + integrate into `pollExecutionLoop` + unit test. Remove the buggy `if (logPage.nextToken)` guard. ~3 file edits (`src/remoteExecution.ts`, new test file, possibly `src/workspace.ts` if dedup goes near `ExecutionLogPage`).

No research phase needed — the fix is fully specified above. `/gsd-plan-phase 7 --skip-research` is appropriate.

</plan_outline>

---

*Discussion completed: 2026-05-25. Mode: default (interactive). 4 areas selected, 4 questions answered.*
