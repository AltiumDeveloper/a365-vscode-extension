# Technology Stack

**Analysis Date:** 2026-05-19

## Languages

**Primary:**
- TypeScript 5.4+ — VS Code extension host (`src/`)
- Python 3 (any version on PATH or configured) — user script runtime (`python/`)

**Secondary:**
- JavaScript (CommonJS) — compiled output in `out/` (generated, not authored)

## Runtime

**Environment:**
- Node.js ≥18 (extension host, declared in `package.json` `engines.node`)
- VS Code ≥1.85.0 (extension API surface)
- Python 3 (subprocess; resolved via ms-python extension API or `python3`/`python` on PATH)

**Package Manager:**
- npm (lockfile `package-lock.json` present)

## Frameworks

**Core:**
- VS Code Extension API (`@types/vscode ^1.85.0`) — extension activation, commands, UI (QuickPick, InputBox, OutputChannel, progress notifications, debug API), SecretStorage, GlobalState, configuration

**Build/Dev:**
- TypeScript compiler (`tsc`) — sole build tool, configured in `tsconfig.json`
  - `module: commonjs`, `target: ES2020`, `strict: true`, `outDir: out`
- No bundler (webpack/esbuild) — plain tsc output

**Python runtime (bundled, no pip required):**
- `python/a365.py` — stdlib-only GraphQL helper (`urllib`, `json`, `ssl`); zero dependencies
- `python/_runner.py` — script bootstrapper; optional lazy dependency on `gql[requests]` for `context.gql_client`

## Key Dependencies

**Critical:**
- `@types/vscode ^1.85.0` — type definitions for the VS Code API (devDependency; actual API provided by the host)
- `@types/node ^20.0.0` — Node.js built-in types (`crypto`, `http`, `fs`, `os`, `child_process`, `path`)
- `typescript ^5.4.0` — compiler

**No runtime npm dependencies** — `dependencies` block is absent from `package.json`. All extension code uses Node.js built-ins and the VS Code host API only.

**Optional Python dependency (user-installed):**
- `gql[requests]` — only needed if a user script uses `context.gql_client`; not required for `a365.query()`

## Configuration

**Extension settings (contributes.configuration in `package.json`):**

| Setting | Default | Purpose |
|---|---|---|
| `altium365.graphqlEndpoint` | dev endpoint | A365 GraphQL API URL |
| `altium365.clientId` | dev client ID | OAuth2 client_id |
| `altium365.authEndpoint` | dev auth URL | OAuth2 authorization endpoint |
| `altium365.tokenEndpoint` | dev token URL | OAuth2 token endpoint |
| `altium365.scopes` | `openid profile` | OAuth2 scopes |
| `altium365.audience` | `""` | Optional Auth0-style audience |
| `altium365.redirectPort` | `8080` | Loopback OAuth redirect port |
| `altium365.redirectPath` | `/oauth/v2/callback` | Loopback redirect path |
| `altium365.pythonPath` | `""` | Path to Python interpreter |
| `altium365.inputParametersPath` | `""` | JSON input params file path |
| `altium365.extraEnv` | `{}` | Extra env vars for Python subprocess |
| `altium365.injectHelper` | `true` | Inject bundled `a365` module on PYTHONPATH |
| `altium365.promptForProjectId` | `true` | Prompt user to pick a project before run |
| `altium365.activeEnvironment` | `""` | Name of active environment preset |
| `altium365.environments` | Dev/Uat/Prod presets | Named environment overrides |

**Persisted state (VS Code APIs):**
- `context.secrets` — OAuth tokens stored under keys `altium365.tokens` and `altium365.workspaceTokens`
- `context.globalState` — selected workspace (`altium365.selectedWorkspace`) and last project IDs

**Build:**
- `tsconfig.json` — `rootDir: src`, `outDir: out`, `strict: true`, `target: ES2020`, `module: commonjs`
- `package.json` `scripts.compile` — `tsc -p ./`
- `package.json` `scripts.vscode:prepublish` — `npm run compile`

## Platform Requirements

**Development:**
- Node.js ≥18
- npm
- TypeScript 5.4+ (installed via devDependencies)
- VS Code (to run/debug the extension)

**Production (extension users):**
- VS Code ≥1.85.0
- Python 3 on PATH (or `ms-python.python` extension installed) for script execution
- Network access to Altium 365 GraphQL and auth endpoints

---

*Stack analysis: 2026-05-19*
