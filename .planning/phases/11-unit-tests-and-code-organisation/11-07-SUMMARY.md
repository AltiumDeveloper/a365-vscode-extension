# Plan 11-07 Summary — Entity/Platform API Contract Tests

## What was done

Created `test/entityApi.test.ts` with 13 tests covering:

**buildScriptUri ↔ parseScriptUri round-trips (5 tests):**
- Simple authId + UUID scriptId + displayName preserved exactly
- authId with multiple hyphens preserved exactly
- displayName with spaces preserved
- scriptName with slashes does not throw (documents actual behaviour)
- Multiple distinct round-trips do not bleed into each other

**installApp error mapping (8 tests):**
- `AUTH_FORBIDDEN` → admin escalation message
- `PERMISSION_DENIED` → admin escalation message
- `FORBIDDEN` → admin escalation message
- `UNAUTHORIZED` → admin escalation message
- Non-permission `NOT_FOUND` → re-throws original `GraphQLError`
- Plain `Error('network error')` → re-throws as-is
- Success path → returns app id string
- Empty `gloApp` response → throws `'installApp: unexpected empty response'`

## Test results

```
✓ test/entityApi.test.ts (13 tests) 4ms
```

Full suite: **142 tests, 14 files — all passing.**

## No source changes required

`buildScriptUri`, `parseScriptUri`, `installApp`, and `GraphQLError` were already exported.

## Commit

`33c6898` — test(11-07): entity/platform API contract tests — URI round-trips and installApp permission error mapping
