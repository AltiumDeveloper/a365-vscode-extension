---
phase: 02-side-panel
plan: 02
subsystem: auth
tags: [oauth2, vscode-secrets, jwt, event-emitter, token-cache]

requires:
  - phase: 01-packaging
    provides: foundation extension scaffold + existing src/auth.ts PKCE flow
provides:
  - Per-workspace token cache keyed by workspaceId in SecretStorage
  - ensureWorkspaceToken(ctx, cfg, {workspaceId, authId}) with expiry-aware reuse
  - onAuthStateChanged event + fireAuthStateChanged broadcaster
  - getActiveUserLabel(ctx) JWT-claim accessor for status-bar display
  - AuthState interface contract for Plan 04 (tree refresh) and Plan 05 (status bar)
affects: [02-04 sidePanel TreeDataProvider, 02-05 status bar, 02-06 script commands]

tech-stack:
  added: []
  patterns:
    - "Prefix-keyed SecretStorage cache with globalState index for enumeration on sign-out (RESEARCH.md Pattern 4 / Pitfall 5)"
    - "Module-level vscode.EventEmitter as singleton broadcast channel (documented CONVENTIONS.md exception)"
    - "Signature-unverified JWT claim read for display-only labels (T-02-02-04)"

key-files:
  created: []
  modified:
    - src/auth.ts

key-decisions:
  - "ensureWorkspaceToken propagates exchange errors instead of silent fallback (PATTERNS.md S1, RESEARCH.md Pitfall 5) — caller (sidePanel.ts) decides retry/UI"
  - "Legacy SECRET_WORKSPACE_TOKENS singleton key remains deleted by clearAllTokens to cover upgrade path (no migration code needed beyond delete)"
  - "EventEmitter not pushed into ctx.subscriptions — module-level singleton lives for extension lifetime; documented as approved exception"
  - "getActiveUserLabel falls back to literal '(signed in)' on missing/malformed id_token rather than undefined, so status bar can always render something when signed in"

patterns-established:
  - "Per-workspace secret cache: `SECRET_WS_TOKEN_PREFIX + workspaceId` with globalState index for full enumeration on clearAllTokens"
  - "Auth event broadcast: producers call authStateEmitter.fire wrapped in try/catch so emitter failure never breaks the source operation"

requirements-completed: [PANEL-06]

duration: 4 min
completed: 2026-05-19
---

# Phase 02 Plan 02: Auth Refactor Summary

**Per-workspace token cache (SecretStorage-keyed by workspaceId) plus AuthState event emitter and id_token claim accessor for status-bar/tree consumers**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T17:00:00Z (approx)
- **Completed:** 2026-05-19T17:04:00Z (approx)
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- `ensureWorkspaceToken()` exported — D-01 honored: per-workspace tokens cached under `altium365.workspaceTokens.<workspaceId>` with expiry check and globalState-indexed enumeration
- `clearAllTokens()` now drains every prefixed key plus the legacy singleton — no orphan tokens after sign-out (T-02-02-02)
- `onAuthStateChanged` + `fireAuthStateChanged` + `AuthState` exported — broadcast channel ready for Plan 04 tree refresh and Plan 05 status bar
- `getActiveUserLabel()` exported — derives display name from id_token (`preferred_username` → `email` → `name` → `(signed in)`), malformed JWT safely returns `(signed in)` (T-02-02-04)
- All 8 existing exports kept signature-stable; extension.ts and workspace.ts callers unchanged

## Task Commits

1. **Task 1: Per-workspace token cache + clearAllTokens drain** — `dfbe5bb` (feat)
2. **Task 2: AuthState emitter + getActiveUserLabel** — `dc658d5` (feat)

**Plan metadata:** _to follow_ (docs commit with this SUMMARY)

## Files Created/Modified

- `src/auth.ts` — Added `SECRET_WS_TOKEN_PREFIX`, `GLOBAL_WS_TOKEN_INDEX_KEY`, `AuthState` interface, module-level `authStateEmitter`, `onAuthStateChanged`, `fireAuthStateChanged`, `decodeIdTokenClaims` (private), `userLabelFromClaims` (private), `ensureWorkspaceToken`, `getActiveUserLabel`. Extended `signIn` to fire `{ signedIn: true, user }` and `clearAllTokens` to drain prefix-keyed cache + fire `{ signedIn: false }`.

## Decisions Made

- Used a helper `userLabelFromClaims` instead of inlining the claim-precedence chain in both `signIn` (event payload) and `getActiveUserLabel` — single source of truth for the label rule.
- Wrapped both emitter `fire()` calls in try/catch so listener exceptions cannot break sign-in or sign-out (per acceptance criterion "Never throw" / disposable safety).

## Deviations from Plan

None — plan executed exactly as written. The action block listed an additional private helper (`userLabelFromClaims`) implicitly via the claim-precedence rule; this was extracted to avoid duplicating logic between `signIn`'s emitter payload and `getActiveUserLabel`. Behavior is identical to the spec.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 04 (sidePanel TreeDataProvider) can now subscribe to `onAuthStateChanged` to trigger tree refresh on sign-in/sign-out/env-switch.
- Plan 05 (status bar) can call `getActiveUserLabel(ctx)` for the `A365: <user> • <env>` rendering and call `fireAuthStateChanged({ environment })` from `doSelectEnvironment` after env switch.
- Plan 06 (script commands) can rely on `ensureWorkspaceToken()` for per-call workspace-scoped tokens with automatic expiry handling.
- Sibling Wave-1 plans (02-01 listScripts, 02-03 package.json contributes) unaffected by this work.

## Self-Check: PASSED

- `src/auth.ts` exists and contains all 4 new exports (verified by grep).
- Commits `dfbe5bb` and `dc658d5` present on `main` (verified by `git log`).
- `npm run compile` exits 0 after each commit.
- All 8 pre-existing exports retained with unchanged signatures (verified by grep).

---
*Phase: 02-side-panel*
*Completed: 2026-05-19*
