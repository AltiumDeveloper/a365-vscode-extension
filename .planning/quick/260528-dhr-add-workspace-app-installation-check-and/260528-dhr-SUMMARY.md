---
type: quick
phase: quick
plan: 260528-dhr
subsystem: workspace
tags: [graphql, app-installation, oauth, security]
completed: 2026-05-28
duration: 2 min
decisions:
  - Hardcoded app GRIDs per environment (Dev/UAT/Prod) - acceptable per requirements
  - Permission errors mapped to actionable admin escalation message
  - getAppIdForEnvironment uses case-insensitive URL matching with fallback to Prod
  - checkAppInstalled returns boolean (no error on missing app) - caller decides next action
key_files:
  created: []
  modified: [src/workspace.ts, package.json]
commits: [97e7dae, 8f12069]
---

# Quick Task: Add Workspace App Installation Check and Install Flow

**One-liner:** App installation check via `gloAppInstalledApps` query and consent-gated install flow via `gloInstallApp` mutation with admin-only permission handling, plus production OAuth client ID update.

## Summary

Added workspace app installation verification and installation flow to prevent AUTH_NOT_AUTHENTICATED errors when the extension app isn't installed. The implementation includes three new exported functions in `src/workspace.ts`:

1. **checkAppInstalled(endpoint, workspaceToken)** — Queries `gloAppInstalledApps` and returns boolean indicating whether any of the three environment-specific app GRIDs (Dev/UAT/Prod) are installed
2. **installApp(endpoint, workspaceToken, appId)** — Mutation calling `gloInstallApp` with explicit user-consent requirement documented in JSDoc; maps permission-denied GraphQL errors to actionable "contact your workspace admin" messages
3. **getAppIdForEnvironment(graphqlEndpoint)** — Helper that inspects the endpoint URL to return the correct app GRID for Dev/UAT/Prod environments

Also updated the default OAuth client ID in package.json from the temporary value to the production-ready client ID `4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D`.

## Tasks Completed

### Task 1: Add app installation check and install flow
- **Status:** ✅ Complete
- **Commit:** 97e7dae
- **Files:** src/workspace.ts
- **Verification:** TypeScript compilation passes, all three exports present with correct signatures, GraphQL query/mutation strings match schema requirements, JSDoc comments describe usage patterns

**Implementation details:**
- `InstalledAppInfo` interface added for type safety
- GraphQL query `CHECK_APP_INSTALLED_QUERY` fetches `gloAppInstalledApps { id name }`
- `checkAppInstalled` builds a Set of installed app IDs and checks against all three known GRIDs
- GraphQL mutation `INSTALL_APP_MUTATION` calls `gloInstallApp(input: { id }) { gloApp { id } }`
- `installApp` wraps mutation in try/catch to map permission errors (AUTH_FORBIDDEN, PERMISSION_DENIED, FORBIDDEN, UNAUTHORIZED) to friendly admin escalation message
- `getAppIdForEnvironment` uses lowercase string.includes() for case-insensitive matching (dev/dev1/dev-365 → Dev, uat → UAT, else Prod)
- JSDoc emphasizes consent requirement before calling `installApp` and describes when to use `checkAppInstalled`

### Task 2: Update default OAuth client ID
- **Status:** ✅ Complete
- **Commit:** 8f12069
- **Files:** package.json
- **Verification:** package.json has correct default value `4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D` under altium365.clientId, JSON is valid (compilation passes)

**Change:** Updated line 185 in package.json configuration schema from `20C490ED-58EF-11EF-9194-02A5C34CA889` to `4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D`.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

**Automated verification:**
- ✅ `npm run compile` passes without errors
- ✅ All three exports (`checkAppInstalled`, `installApp`, `getAppIdForEnvironment`) exist with correct TypeScript signatures
- ✅ GraphQL query uses `gloAppInstalledApps { id name }` matching schema
- ✅ GraphQL mutation uses `gloInstallApp(input: { id }) { gloApp { id } }` matching schema
- ✅ `getAppIdForEnvironment` returns correct GRID constants for each environment keyword
- ✅ Default OAuth client ID updated to `4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D` in package.json

**Type safety:**
- All functions properly typed with async/await patterns
- InstalledAppInfo interface matches GraphQL response shape
- No `any` types in new code (except inherited from graphqlRequest return type)
- Error handling preserves GraphQLError type for caller inspection

**Code style compliance:**
- Follows existing workspace.ts patterns (graphqlRequest helper, typed interfaces, JSDoc comments)
- Proper error propagation via throw (not console.error)
- Async/await throughout
- Section comment headers matching existing Phase-based organization

## Technical Notes

**App GRID resolution strategy:**
The `getAppIdForEnvironment` helper uses URL substring matching to detect environments:
- Dev environment: matches "dev", "dev1", or "dev-365"
- UAT environment: matches "uat"
- Production: default for all other endpoints (including unknown)

This approach is defensive — when in doubt, assume production GRID rather than failing.

**Permission error mapping:**
The `installApp` function catches GraphQLError instances and inspects the error code. It maps four known permission-related codes (AUTH_FORBIDDEN, PERMISSION_DENIED, FORBIDDEN, UNAUTHORIZED) to a friendly message directing non-admin users to contact their workspace admin. Other errors (network failures, schema mismatches, unknown GraphQL errors) are re-thrown unchanged.

**Consent requirement:**
JSDoc explicitly documents that `installApp` must only be called after user consent via UI prompt. The function does NOT validate this constraint at runtime — callers are responsible for showing a confirmation dialog before invoking. This is a security/UX best practice to prevent silent app installations.

**Integration pattern (for future work):**
The plan includes a caller integration pattern showing how to wire these functions into a command handler:
1. Call `checkAppInstalled` before workspace-scoped operations
2. If false, show `vscode.window.showInformationMessage` with "Install Now" action button
3. If user confirms, call `getAppIdForEnvironment` to resolve the GRID
4. Call `installApp` with the resolved GRID
5. Show success toast on completion

This pattern will be implemented in future phases when workspace-scoped commands need app installation guards.

## Known Stubs

None. All functions are fully implemented with complete error handling, type safety, and GraphQL integration.

## Self-Check

✅ **PASSED**

**Created files:** None (all changes were modifications)

**Modified files exist:**
- ✅ src/workspace.ts (144 lines added)
- ✅ package.json (1 line changed)

**Commits exist:**
- ✅ 97e7dae: feat(260528-dhr): add workspace app installation check and install flow
- ✅ 8f12069: chore(260528-dhr): update default OAuth client ID to production value

**Function signatures verified:**
```bash
$ grep -n "^export" src/workspace.ts | grep -E "checkAppInstalled|installApp|getAppIdForEnvironment|InstalledAppInfo"
768:export interface InstalledAppInfo {
792:export function getAppIdForEnvironment(graphqlEndpoint: string): string {
825:export async function checkAppInstalled(
867:export async function installApp(
```

**Package.json change verified:**
```bash
$ grep -A2 "altium365.clientId" package.json | head -3
        "altium365.clientId": {
          "type": "string",
          "default": "4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D",
```

All success criteria met. Ready for integration testing in future workspace-scoped command handlers.
