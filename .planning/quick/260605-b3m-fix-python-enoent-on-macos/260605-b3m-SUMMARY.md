---
quick_id: 260605-b3m
slug: fix-python-enoent-on-macos
status: complete
date: 2026-06-05
commit: b957c2f
---

# Quick Task 260605-b3m: Fix spawn python ENOENT on macOS

## What was done

Patched `resolvePythonPath()` in `src/runner/index.ts` to guard the return value
from the MS Python extension API with `path.isAbsolute()`.

**Change (1 line):**
```typescript
// Before
if (details?.path) {
// After
if (details?.path && path.isAbsolute(details.path)) {
```

## Why

macOS does not ship `python` (only `python3`). The Python extension API can return
a bare command name like `"python"` instead of a full path (e.g. when the active
interpreter is configured as a conda environment whose full path isn't yet resolved).
The bare name was returned directly, bypassing the platform-default fallback branch
that produces `"python3"` on macOS/Linux.

## Outcome

- Bare command names from the Python extension API now fall through to the platform
  default: `python3` on macOS/Linux, `python` on Windows.
- Absolute paths from the Python extension are still trusted and used as-is.
- `getExecutionDetails.exec[0]` is unchanged — user's explicit executor choice.
- 137 tests passing, compile clean, lint 0 errors.
