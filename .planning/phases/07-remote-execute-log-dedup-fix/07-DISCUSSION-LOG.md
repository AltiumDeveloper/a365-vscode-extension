# Phase 7 Discussion Log

**Date:** 2026-05-25
**Mode:** default (interactive)
**Areas discussed:** 4 of 4 presented

---

## Area 1 — Fix strategy (A vs B vs C)

**Options presented:**
- A: Client-side dedup (track printed count) [Recommended]
- B: Cursor-advance heuristic (advance nextToken unconditionally on empty)
- C: Server-side since-filter (if GraphQL surface exists)
- A + B combined (defense-in-depth)

**User selected:** A — Client-side dedup via `printedCount`

**Rationale:** Contract-agnostic. Works regardless of what `nextToken` actually means on the server. No verification ceremony needed. Adds one integer of state.

---

## Area 2 — Investigation depth

**Options presented:**
- Skip investigation — A is contract-agnostic [Recommended]
- Instrument first (diag log lines for 3 ticks), ship dedup, remove diag
- Introspect GraphQL schema first

**User selected:** Skip investigation

**Rationale:** Strategy A is correct in every possible server semantic. Verifying the contract is wasted ceremony.

---

## Area 3 — Regression test format

**Options presented:**
- Unit test on extracted dedup helper [Recommended]
- Manual UAT only
- Unit test + manual UAT (belt + suspenders)
- No test

**User selected:** Unit test on extracted dedup helper

**Rationale:** Helper is pure → unit test is fast, deterministic, CI-friendly. Manual UAT adds no coverage beyond what the unit test provides.

---

## Area 4 — Scope guard

**Options presented:**
- Dedup only — capture others as backlog [Recommended]
- Dedup + opportunistic cleanups
- Audit-first — bundle all log issues

**User selected:** Dedup only

**Rationale:** Keep the phase small and reviewable. Other log-fidelity issues get captured as backlog or a future polish phase.

---

## Deferred Ideas (captured during discussion)

Future log-polish phase candidates:

1. Status-flip log line (`src/remoteExecution.ts:299`) only fires on change — review if matches user expectation.
2. Footer (line 326-328) format consistency review.
3. Error-tick visibility — currently logs `poll tick failed (will retry)` on every retry. Consider backoff messaging or suppression after N consecutive failures.
4. Log ordering — `Promise.all(getExecutionResult, getExecutionLogs)` race; tick N-1 logs may render after tick N status flip.

None block Phase 7.

---

## the agent's discretion items

None. All four areas were explicit user decisions.

---

*Captured by: gsd-discuss-phase, default mode*
