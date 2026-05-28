---
type: quick
created: 2026-05-28
status: pending
files_modified: [src/workspace.ts, package.json]
---

# Quick Plan: Add Workspace App Installation Check and Install Flow

## Objective

Add workspace app installation check via `gloAppInstalledApps` query and install flow via `gloInstallApp` mutation with explicit user consent. Update default OAuth client ID to 4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D.

**Purpose:** Prevent AUTH_NOT_AUTHENTICATED errors by checking if the extension app is installed in the workspace before making protected API calls, and providing users an installation path when not installed.

**Output:** Working app installation check + consent-gated install flow + updated client ID

## Context

Extension makes GraphQL calls that fail with AUTH_NOT_AUTHENTICATED when the app isn't installed in a workspace. Only workspace admins can install apps — non-admins must be shown a clear error with admin escalation instructions.

App GRIDs by environment:
- **Dev:** `grid:global::platform:app/696d58cb-3803-4c8a-9711-c9bad5e8ba81`
- **UAT:** `grid:global::platform:app/4b70ae94-c06d-44a1-967f-76b26cd2c81a`
- **Prod:** `grid:global::platform:app/71277081-7c79-4309-af3c-f3fd36b68c69`

Project conventions (from AGENTS.md):
- GraphQL requests via `graphqlRequest(endpoint, token, query, variables)` in `src/workspace.ts`
- Async/await throughout; errors surfaced via `vscode.window.showErrorMessage` at command boundary
- All VS Code commands prefixed `altium365.`

## Tasks

<task type="auto">
  <name>Task 1: Add app installation check and install flow</name>
  <files>src/workspace.ts</files>
  <action>
Add three new exports to src/workspace.ts:

1. **checkAppInstalled(endpoint, workspaceToken)** — Query `gloAppInstalledApps { id name }`, return boolean true if any app has `id` matching one of the three app GRIDs (Dev/UAT/Prod). Return false if no match. Use `graphqlRequest` helper following existing patterns.

2. **installApp(endpoint, workspaceToken, appId)** — Mutation `gloInstallApp(input: { id: "..." }) { gloApp { id } }` with the provided appId. Return the installed app id. Use `graphqlRequest` helper following existing patterns. On GraphQL error with code suggesting permissions issue (AUTH_FORBIDDEN, PERMISSION_DENIED, or similar), throw a typed error with message "Only workspace administrators can install apps. Contact your workspace admin to install the Altium Developer extension app."

3. **getAppIdForEnvironment(graphqlEndpoint)** — Helper that inspects the graphqlEndpoint string and returns the correct app GRID:
   - If endpoint contains "dev" or "dev1" or "dev-365" → return Dev GRID
   - If endpoint contains "uat" → return UAT GRID
   - Otherwise (prod or unknown) → return Prod GRID
   - Use string.toLowerCase().includes() for case-insensitive matching

Add TypeScript interface for app info returned by gloAppInstalledApps:
```typescript
export interface InstalledAppInfo {
    id: string;
    name: string;
}
```

Add JSDoc comments describing when each function should be called. checkAppInstalled should be called before making workspace-scoped GraphQL calls that require app installation. installApp should ONLY be called after explicit user consent via a UI prompt (vscode.window.showInformationMessage with action buttons).

Follow existing code style: async/await, typed interfaces, proper error propagation via throw (not console.error), reuse graphqlRequest helper pattern from existing executeScript/getScript/listScripts functions.
  </action>
  <verify>
TypeScript compilation passes (`npm run compile`). Verify the three new exports exist in src/workspace.ts with correct signatures. Verify GraphQL query/mutation strings match the required schema (gloAppInstalledApps and gloInstallApp). Verify getAppIdForEnvironment returns correct GRID for each environment keyword.
  </verify>
  <done>
checkAppInstalled, installApp, and getAppIdForEnvironment functions exist in src/workspace.ts. JSDoc comments describe usage. TypeScript types are correct. No compilation errors.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update default OAuth client ID</name>
  <files>package.json</files>
  <action>
Update the default value for `altium365.clientId` in package.json configuration schema from current value `20C490ED-58EF-11EF-9194-02A5C34CA889` to `4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D`.

This is the production-ready OAuth client ID registered for the Altium Developer extension. Locate the contributes.configuration section, find the altium365.clientId property (line ~183-186), and change only the `"default"` field value.

Do not modify the type, description, or any other configuration properties.
  </action>
  <verify>
Verify package.json has `"default": "4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D"` under altium365.clientId. JSON is valid (`npm run compile` passes). Extension activates without errors when installed (no runtime schema validation errors).
  </verify>
  <done>
package.json altium365.clientId default value is 4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D. Extension compiles and activates successfully.
  </done>
</task>

## Verification

Manual verification:
1. Open VS Code with extension loaded
2. Call `checkAppInstalled` with a workspace token via a test command or Debug Console
3. Verify it returns boolean based on actual installed apps in the workspace
4. Verify `getAppIdForEnvironment` returns correct GRID for each environment endpoint
5. Verify new OAuth client ID is used on next sign-in (check authEndpoint request in network logs or OutputChannel)

Automated verification:
- `npm run compile` passes without errors
- All TypeScript types are correctly inferred (no `any` types in new code)
- New functions follow existing codebase patterns from workspace.ts

## Success Criteria

- checkAppInstalled function queries `gloAppInstalledApps` and returns boolean
- installApp function calls `gloInstallApp` mutation with user-provided appId
- installApp throws actionable error for non-admin users (permission denied scenario)
- getAppIdForEnvironment returns correct app GRID for Dev/UAT/Prod based on endpoint URL
- Default OAuth clientId in package.json is 4BA91DBF-BF57-4B0C-8D67-5E76CEC51A9D
- TypeScript compilation succeeds
- Code follows project conventions (graphqlRequest helper, typed interfaces, JSDoc comments)

## Notes

**Not in scope for this quick task:**
- UI integration for installation prompts (caller responsibility)
- Command registration for install workflow
- Environment-specific app GRID configuration (hardcoded is acceptable per requirements)
- Retry logic or caching for installation checks

**Caller integration pattern** (for future work):
```typescript
const installed = await checkAppInstalled(endpoint, token);
if (!installed) {
    const choice = await vscode.window.showInformationMessage(
        'The Altium Developer extension is not installed in this workspace.',
        'Install Now',
        'Cancel'
    );
    if (choice === 'Install Now') {
        const appId = getAppIdForEnvironment(endpoint);
        await installApp(endpoint, token, appId);
        vscode.window.showInformationMessage('Extension app installed successfully.');
    }
}
```

**Admin-only installation:** installApp must surface clear error when called by non-admin. Extension should NOT attempt automatic installation without user consent via UI prompt (security/UX best practice).
