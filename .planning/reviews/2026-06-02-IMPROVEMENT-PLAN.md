# Improvement Plan — Code Review Remediation

**Source:** `.planning/reviews/2026-06-02-CODE-REVIEW.md`
**Created:** 2026-06-02
**Status:** Proposed

This plan organises the 30 findings into 5 sequential phases, each shippable independently, each commitable atomically per finding. Total estimated effort: **2–3 focused days**.

---

## Phase A — Critical Bugs (P0)

**Goal:** Eliminate the two correctness/lifecycle bugs that can cause data loss or orphaned processes.

| # | Finding | File | Effort |
|---|---------|------|--------|
| A1 | CR-01: Fix `TestEventFs.delete` arg shape; reconstruct identity from URI | `src/testEvents/eventFs.ts`, `src/testEvents/identity.ts` | M |
| A2 | CR-02 + HI-02: Track subprocesses + tmp files in module set; cleanup on `deactivate` and proc exit | `src/runner/index.ts`, `src/extension.ts` | M |
| A3 | Regression tests for A1 (event delete URI dispatch) and A2 (tmp file cleanup on exit) | `test/testEvents/eventFs.test.ts`, `test/runner/*` | S |

**Acceptance:**
- Deleting an open `altium365-event://` document deletes the correct event on the correct script
- Killing the extension host mid-execution leaves no orphan Python processes and no leftover tmp param files
- New vitest cases cover both scenarios

**Commits:** 3 atomic.

---

## Phase B — Auth & Resource Hygiene (P1)

**Goal:** Harden auth resilience and dispose all event emitters / subscriptions correctly.

| # | Finding | File | Effort |
|---|---------|------|--------|
| B1 | HI-01: Wrap `getStoredTokens` JSON.parse in try/catch; auto-clear corrupt secrets | `src/auth/index.ts` | S |
| B2 | HI-03: Push all FSP/tree EventEmitters into `context.subscriptions` | `src/scripts/remoteFs.ts`, `src/testEvents/eventFs.ts`, `src/ux/panel.ts` | S |
| B3 | HI-04: Fix `pickTestEvent` listener leak — capture/dispose `onDidAccept`/`onDidHide` | `src/testEvents/picker.ts` | S |
| B4 | Regression test for B1 (corrupt token recovery) | `test/auth/auth.test.ts` | S |

**Acceptance:**
- Manually corrupting the secret entry → next sign-in check returns `undefined` without throwing, secret is cleared, no toast spam
- Code review confirms every `EventEmitter` and `Disposable` created in extension code is reachable from `context.subscriptions`

**Commits:** 4 atomic.

---

## Phase C — Typed Contracts & Concurrency (P1)

**Goal:** Replace fragile string contracts and stateState-read races with typed return values / typed errors.

| # | Finding | File | Effort |
|---|---------|------|--------|
| C1 | HI-08: Introduce `SignInCancelledError` class; `instanceof` check at command boundary | `src/auth/index.ts`, `src/ux/commands.ts` | S |
| C2 | HI-06: `altium365.selectWorkspace` returns selected `WorkspaceInfo \| undefined`; update callers | `src/ux/commands.ts`, `src/testEvents/commands.ts` | M |
| C3 | ME-03: Await `setContext` calls in `updateActiveRemoteContext` or serialize via mutex | `src/extension.ts` | S |
| C4 | ME-08: Replace `reconcileLock` ad-hoc promise chain with `AsyncMutex` | `src/runner/pythonAnalysis.ts` | S |

**Acceptance:**
- User-cancelled sign-in shows no error toast even if message wording changes
- `pickProjectIdSafe` post-`selectWorkspace` path uses the returned workspace, never re-reads stale globalState
- No more fire-and-forget context updates on tab switch

**Commits:** 4 atomic.

---

## Phase D — Partial-Failure & Performance UX (P2)

**Goal:** Improve UX when one of N backend calls fails, and remove sync I/O from hot paths.

| # | Finding | File | Effort |
|---|---------|------|--------|
| D1 | HI-07: `Promise.allSettled` in `loadWorkspaceChildren`; per-category error placeholder nodes | `src/ux/panel.ts` | M |
| D2 | HI-09: Exponential backoff + consecutive-failure circuit breaker in `executeRemoteScript` poll | `src/scripts/execution.ts` | M |
| D3 | HI-05: Replace `realpathSync` with async + per-session cache in `normalizeLocalScriptKey` | `src/scripts/localCache.ts` | M |
| D4 | ME-09: Add disabled "(no projects)" separator in `pickProjectId` | `src/ux/projectPicker.ts` | XS |
| D5 | ME-10: Log malformed `getExecutionLogs` responses to output channel | `src/workspace/execution.ts` | XS |

**Acceptance:**
- Simulated extension-points endpoint failure still renders projects + scripts tree branches
- Polling against a flapping backend backs off and surfaces a clear error after N failures
- Rapid tab switching across many files no longer blocks UI thread

**Commits:** 5 atomic.

---

## Phase E — Code Quality Sweep (P3)

**Goal:** Address remaining MEDIUM/LOW findings as a single quality pass. Each item committed individually.

### Type safety / duplication
- ME-01: Extract UUID/GRID regexes to `src/shared/identity.ts`
- ME-02: Replace dynamic `await import('../workspace')` with static import in `localCache.ts`
- ME-05: Remove unused `cfg` parameter from `pickWorkspace`
- ME-06: Replace `(node as any)` casts in `extractScriptContext` with type guard
- ME-07: Add typed `assignmentId` accessor on `A365Node` union
- ME-11: Inject normalizer into `reconcilePythonAnalysisPaths` (remove `vscode.Uri.file` from "pure" path)
- LO-04: Internal `RawAssignment` type in `extensionPoints.ts`
- ME-04: Document/allowlist `'Pending'` status in `executeAssignment`

### Logging / observability
- LO-02: Centralize `'[Altium 365] '` prefix as `LOG_PREFIX` shared constant
- LO-07: Log cooperative cancellation in `withScriptProgress`
- LO-08: Log fallback path in `statusBar` `'(signed in)'` case

### Documentation / nits
- LO-01: Resolve `paramsSummary = 'none'` TODO in `panel.ts`
- LO-03: Share context-value string constants between `panel.ts` and (doc reference for) `package.json`
- LO-05: Add `// NOTE:` warning on `decodeIdTokenClaims` re. unverified JWT
- LO-06: Prefix `_newUri` in `eventFs.rename` to clarify intent

**Acceptance:**
- `npm run compile` clean, `npm run lint` 0 errors / 0 warnings, all tests green
- Grep for `(node as any)`, `as any`, dynamic imports, duplicated regexes returns expected (minimal) results

**Commits:** ~15 atomic, one per item.

---

## Cross-Cutting Verification Gates

After every phase:
- `npm run clean && npm run compile` — green
- `npm run lint` — 0 errors
- `npm test` — all tests passing (count should monotonically increase as regression tests added)
- Manual smoke: sign in, browse tree, run local script, run remote script, edit/delete test event, sign out

---

## Effort Summary

| Phase | Findings | Effort | Risk |
|-------|----------|--------|------|
| A — Critical | 2 + tests | ~3 hours | Low (well-scoped) |
| B — Auth & Hygiene | 3 + test | ~2 hours | Low |
| C — Contracts & Concurrency | 4 | ~3 hours | Medium (touches command signatures) |
| D — Partial Failure & Perf | 5 | ~4 hours | Medium (touches tree rendering) |
| E — Quality Sweep | 19 | ~4 hours | Low (mostly local refactors) |
| **Total** | **30** | **~16 hours** | — |

---

## Out-of-Scope (Not in Plan)

- Python runtime (`python/_runner.py`, `python/a365.py`) — out of TypeScript review scope
- Test coverage expansion beyond the two targeted regression cases (A3, B4) — separate audit
- Architectural refactors (further decomposing `panel.ts`, `auth/index.ts`) — see Phase 13 (extension-decomposition) which is already complete; revisit only if E-phase reveals churn
