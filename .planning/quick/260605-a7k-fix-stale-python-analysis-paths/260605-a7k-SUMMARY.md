---
quick_id: 260605-a7k
slug: fix-stale-python-analysis-paths
status: complete
date: 2026-06-05
commit: a037981
---

# Summary: Fix stale Python analysis paths (260605-a7k)

## What was done

Fixed `reconcileNow` in `src/runner/pythonAnalysis.ts` to detect and evict stale
`python.analysis.extraPaths` entries from old extension versions using pattern
matching, preventing accumulation in `.vscode/settings.json`.

Also gitignored `.vscode/settings.json` (machine-local absolute paths should
never be committed).

## Root cause

When `globalState` is fresh (new machine, profile reset, or extension reinstall),
`previousManagedPaths` is empty. The existing paths in `.vscode/settings.json`
were treated as "user paths" by the reconciliation algorithm and preserved —
while new version paths were appended on top. This caused one set of 3 paths
per installed extension version to accumulate.

## Fix

In `reconcileNow`, before calling `reconcilePythonAnalysisPaths`, detect any
`extraPaths` entries that:
1. Match the `altium.developer` extension install pattern (`/extensions/altium.developer-*/python`)
2. Are NOT in `desiredManagedPaths` (current version's paths)

These are folded into `previousManagedPaths` so the reconcile algorithm evicts
them regardless of `globalState` contents.

## Files changed

- `src/runner/pythonAnalysis.ts` — stale path detection in `reconcileNow`
- `test/runner/pythonAnalysis.test.ts` — regression test (137 tests, all pass)
- `.gitignore` — added `.vscode/settings.json`
- `.vscode/settings.json` — removed from git tracking

## Verification

- `npm run compile` — 0 errors
- `npm run lint` — 0 errors
- `npm test` — 137/137 passed
