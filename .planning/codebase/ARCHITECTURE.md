<!-- refreshed: 2026-05-19 -->
# Architecture

**Analysis Date:** 2026-05-19

## System Overview

```text
┌───────────────────────────────────────────────────────────────────┐
│                     VS Code Extension Host                         │
│                      src/extension.ts                              │
│  Commands: signIn · signOut · selectWorkspace · selectEnvironment  │
│            runScript · debugScript                                  │
└──────┬─────────────────┬──────────────────┬────────────────────────┘
       │                 │                  │
       ▼                 ▼                  ▼
┌────────────┐  ┌────────────────┐  ┌────────────────────────────────┐
│  Auth Layer│  │Workspace Layer │  │     Script Runner Layer        │
│ src/auth.ts│  │src/workspace.ts│  │   python/_runner.py            │
│            │  │                │  │   python/a365.py (helper)      │
└────────────┘  └────────────────┘  └────────────────────────────────┘
       │                 │                  │
       ▼                 ▼                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                      External Services                             │
│  Altium 365 IdP (OAuth2/PKCE)   Altium 365 GraphQL API            │
│  auth.dev1.altium.com / etc     usw2.dev-365.altium.com / etc     │
└───────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Extension entry point | Command registration, lifecycle, UI orchestration, Python subprocess management | `src/extension.ts` |
| Auth layer | OAuth2 PKCE flow, token storage/refresh, workspace token exchange | `src/auth.ts` |
| Workspace layer | GraphQL calls for workspaces and projects, workspace selection state | `src/workspace.ts` |
| Python runner | A365 ScriptingService runtime emulator, loads user script and calls `onExecute` | `python/_runner.py` |
| Python helper | Dependency-free GraphQL helper module available as `import a365` in user scripts | `python/a365.py` |

## Pattern Overview

**Overall:** VS Code Extension — Command/Handler pattern with a thin layered service architecture

**Key Characteristics:**
- All user-visible actions are registered VS Code commands in `src/extension.ts`
- Auth and workspace concerns are factored into separate modules consumed only by `extension.ts`
- The Python subprocess boundary is the integration point between the TypeScript extension host and user scripts
- Environment variables are the only IPC mechanism between the extension host and the Python subprocess
- State is persisted via VS Code APIs: `context.secrets` (tokens) and `context.globalState` (workspace selection, last project id)

## Layers

**Command/UI Layer:**
- Purpose: Handle all user interactions — register commands, show progress/errors, orchestrate multi-step flows
- Location: `src/extension.ts`
- Contains: `activate`, command handlers (`doSignIn`, `doSignOut`, `doSelectWorkspace`, `doSelectEnvironment`, `runScript`, `debugScript`, `prepareRun`, `pickProjectId`)
- Depends on: `src/auth.ts`, `src/workspace.ts`, VS Code API, Node.js `child_process`/`fs`/`path`/`os`
- Used by: VS Code extension host

**Auth Layer:**
- Purpose: All OAuth2 token management — PKCE authorization code flow, token refresh, workspace token exchange, secure storage
- Location: `src/auth.ts`
- Contains: `OAuthConfig` interface, `TokenSet` interface, `signIn`, `exchangeWorkspaceToken`, `refreshTokens`, `getActiveAccessToken`, `clearAllTokens`, `readOAuthConfig`, loopback HTTP server (`awaitCallback`)
- Depends on: VS Code secrets API, Node.js `crypto`/`http`, native `fetch`
- Used by: `src/extension.ts`, `src/workspace.ts`

**Workspace Layer:**
- Purpose: GraphQL API queries for workspace and project enumeration, workspace token exchange orchestration, workspace state
- Location: `src/workspace.ts`
- Contains: `WorkspaceInfo` interface, `ProjectInfo` interface, `graphqlRequest`, `listWorkspaces`, `listProjects`, `pickAndExchangeWorkspace`, `getSelectedWorkspace`
- Depends on: `src/auth.ts`, VS Code API, native `fetch`
- Used by: `src/extension.ts`

**Python Runtime Layer:**
- Purpose: Emulate the Altium 365 ScriptingService runtime locally; receive credentials via env vars and invoke `onExecute` on user scripts
- Location: `python/_runner.py`, `python/a365.py`
- Contains: `Context` class (mimics A365 runtime context), module loader, `a365.query()` helper
- Depends on: Environment variables `ALTIUM365_TOKEN`, `ALTIUM365_GRAPHQL_ENDPOINT`, `ALTIUM365_WORKSPACE_*`; optional `gql` package
- Used by: spawned as subprocess by `src/extension.ts`

## Data Flow

### Run Script (Primary Path)

1. User invokes `altium365.runScript` command (`src/extension.ts:26`)
2. `runScript` calls `prepareRun` (`src/extension.ts:287`)
3. `prepareRun` reads config, calls `getActiveAccessToken` which may refresh tokens via `src/auth.ts:256`
4. If no params file found, `pickProjectId` queries `listProjects` via GraphQL (`src/workspace.ts:111`) and shows QuickPick
5. Params written to a temp JSON file; env vars assembled: `ALTIUM365_TOKEN`, `ALTIUM365_GRAPHQL_ENDPOINT`, `ALTIUM365_WORKSPACE_*`
6. `spawn(python, ['-u', runnerPath, scriptPath, paramsPath], { env })` launches `python/_runner.py` (`src/extension.ts:229`)
7. `_runner.py` builds `Context`, loads user script, calls `onExecute(context, input_parameters)` (`python/_runner.py:152`)
8. stdout/stderr streamed back to VS Code Output Channel (`src/extension.ts:230–231`)

### Sign In Flow

1. User invokes `altium365.signIn` command
2. `doSignIn` calls `readOAuthConfig()` then `signIn(context, cfg)` (`src/auth.ts:134`)
3. PKCE pair generated; loopback HTTP server started on configured port (`src/auth.ts:67`)
4. Browser opened to IdP authorization URL
5. IdP redirects to `http://localhost:{port}{path}` with code
6. Loopback server captures code, validates state, resolves promise
7. Extension POSTs `authorization_code` grant to token endpoint
8. `TokenSet` stored in `context.secrets` under `altium365.tokens`
9. User offered to select workspace immediately

### Workspace Token Exchange Flow

1. `pickAndExchangeWorkspace` lists workspaces via GraphQL using base access token
2. User picks workspace from QuickPick
3. `exchangeWorkspaceToken` performs RFC 8693 token exchange with workspace-scoped `a365:workspace:{authId}` scope
4. Workspace token stored in `context.secrets` under `altium365.workspaceTokens`
5. Selected `WorkspaceInfo` stored in `context.globalState` under `altium365.selectedWorkspace`

**State Management:**
- OAuth tokens → `context.secrets` (encrypted by VS Code)
- Workspace selection → `context.globalState` (persistent across sessions)
- Last used project id per workspace → `context.globalState` keyed `altium365.lastProjectId.{workspaceId}`
- Active environment → VS Code global settings `altium365.activeEnvironment`

## Key Abstractions

**OAuthConfig:**
- Purpose: Typed configuration bundle for OAuth2 endpoints and credentials
- Examples: `src/auth.ts:6–14`
- Pattern: Plain interface, always read fresh from VS Code config via `readOAuthConfig()`

**TokenSet:**
- Purpose: Represents an OAuth2 token response with optional computed `expires_at`
- Examples: `src/auth.ts:16–24`
- Pattern: Plain interface, serialized as JSON in `context.secrets`

**WorkspaceInfo:**
- Purpose: Identity of a selected Altium 365 workspace (name, workspaceId, authId)
- Examples: `src/workspace.ts:13–17`
- Pattern: Plain interface, persisted in `context.globalState`

**Context (Python):**
- Purpose: Mimics the `context` object passed by the A365 ScriptingService; exposes `auth_token` and lazy `gql_client`
- Examples: `python/_runner.py:19–69`
- Pattern: Class instantiated by `_runner.py` from env vars, passed verbatim to `onExecute`

**RunPrep:**
- Purpose: Typed bundle returned by `prepareRun` containing all resolved parameters needed to spawn the Python process
- Examples: `src/extension.ts:276–285`
- Pattern: Internal interface used only within `extension.ts`

## Entry Points

**Extension Activation:**
- Location: `src/extension.ts:16` — `export function activate(context)`
- Triggers: VS Code loads the extension on first command invocation (no `activationEvents` restricts this)
- Responsibilities: Creates output channel, registers all 6 commands

**Python Script Entry:**
- Location: `python/_runner.py:175` — `if __name__ == "__main__": raise SystemExit(main())`
- Triggers: Spawned by `extension.ts:229` via `spawn()`
- Responsibilities: Builds `Context`, loads user script, calls `onExecute`, prints result

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop in extension host. Python scripts run in a separate OS process (no shared memory, no threads between them).
- **IPC:** Extension → Python communication is one-way via environment variables and CLI arguments. Python → Extension is stdout/stderr streaming only.
- **Global state:** One module-level `outputChannel` singleton in `src/extension.ts:14`. All other state goes through `context.secrets`/`context.globalState`.
- **Secrets storage:** All tokens stored exclusively via `context.secrets` (VS Code encrypted store). Never written to disk as plaintext. Temporary params files use `os.tmpdir()` and contain only `projectId`, never tokens.
- **No bundler:** Extension compiles TypeScript directly to `out/` via `tsc`. No webpack/esbuild. `python/` directory is copied as-is into the VSIX.
- **Python dependency:** `python/_runner.py` requires only stdlib. `context.gql_client` (optional) requires `gql[requests]`. `python/a365.py` requires only stdlib.

## Anti-Patterns

### Tokens passed as environment variable

**What happens:** `ALTIUM365_TOKEN` is set in the child process environment at `src/extension.ts:378`
**Why it's wrong here:** Environment variables are visible to all child processes of the subprocess and may appear in crash dumps or `ps` output on some platforms
**Do this instead:** For higher security, pass the token via stdin or a short-lived temp file with restricted permissions, similar to how `paramsPath` already works for parameters

### `extension.ts` contains both UI orchestration and subprocess management

**What happens:** `prepareRun`, `runScript`, `debugScript`, `pickProjectId`, `resolvePythonPath` all live in `src/extension.ts`
**Why it's wrong:** Makes the command handler file large (484 lines) and mixes subprocess spawn logic with VS Code UI concerns
**Do this instead:** Extract script runner logic into `src/runner.ts` so `extension.ts` only registers commands and delegates

## Error Handling

**Strategy:** Async/await with try/catch at the command-handler boundary; errors surfaced via `vscode.window.showErrorMessage`

**Patterns:**
- Auth errors caught in `doSignIn`/`doSelectWorkspace` and shown as error messages
- Python subprocess errors logged to output channel (not shown as VS Code notifications)
- GraphQL errors thrown as `Error` objects and bubbled up to command handlers
- Token refresh failures silently fall through — user is prompted to re-sign-in

## Cross-Cutting Concerns

**Logging:** VS Code Output Channel `'Altium 365'` (created in `activate`). All Python stdout/stderr forwarded here. Prefix `[Altium 365]` used consistently.
**Validation:** Configuration validated eagerly at command invocation time (check for empty `clientId`, `authEndpoint`, `graphqlEndpoint` before proceeding).
**Authentication:** Resolved lazily per-command via `getActiveAccessToken` which handles workspace token preference, expiry check, and refresh automatically.

---

*Architecture analysis: 2026-05-19*
