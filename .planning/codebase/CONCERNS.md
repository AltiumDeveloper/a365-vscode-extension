# Codebase Concerns

**Analysis Date:** 2026-05-19

---

## Security Considerations

### Bearer Token Passed via Process Environment Variable

- **Risk:** The OAuth access token is written as a plain environment variable (`ALTIUM365_TOKEN`) and passed to the Python subprocess. Any process on the machine that can read the subprocess's environment (e.g., other VS Code extensions, diagnostic tools, `ps auxe`) can extract the live bearer token.
- **Files:** `src/extension.ts:379` (`env.ALTIUM365_TOKEN = token`)
- **Current mitigation:** Token is short-lived and scoped to the workspace. VS Code SecretStorage protects the stored copy.
- **Recommendations:** Prefer piping the token via stdin or a short-lived named pipe rather than an env var. At minimum, document the trade-off clearly. Consider injecting the token only to `_runner.py` stdin so it never persists in process env beyond the runner itself.

### XSS in OAuth Loopback Error Page

- **Risk:** The `error` query parameter from the OAuth redirect is interpolated directly into HTML without escaping — `res.end('<html><body><h3>Authentication failed: ${error}</h3></body></html>')`. A crafted redirect URL (e.g., `?error=<img src=x onerror=...>`) would execute in the browser tab the IdP redirects to. While the loopback server is on `127.0.0.1` and short-lived, an attacker who can influence the redirect (e.g., via an open-redirector on the IdP) could exploit this.
- **Files:** `src/auth.ts:87`
- **Current mitigation:** None.
- **Recommendations:** HTML-escape all user-supplied values before interpolating into HTML responses. Apply to `error` and `error_description` parameters.

### Hardcoded Dev Client ID and Endpoints as Package Defaults

- **Risk:** `package.json` ships with `altium365.clientId` defaulting to `20C490ED-58EF-11EF-9194-02A5C34CA889` and all auth/GraphQL endpoints defaulting to `dev1`/`dev-365` environments. Users who install the extension without configuring settings will silently authenticate against the dev environment and use a dev OAuth client.
- **Files:** `package.json:57-68`
- **Current mitigation:** Extension is currently `publisher: "local"` and not published to the marketplace.
- **Recommendations:** Before marketplace publication, change defaults to production endpoints, or leave defaults empty and require explicit configuration. Consider stripping the hardcoded client ID or making it environment-specific.

### Temporary Params File Never Deleted

- **Risk:** When the user selects a project from the picker, the extension writes a temp JSON file to `os.tmpdir()` containing the `projectId`. This file is never cleaned up after the script run finishes.
- **Files:** `src/extension.ts:362-374`
- **Current mitigation:** Low severity — only contains a `projectId`, not a token. File is in the OS temp directory.
- **Recommendations:** Register a cleanup callback on `proc.on('close', ...)` to `fs.unlink` the temp file. Or use a short-lived temp directory deleted on close.

### No Validation of OAuth `error_description` Before Display

- **Risk:** The OAuth callback handler discards `error_description` from the IdP — only `error` is shown. The `error` code is unescaped in HTML (see XSS concern above). Additionally, `error` codes are defined by RFC 6749 and should be safe strings, but this is never validated.
- **Files:** `src/auth.ts:84-91`
- **Recommendations:** Validate that `error` matches RFC 6749 error code patterns (alphanumeric + underscore) before interpolating into HTML.

---

## Tech Debt

### `publisher: "local"` Blocks Marketplace Publishing

- **Issue:** `package.json` has `"publisher": "local"` — this is a placeholder that will cause `vsce publish` to fail. The extension has no icon, no marketplace keywords, minimal categories (`["Other"]`), and no `repository` field.
- **Files:** `package.json:6,11`
- **Impact:** Extension cannot be published to VS Code Marketplace without manual remediation of multiple fields.
- **Fix approach:** Set a real publisher ID, add `icon`, `keywords`, `repository`, `license`, and `homepage` fields. Change category to something meaningful (e.g., `["Other", "Programming Languages"]`).

### `vsce` Not in devDependencies — No Packaging Script

- **Issue:** There is no `@vscode/vsce` (or `vsce`) in `devDependencies` and no `package` or `package:vsix` npm script. The `scripts` block only has `compile` and `watch`. There is no documented or automated way to produce a `.vsix` artifact.
- **Files:** `package.json:186-189`
- **Impact:** Cannot reliably package the extension for distribution without manual toolchain setup.
- **Fix approach:** Add `@vscode/vsce` to devDependencies, add `"package": "vsce package"` to scripts.

### No Tests — Zero Coverage

- **Issue:** There are no test files anywhere in the repository. `devDependencies` has no test framework (no Jest, Mocha, `@vscode/test-electron`, Vitest, etc.). There is no `test` script in `package.json`.
- **Files:** Entire `src/` directory — `src/auth.ts`, `src/extension.ts`, `src/workspace.ts`
- **Impact:** All OAuth flow logic, token management, and error handling paths are untested. Regressions will only surface at runtime.
- **Fix approach:** Add `@vscode/test-cli` + `@vscode/test-electron` for integration tests. Add unit tests for `auth.ts` functions (`pkcePair`, `withExpiry`, `isExpired`, `readOAuthConfig`) using Jest or Vitest with mocked VSCode API.

### Pervasive `any` Types Undermine TypeScript Strictness

- **Issue:** Despite `"strict": true` in `tsconfig.json`, several key functions are typed as `any`: `graphqlRequest` returns `Promise<any>`, `postForm` returns `Promise<any>`, and `resolvePythonPath` uses `api: any` for the Python extension API.
- **Files:** `src/workspace.ts:24`, `src/auth.ts:39`, `src/extension.ts:196`
- **Impact:** No type safety on GraphQL response payloads — accessing `data?.desWorkspaceInfos` and `data?.desProjects?.nodes` with no type checking. Runtime shape errors will be silently swallowed.
- **Fix approach:** Define typed response interfaces for each GraphQL query. Type the Python extension API interactions with explicit interfaces or use `unknown` + type guards.

### `deactivate()` Is Empty — No Cleanup on Extension Deactivation

- **Issue:** `export function deactivate() {}` does nothing. There is no cleanup of the `outputChannel` or any other resource.
- **Files:** `src/extension.ts:38`
- **Impact:** Minor — `outputChannel` is in `context.subscriptions` so it will be disposed automatically. However, any mid-flight OAuth loopback server or pending `spawn` processes are not tracked or terminated.
- **Fix approach:** Track any running `ChildProcess` handles and terminate them in `deactivate`. Consider storing the `awaitCallback` promise cancel handle.

### Version `0.0.2` With No Changelog

- **Issue:** The extension is at version `0.0.2` with no `CHANGELOG.md`, no changelog section in README, and no release notes. This complicates upgrade tracking.
- **Files:** `package.json:5`
- **Fix approach:** Create `CHANGELOG.md` and document changes per semver. Follow VS Code extension conventions.

---

## Fragile Areas

### Fixed OAuth Redirect Port — No Conflict Recovery

- **Files:** `src/auth.ts:126-130`, `package.json:83` (default port 8080)
- **Why fragile:** If port 8080 is already in use (by another application, another VS Code window running sign-in, or a dev server), the `server.listen` call emits an `EADDRINUSE` error and sign-in fails entirely with a cryptic error message. There is no retry on an alternative port.
- **Safe modification:** Add a port-probing loop: attempt to listen on the configured port, and on `EADDRINUSE`, increment and retry up to N times. Display the actual port used to the user.
- **Test coverage:** No tests for port conflict scenarios.

### Expired Workspace Token Falls Through Silently to Base Token

- **Files:** `src/auth.ts:260-263` (`getActiveAccessToken`)
- **Why fragile:** If the workspace token is expired, `getActiveAccessToken` silently falls through to the base token without attempting a re-exchange. Scripts will then run with the base token (no workspace scope), potentially receiving 403 errors from workspace-scoped endpoints. The user gets no indication that the workspace token was silently downgraded.
- **Safe modification:** On expired workspace token, either surface a warning and prompt for re-exchange, or attempt automatic re-exchange using `exchangeWorkspaceToken`.
- **Test coverage:** None.

### `getStoredTokens` / `getStoredWorkspaceTokens` — Unguarded `JSON.parse`

- **Files:** `src/auth.ts:232-234`, `src/auth.ts:239-241`
- **Why fragile:** Both functions call `JSON.parse(raw)` without a try/catch. If SecretStorage contains malformed JSON (e.g., truncated write, manual edit, storage corruption), these will throw an unhandled exception that propagates up to callers without context.
- **Safe modification:** Wrap in try/catch, log the parse failure to the output channel, and return `undefined` as if no tokens are stored. Optionally, auto-clear the corrupted entry.
- **Test coverage:** None.

### `listWorkspaces` Uses Potentially Expired Base Token

- **Files:** `src/workspace.ts:74` (`pickAndExchangeWorkspace`)
- **Why fragile:** `base.access_token` is used directly from storage without expiry check. If the token is expired and no refresh token is available, the GraphQL call returns a 401 error that surfaces as a generic "Failed to list workspaces" message without prompting the user to sign in again.
- **Safe modification:** Replace `base.access_token` with `await getActiveAccessToken(context, cfg)` which handles expiry and refresh automatically.
- **Test coverage:** None.

### Python Extension API Access via `any` and Optional Chaining Chain

- **Files:** `src/extension.ts:196-205`
- **Why fragile:** The ms-python extension API is accessed via two different API shapes (`api?.environments?.getActiveEnvironmentPath` and `api?.settings?.getExecutionDetails`) to support multiple Python extension versions. There is no version check and no documented minimum version. If the Python extension changes its API again (which it has historically done), both paths may silently return `undefined`, falling back to the system `python`/`python3` binary.
- **Safe modification:** Document the minimum supported ms-python extension version. Add a single code path for the current stable API shape and warn/log when the API shape is unrecognized.

---

## Performance Bottlenecks

### No Pagination for `listProjects`

- **Problem:** `listProjects` in `workspace.ts` fetches all projects in a single unbounded GraphQL query (`desProjects { nodes { id name } }`). Workspaces with hundreds or thousands of projects will return all of them in one request.
- **Files:** `src/workspace.ts:115-121`
- **Cause:** No `first`/`after` pagination arguments in the query.
- **Improvement path:** Add pagination using GraphQL cursor-based pagination. For the QuickPick UX, consider loading the first N projects immediately and offering a "load more" option or supporting incremental search.

### No Timeout on Python Subprocess

- **Problem:** The spawned Python process (`spawn` in `runScript`) has no timeout. A hung or infinite-loop script will run indefinitely and never be surfaced to the user beyond the output channel.
- **Files:** `src/extension.ts:229`
- **Cause:** `spawn` options do not include a timeout. There is no `AbortController` or kill timer.
- **Improvement path:** Add a configurable timeout setting (`altium365.scriptTimeoutSeconds`). Use `proc.kill()` after the timeout and report the timeout in the output channel.

---

## Missing Critical Features

### No `clientId` / `redirectPort` / `redirectPath` in Environment Spec

- **Problem:** The `EnvironmentSpec` interface and `altium365.environments` configuration schema only support `graphqlEndpoint`, `authEndpoint`, `tokenEndpoint`, `scopes`, and `audience`. When switching environments, `clientId`, `redirectPort`, and `redirectPath` are NOT updated. If different environments require different OAuth client IDs or redirect URIs, the token exchange will fail.
- **Files:** `src/extension.ts:96-102`, `package.json:146-155`
- **Blocks:** Multi-environment support for environments with different OAuth clients (e.g., Prod uses a different client ID than Dev).
- **Fix:** Add `clientId`, `redirectPort`, `redirectPath` to `EnvironmentSpec` and to the `doSelectEnvironment` update logic.

### No Sign-In State Indicator

- **Problem:** There is no status bar item, tree view, or welcome view showing whether the user is signed in or which workspace is selected. The only feedback is transient notifications and the output channel. After restarting VS Code, users have no way to verify their auth state without attempting to run a script.
- **Files:** `src/extension.ts` (entire activation block — no status bar registration)
- **Blocks:** Basic usability for daily use.
- **Fix:** Add a status bar item showing sign-in state and selected workspace name. Update it after sign-in, sign-out, and workspace selection.

### No Refresh of Workspace Token Before Script Run

- **Problem:** Workspace tokens received from `exchangeWorkspaceToken` have `expires_in` set, and `withExpiry` correctly computes `expires_at`. However, `getActiveAccessToken` does not attempt to re-exchange an expired workspace token — it silently falls back to the base token.
- **Files:** `src/auth.ts:260-263`
- **Blocks:** Long VS Code sessions where the workspace token expires mid-session will silently degrade to using the base token.

### No `inputParametersPath` Glob or Multi-Script Support

- **Problem:** `altium365.inputParametersPath` is a single string setting (absolute path). There is no glob pattern support and no per-script override. Users who work with multiple scripts and different params files must manually change this setting between runs.
- **Files:** `src/extension.ts:337-346`, `package.json:95-99`
- **Blocks:** Productive multi-script workflows.

---

## Test Coverage Gaps

### Auth Module — All Critical Paths Untested

- **What's not tested:** `pkcePair` randomness and format; `withExpiry` edge cases (`expires_in` = 0, already has `expires_at`); `isExpired` boundary (exactly at expiry); `getActiveAccessToken` fallback chain; `refreshTokens` token-preservation logic; `readOAuthConfig` when settings are missing.
- **Files:** `src/auth.ts` (entire file)
- **Risk:** OAuth flow regressions, token expiry bugs, and configuration fallback failures go undetected until reported by users.
- **Priority:** High

### Workspace Module — GraphQL Error Paths Untested

- **What's not tested:** `graphqlRequest` with HTTP errors, non-JSON responses, and GraphQL error payloads; `listWorkspaces` and `listProjects` with empty and malformed data; `pickAndExchangeWorkspace` with expired base token.
- **Files:** `src/workspace.ts` (entire file)
- **Risk:** Silent failures and confusing error messages for users when the GraphQL API returns unexpected responses.
- **Priority:** High

### Python Runner — Error Handling Paths Untested

- **What's not tested:** `_load_module` failure with syntax errors; `onExecute` returning non-serializable objects; `_load_input_parameters` with invalid JSON; script not defining `onExecute`.
- **Files:** `python/_runner.py`
- **Risk:** Unhelpful error messages when user scripts have import errors or unexpected return values.
- **Priority:** Medium

---

## Dependencies at Risk

### No Runtime Dependencies — Fragile Python Extension API Coupling

- **Risk:** The extension has zero npm runtime dependencies (only devDependencies). All Python resolution logic is tightly coupled to the internal `ms-python.python` extension API (`api.environments.getActiveEnvironmentPath`, `api.settings.getExecutionDetails`). These are private/undocumented APIs that have broken between major Python extension releases.
- **Impact:** Python path resolution silently falls back to system `python`/`python3` when the API shape changes, causing scripts to run with an unexpected interpreter.
- **Migration plan:** Use the documented `ms-python.python` extension API (the published `PythonExtension` type from `@vscode/python-extension` npm package) once available, or rely solely on the `altium365.pythonPath` setting and user-configured Python extension's `pythonPath` workspace setting.

### `gql` Package — Optional Runtime Dep With No Version Pin

- **Risk:** `python/_runner.py` lazily imports `gql` and `gql.transport.requests` via `context.gql_client`. This is an optional runtime dependency with no version requirement specified anywhere (no `requirements.txt`, no `pyproject.toml`).
- **Impact:** Users who install `gql` at an incompatible version (e.g., gql 2.x vs 3.x which had a breaking API change) will get a confusing `ImportError` or `AttributeError` at runtime.
- **Migration plan:** Add a `requirements.txt` (or at minimum a comment in `_runner.py`) specifying `gql[requests]>=3.4`. Consider bundling a minimal HTTP transport in `a365.py` as an alternative to avoid the optional dependency entirely.

---

*Concerns audit: 2026-05-19*
