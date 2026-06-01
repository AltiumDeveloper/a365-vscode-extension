# Plan 11-01 Summary: VS Code Mock + Auth Unit Tests

**Status:** Complete
**Commit:** 1f8f942
**Date:** 2026-06-01

## What Was Built

### test/__mocks__/vscode.ts
Replaced the empty `export {}` stub with a comprehensive shared mock consumed by all Phase 11 plans. Exports:
- `EventEmitter<T>`, `Disposable` — full implementations matching VS Code contract
- `Uri` — `from()`, `parse()`, `file()` preserving raw path characters (no percent-encoding)
- `FileSystemError` — extends Error with static `FileNotFound`, `Unavailable`, `FileNotADirectory`, `NoPermissions` factories and `code` property
- `FileType`, `FileChangeType`, `QuickPickItemKind` enums
- `window`, `workspace`, `commands`, `env` stubs (all `vi.fn()`)
- `makeSecretStorage()`, `makeGlobalState()`, `makeExtensionContext()` factory functions (D-03)

### src/auth.ts
Exported four previously private functions (D-05):
- `decodeIdTokenClaims` — JWT base64url decode without signature verification
- `userLabelFromClaims` — claim priority (preferred_username → email → name → fallback)
- `withExpiry` — sets `expires_at = now + expires_in - 30` when absent
- `isExpired` — checks `expires_at` against current epoch seconds

### test/auth.test.ts
23 tests across 6 `describe` blocks:
- `decodeIdTokenClaims` — undefined/2-part/valid JWT/malformed JSON (4 tests)
- `userLabelFromClaims` — undefined/preferred_username/email/name/empty claims (5 tests)
- `withExpiry` — sets expires_at/preserves existing (2 tests)
- `isExpired` — no expires_at/future/past (3 tests)
- `getStoredTokens` — empty/valid JSON (2 tests)
- `clearAllTokens` — fires event/silent mode/workspace index cleanup (3 tests)
- `refreshTokens` — no tokens/no refresh_token/success/refresh_token preserved (4 tests)

## Decisions Made

- Private helpers exported directly from `auth.ts` (not moved to separate file) — closely coupled to `TokenSet`
- Module-level `authStateEmitter` subscription pattern: subscribe in test, dispose in `afterEach` (Pitfall 1 mitigation)
- `vi.stubGlobal('fetch', ...)` + `afterEach(() => vi.unstubAllGlobals())` pattern for fetch mocking (Pitfall 5 mitigation)

## Verification

- `npm run compile` — ✓ exits 0
- `npx vitest run test/auth.test.ts` — ✓ 23/23 tests pass
- `npm test` — ✓ all test files pass
