# Codebase Structure

**Analysis Date:** 2026-05-19

## Directory Layout

```
a365-vscode-extension/
├── src/                    # TypeScript extension source (compiled to out/)
│   ├── extension.ts        # Extension entry point, all command handlers
│   ├── auth.ts             # OAuth2 PKCE auth, token storage/refresh
│   └── workspace.ts        # GraphQL workspace/project queries, workspace state
├── python/                 # Python runtime bundled inside the VSIX
│   ├── _runner.py          # A365 ScriptingService emulator (subprocess entry point)
│   └── a365.py             # Helper module injected onto PYTHONPATH for user scripts
├── out/                    # Compiled JavaScript output (generated, not committed)
├── .planning/              # GSD planning artifacts
│   └── codebase/           # Codebase intelligence documents (this directory)
├── .vscode/                # VS Code workspace settings
├── package.json            # Extension manifest, contributes, scripts, devDependencies
├── tsconfig.json           # TypeScript compiler configuration
└── node_modules/           # npm dependencies (not committed)
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source files for the VS Code extension host
- Contains: 3 files — `extension.ts` (command handlers + subprocess management), `auth.ts` (OAuth2), `workspace.ts` (GraphQL + workspace state)
- Key files: `src/extension.ts`, `src/auth.ts`, `src/workspace.ts`

**`python/`:**
- Purpose: Python runtime support files bundled with the extension; placed on `PYTHONPATH` when running scripts
- Contains: `_runner.py` (subprocess entry point that emulates A365 ScriptingService), `a365.py` (importable stdlib-only GraphQL helper for user scripts)
- Key files: `python/_runner.py`, `python/a365.py`
- Note: Accessed at runtime via `context.asAbsolutePath('python')` in `src/extension.ts:332`

**`out/`:**
- Purpose: TypeScript compiler output; referenced as `"main": "./out/extension.js"` in `package.json`
- Generated: Yes
- Committed: No (should be in `.gitignore`)

## Key File Locations

**Entry Points:**
- `src/extension.ts`: VS Code extension entry point — `activate()` and `deactivate()` exports
- `python/_runner.py`: Python subprocess entry point — invoked by the extension via `spawn()`

**Configuration:**
- `package.json`: Extension manifest with all contributed commands, settings schema, menus, and engine requirements
- `tsconfig.json`: TypeScript compiler settings

**Core Logic:**
- `src/extension.ts`: Command handlers, `prepareRun`, `pickProjectId`, `resolvePythonPath`, `runScript`, `debugScript`
- `src/auth.ts`: `signIn`, `exchangeWorkspaceToken`, `refreshTokens`, `getActiveAccessToken`, `readOAuthConfig`
- `src/workspace.ts`: `graphqlRequest`, `listWorkspaces`, `listProjects`, `pickAndExchangeWorkspace`, `getSelectedWorkspace`

**Python Helpers:**
- `python/_runner.py`: `Context` class, `_load_module`, `_load_input_parameters`, `main`
- `python/a365.py`: `query()` function, `Altium365Error` exception class

**Testing:**
- Not present — no test files or test framework configured

## Naming Conventions

**Files:**
- TypeScript source files: `camelCase.ts` (e.g., `extension.ts`, `auth.ts`, `workspace.ts`)
- Python files with leading underscore are internal/private: `_runner.py` (not intended to be imported directly by users)
- Python files without underscore are public helpers: `a365.py` (intended for `import a365` in user scripts)

**TypeScript Functions:**
- Async command handlers exposed as VS Code commands: `doSignIn`, `doSignOut`, `doSelectWorkspace`, `doSelectEnvironment` — prefix `do` for internal handlers
- Public module exports: camelCase — `signIn`, `readOAuthConfig`, `getActiveAccessToken`, `listWorkspaces`
- Private module helpers: camelCase — `pkcePair`, `postForm`, `withExpiry`, `awaitCallback`, `isExpired`

**TypeScript Interfaces:**
- PascalCase: `OAuthConfig`, `TokenSet`, `WorkspaceInfo`, `ProjectInfo`, `RunPrep`, `EnvironmentSpec`

**VS Code Configuration Keys:**
- Namespaced with `altium365.` prefix (e.g., `altium365.graphqlEndpoint`, `altium365.clientId`)
- Secret storage keys: `altium365.tokens`, `altium365.workspaceTokens`
- Global state keys: `altium365.selectedWorkspace`, `altium365.lastProjectId.{workspaceId}`, `altium365.activeEnvironment`

**VS Code Commands:**
- Format: `altium365.{camelCaseAction}` (e.g., `altium365.runScript`, `altium365.signIn`)

**Environment Variables (Python IPC):**
- All uppercase with `ALTIUM365_` prefix: `ALTIUM365_TOKEN`, `ALTIUM365_GRAPHQL_ENDPOINT`, `ALTIUM365_WORKSPACE_ID`, `ALTIUM365_WORKSPACE_AUTH_ID`, `ALTIUM365_WORKSPACE_NAME`

## Where to Add New Code

**New VS Code Command:**
1. Register in `package.json` under `contributes.commands` (and optionally `contributes.menus`)
2. Add handler function in `src/extension.ts`
3. Register with `context.subscriptions.push(vscode.commands.registerCommand(...))` in `activate()`

**New Auth Feature (e.g., new grant type):**
- Implementation: `src/auth.ts` — add new exported function following existing pattern (async, takes `context` + `cfg` params)
- Call from: `src/extension.ts` or `src/workspace.ts`

**New GraphQL Query:**
- Implementation: `src/workspace.ts` — add new exported async function using `graphqlRequest()`
- Add corresponding interface for response shape in the same file

**New Python Helper for Scripts:**
- Add to `python/a365.py` and export via `__all__` — this file is already on `PYTHONPATH` when `injectHelper` is true
- If a new separate module is needed, add a new `.py` file in `python/`; it will be automatically available since the whole `python/` directory is on `PYTHONPATH`

**New Configuration Setting:**
- Add to `package.json` under `contributes.configuration.properties` with `altium365.` prefix
- Read in `src/extension.ts` or `src/auth.ts` via `vscode.workspace.getConfiguration('altium365').get<T>('key')`

**New Environment:**
- Add entry to `altium365.environments` object in `package.json` defaults — no code change required

## Special Directories

**`out/`:**
- Purpose: TypeScript compiler output (`tsc -p ./`)
- Generated: Yes — produced by `npm run compile` or `npm run watch`
- Committed: No

**`python/`:**
- Purpose: Bundled Python runtime support; paths resolved at runtime via `context.asAbsolutePath('python')`
- Generated: No — manually authored
- Committed: Yes

**`.planning/`:**
- Purpose: GSD workflow planning artifacts (roadmap, phases, codebase intelligence)
- Generated: By GSD tooling
- Committed: Yes

---

*Structure analysis: 2026-05-19*
