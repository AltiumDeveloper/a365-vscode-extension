---
type: quick
created: 2026-05-28
description: Integrate app installation check into workspace operations - prompt user and install when app not detected
files_modified:
  - src/sidePanel.ts
  - src/extension.ts
---

# Quick Task: Integrate App Installation Check

## Context

Tasks 260528-dhr and 260528-dp1 added `checkAppInstalled` and `installApp` infrastructure, but it's not wired into actual workspace operations. Currently when the extension app isn't installed, the first GraphQL query fails with cryptic errors and users have no path to recovery.

**Integration point:** `loadWorkspaceChildren()` in `sidePanel.ts` - this is where workspace-scoped queries start (`listProjects`, `listScripts`, `listExtensionPoints`).

## Tasks

### Task 1: Add app installation gate to loadWorkspaceChildren

**Files:** `src/sidePanel.ts`

**Action:**

After obtaining `wsToken` and `endpoint` in `loadWorkspaceChildren`, add app installation check before the `Promise.all` GraphQL queries:

1. Get active environment's appId from VS Code configuration:
   ```typescript
   const cfg = vscode.workspace.getConfiguration('altium365');
   const activeEnvName = cfg.get<string>('activeEnvironment') || '';
   const envs = cfg.get<Record<string, any>>('environments') || {};
   const appId = envs[activeEnvName]?.appId;
   ```

2. If `appId` is missing or empty string, skip the check (fallback for legacy configs without appId).

3. Call `checkAppInstalled(endpoint, wsToken, appId)`. Import from `./workspace`.

4. If app not installed, show user prompt:
   ```
   "The Altium Developer extension needs to be installed in this workspace. Install now? (Requires workspace admin permissions)"
   ```
   with buttons: `["Install Now", "Cancel"]`

5. On "Install Now":
   - Call `await installApp(endpoint, wsToken, appId)`
   - Catch errors and surface friendly message:
     - If error message contains "workspace administrator" → show as-is (comes from installApp's admin escalation logic)
     - Otherwise → `"Failed to install extension app: " + err.message`
   - On success → show info toast: `"Extension app installed successfully"`

6. On "Cancel" or installation failure → throw error to surface as tree error node so user sees actionable retry

7. After successful check or install, proceed with existing `Promise.all([listProjects, ...])` logic

**Verify:**

1. Create new A365 workspace without extension app installed
2. Expand workspace in tree → should show installation prompt
3. Click "Install Now" (with admin account) → should install and populate tree
4. Reload window and expand workspace again → should skip prompt and load directly
5. Try with non-admin account → should show escalation message

**Done:** Workspace expansion automatically checks app installation, prompts user, installs if needed, and handles non-admin gracefully. No more cryptic AUTH_NOT_AUTHENTICATED errors.

### Task 2: Cache installation status per workspace

**Files:** `src/sidePanel.ts`

**Action:**

Add in-memory cache to avoid repeated installation checks:

1. Add class field: `private installedAppCache = new Map<string, boolean>();`

2. In `loadWorkspaceChildren`, check cache before calling `checkAppInstalled`:
   ```typescript
   const cacheKey = `${workspaceId}:${appId}`;
   const cached = this.installedAppCache.get(cacheKey);
   if (cached === true) {
     // Skip check - already confirmed installed
   } else {
     const installed = await checkAppInstalled(...);
     if (installed) {
       this.installedAppCache.set(cacheKey, true);
     } else {
       // Prompt and install flow...
       // On successful install:
       this.installedAppCache.set(cacheKey, true);
     }
   }
   ```

3. Clear cache in `refresh()` when node is undefined (full tree refresh):
   ```typescript
   if (!node) {
     this.installedAppCache.clear();
     // ... existing cache clears
   }
   ```

**Verify:**

1. Expand workspace (triggers install check)
2. Collapse and re-expand workspace → should not prompt again (cached)
3. Run "Altium 365: Refresh" command → expand workspace → should re-check (cache cleared)

**Done:** Installation status cached per workspace. Repeated tree expansions don't spam GraphQL checks. Refresh command clears cache for re-verification.

### Task 3: Add globalState persistence for install status

**Files:** `src/sidePanel.ts`

**Action:**

Persist installation status across VS Code sessions to avoid re-checking on every window reload:

1. On successful `checkAppInstalled` or `installApp`, also write to globalState:
   ```typescript
   const stateKey = `altium365.installedApps`;
   const installed = this.ctx.globalState.get<Record<string, boolean>>(stateKey) || {};
   installed[cacheKey] = true;
   await this.ctx.globalState.update(stateKey, installed);
   ```

2. At start of `loadWorkspaceChildren`, check globalState before in-memory cache:
   ```typescript
   const stateKey = `altium365.installedApps`;
   const installed = this.ctx.globalState.get<Record<string, boolean>>(stateKey) || {};
   if (installed[cacheKey] === true) {
     // Skip check - persisted from previous session
     this.installedAppCache.set(cacheKey, true);
     // continue to Promise.all
   }
   ```

3. In `refresh()` when full refresh, clear globalState along with memory cache:
   ```typescript
   if (!node) {
     await this.ctx.globalState.update('altium365.installedApps', {});
     this.installedAppCache.clear();
     // ...
   }
   ```

**Verify:**

1. Install app via prompt
2. Reload VS Code window → expand workspace → should skip check (persisted state)
3. Manually uninstall app via A365 web UI
4. Run "Altium 365: Refresh" → expand workspace → should detect missing app and prompt again

**Done:** Installation status persists across VS Code sessions. Users only see installation prompt once per workspace (unless manually refreshed or app uninstalled).

## Success Criteria

- [ ] Workspace expansion checks app installation before GraphQL queries
- [ ] User prompted with clear message when app not installed
- [ ] Installation succeeds for admin users, shows escalation message for non-admins
- [ ] Installation status cached in-memory to avoid repeated checks
- [ ] Installation status persisted in globalState across sessions
- [ ] Full refresh clears both caches to allow re-verification
- [ ] No more cryptic AUTH_NOT_AUTHENTICATED errors - users have clear path to resolution
