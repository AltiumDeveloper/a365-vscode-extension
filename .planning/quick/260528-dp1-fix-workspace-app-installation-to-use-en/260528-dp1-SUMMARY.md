---
phase: quick
plan: 260528-dp1
subsystem: workspace
tags: [config, environment, app-installation, architecture]
dependency_graph:
  requires: [260528-dhr]
  provides: [environment-based-app-grid]
  affects: [workspace-api, environment-switching]
tech_stack:
  added: []
  patterns: [environment-config-lookup]
key_files:
  created: []
  modified:
    - src/extension.ts (EnvironmentSpec interface)
    - package.json (environment defaults + schema)
    - src/workspace.ts (app installation functions)
decisions:
  - D-01: App GRIDs configured in package.json environment specs, not URL-guessed
  - D-02: checkAppInstalled accepts appId parameter from caller (not inferred)
  - D-03: Integration pattern documented for future Phase 3 implementation
metrics:
  duration_minutes: 4
  completed_date: 2026-05-28
---

# Quick Task 260528-dp1: Fix Workspace App Installation to Use Environment-Specific App GRIDs

**One-liner:** Replace fragile URL pattern matching with proper environment config lookups for app GRID selection.

## Summary

Quick task 260528-dp1 eliminates architectural misalignment introduced in 260528-dhr by replacing URL-based app GRID guessing with proper environment configuration. Each environment spec now has an explicit `appId` field, and app installation functions accept this as a parameter rather than inferring it from endpoint URLs.

**Impact:** Eliminates fragile URL pattern matching that could fail with custom deployments or unexpected URLs. Aligns app installation with the extension's existing environment switching architecture.

## What Was Built

### 1. Environment Configuration Schema (Task 1)
- **EnvironmentSpec interface** — Added `appId?: string` field
- **package.json defaults** — Added environment-specific app GRIDs:
  - Dev: `grid:global::platform:app/696d58cb-3803-4c8a-9711-c9bad5e8ba81`
  - Uat: `grid:global::platform:app/4b70ae94-c06d-44a1-967f-76b26cd2c81a`
  - Prod: `grid:global::platform:app/71277081-7c79-4309-af3c-f3fd36b68c69`
- **JSON schema** — Updated `additionalProperties` to include `appId` field

### 2. App Installation Functions Refactored (Task 2)
- **Removed** `getAppIdForEnvironment()` function entirely (URL pattern matching)
- **Removed** `APP_GRID_DEV`, `APP_GRID_UAT`, `APP_GRID_PROD` constants (DRY violation)
- **Updated** `checkAppInstalled()` signature to accept `appId: string` parameter
- **Updated** `checkAppInstalled()` logic to check only the provided appId (not all three GRIDs)
- **Updated** JSDoc to document the appId parameter source

### 3. Integration Pattern Documentation (Task 3)
- **Section comment** replaced with complete integration pattern showing:
  - How to read `appId` from active environment config
  - Proper error handling when `appId` is missing
  - Complete app installation flow using environment-specific appId
- **Note:** No actual caller code exists yet (Phase 3 will implement)

## Deviations from Plan

**None** — Plan executed exactly as written.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 199efe3 | feat(260528-dp1): add appId field to EnvironmentSpec and package.json environments |
| 2 | 5e04e8a | refactor(260528-dp1): remove URL-based app GRID guessing, update checkAppInstalled to accept appId |
| 3 | f476dca | docs(260528-dp1): document integration pattern for reading appId from environment config |

## Key Files Modified

| File | Changes |
|------|---------|
| `src/extension.ts` | Added `appId?: string` to EnvironmentSpec interface |
| `package.json` | Added `appId` to Dev/Uat/Prod environment defaults + JSON schema |
| `src/workspace.ts` | Removed URL guessing function, refactored checkAppInstalled, documented integration pattern |

## Before/After

### Before (URL-based guessing)
```typescript
// Fragile URL pattern matching
export function getAppIdForEnvironment(endpoint: string): string {
    const endpoint = endpoint.toLowerCase();
    if (endpoint.includes('dev') || endpoint.includes('dev1')) {
        return APP_GRID_DEV;
    }
    // ...
}

// Caller had no control over app GRID
const installed = await checkAppInstalled(endpoint, token);
```

### After (Environment config)
```typescript
// Explicit per-environment configuration
const cfg = vscode.workspace.getConfiguration('altium365');
const activeEnv = envs[cfg.get<string>('activeEnvironment')];
const appId = activeEnv?.appId;

// Caller provides the correct app GRID
const installed = await checkAppInstalled(endpoint, token, appId);
```

## Verification Results

All success criteria met:

- ✅ `EnvironmentSpec` interface has `appId?: string` field
- ✅ Package.json default environments (Dev/Uat/Prod) each have correct `appId` GRID
- ✅ `getAppIdForEnvironment()` function removed entirely
- ✅ APP_GRID_* constants removed (DRY — single source of truth in package.json)
- ✅ `checkAppInstalled()` accepts `appId` parameter and checks only that GRID
- ✅ Section comment documents integration pattern using `activeEnv?.appId`
- ✅ TypeScript compilation passes
- ✅ No grep matches for `getAppIdForEnvironment` in codebase

## Architecture Impact

**Before:** App installation used a two-layer architecture violation:
1. Environment system stored endpoint URLs in config
2. App installation re-parsed those URLs to guess the environment

**After:** Single source of truth — environment config contains all environment-specific values including app GRID.

**Benefit:** Custom deployments or non-standard URLs no longer break app installation. Environment switching properly updates all dependent values atomically.

## Future Integration (Phase 3)

When Phase 3 implements remote script operations that require app installation:

1. Read `activeEnvironment` from config
2. Lookup environment spec in `environments` config
3. Extract `appId` from environment spec
4. Guard against missing `appId` (user may have old config)
5. Pass `appId` to `checkAppInstalled()` and `installApp()`

See `src/workspace.ts` line 760-787 for complete integration pattern code.

## Self-Check: PASSED

**Created files:** None (quick task — no new files)

**Modified files:**
- ✅ `src/extension.ts` exists and contains `appId?: string` field
- ✅ `package.json` exists and has `appId` in all three environment defaults
- ✅ `src/workspace.ts` exists and has updated functions

**Commits:**
- ✅ `199efe3` exists in git log
- ✅ `5e04e8a` exists in git log
- ✅ `f476dca` exists in git log

**Verification:**
```bash
$ npm run compile
> developer@0.1.0 compile
> tsc -p ./
# No errors

$ grep -q "getAppIdForEnvironment" src/workspace.ts
# No matches — function removed

$ grep "appId" package.json | wc -l
# 5 matches (3 environment defaults + 1 schema + 1 description reference)
```

All claims verified. Quick task 260528-dp1 complete.
