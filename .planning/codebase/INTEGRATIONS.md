# External Integrations

**Analysis Date:** 2026-05-19

## APIs & External Services

**Altium 365 GraphQL API:**
- Purpose: List workspaces (`desWorkspaceInfos`), list projects (`desProjects`), and as the script execution endpoint passed to user Python scripts
- Protocol: GraphQL over HTTPS (POST)
- Client (TypeScript): raw `fetch` in `src/workspace.ts` (`graphqlRequest`)
- Client (Python): `urllib.request` in `python/a365.py` (`query`); optional `gql.Client` via `python/_runner.py` `Context.gql_client`
- Auth: Bearer token in `Authorization` header
- Env vars passed to Python subprocess: `ALTIUM365_GRAPHQL_ENDPOINT`, `ALTIUM365_TOKEN`

**Environment endpoints (configured as presets):**

| Environment | GraphQL Endpoint |
|---|---|
| Dev | `https://usw2.dev-365.altium.com/napi/gateway/graphql` |
| UAT | `https://eur.uat-365.altium.com/napi/gateway/graphql` |
| Prod | `https://eur.365.altium.com/napi/gateway/graphql` |

## Authentication & Identity

**OAuth2 Authorization Code Flow with PKCE:**
- Implementation: `src/auth.ts` — fully custom, no OAuth library dependency
- Flow: PKCE pair generated with `crypto` → browser opened via `vscode.env.openExternal` → loopback HTTP server on `localhost:<redirectPort>` receives authorization code → token exchanged at `tokenEndpoint`
- CSRF protection: random `state` parameter checked on callback
- Token storage: VS Code `SecretStorage` API (`context.secrets`)
  - Base tokens key: `altium365.tokens`
  - Workspace-scoped tokens key: `altium365.workspaceTokens`
- Token refresh: `grant_type: refresh_token` via `auth.ts:refreshTokens()`
- Workspace token exchange: RFC 8693 token exchange (`urn:ietf:params:oauth:grant-type:token-exchange`) to obtain workspace-scoped tokens with scope `a365:workspace:<authId>`

**Auth Endpoints (per environment):**

| Environment | Auth Endpoint | Token Endpoint |
|---|---|---|
| Dev | `https://auth.dev1.altium.com/connect/authorize` | `https://auth.dev1.altium.com/connect/token` |
| UAT | `https://auth.uat1.altium.com/connect/authorize` | `https://auth.uat1.altium.com/connect/token` |
| Prod | `https://auth.altium.com/connect/authorize` | `https://auth.altium.com/connect/token` |

**Default OAuth2 client_id:** `20C490ED-58EF-11EF-9194-02A5C34CA889` (configurable)

**Scopes:** `openid profile` (default; configurable; workspace exchange appends `a365:workspace:<authId>`)

## Data Storage

**Databases:**
- None — no database connection in the extension

**File Storage:**
- Local filesystem only:
  - Input parameters JSON files: `<script>.params.json` sibling, or `altium365.inputParametersPath` setting
  - Temporary params files: `os.tmpdir()/altium365-params-<ts>-<pid>.json` created in `src/extension.ts:prepareRun()`

**Caching:**
- None — no caching layer

## Monitoring & Observability

**Error Tracking:**
- None — no error tracking service

**Logs:**
- VS Code OutputChannel: `'Altium 365'` channel (`src/extension.ts:outputChannel`)
  - Logs script path, GraphQL endpoint, Python path, params path, stdout/stderr from Python subprocess, exit codes

## VS Code Extension Dependencies (Optional)

**ms-python.python:**
- Purpose: Auto-resolve Python interpreter path via `environments.getActiveEnvironmentPath()` / `settings.getExecutionDetails()`
- Integration: `src/extension.ts:resolvePythonPath()` — activated on demand, falls back gracefully

**ms-python.debugpy:**
- Purpose: Python debugging via `vscode.debug.startDebugging()` using `debugpy` debug type
- Used by: `altium365.debugScript` command (`src/extension.ts:debugScript()`)
- Required only for debug workflow; run workflow works without it

## Environment Variables Passed to Python Subprocess

| Variable | Source | Purpose |
|---|---|---|
| `ALTIUM365_GRAPHQL_ENDPOINT` | `altium365.graphqlEndpoint` setting | GraphQL API URL for `a365.query()` |
| `ALTIUM365_TOKEN` | active access token from SecretStorage | Bearer token for API calls |
| `ALTIUM365_WORKSPACE_ID` | selected workspace globalState | Workspace identifier |
| `ALTIUM365_WORKSPACE_AUTH_ID` | selected workspace globalState | Workspace auth identifier |
| `ALTIUM365_WORKSPACE_NAME` | selected workspace globalState | Human-readable workspace name |
| `PYTHONPATH` | `context.asAbsolutePath('python')` prepended | Makes `import a365` available |
| `PYTHONIOENCODING` | hardcoded `utf-8` | Ensures correct output encoding |
| `PYTHONUNBUFFERED` | hardcoded `1` | Unbuffered stdout/stderr |

## Webhooks & Callbacks

**Incoming:**
- OAuth2 redirect callback: loopback HTTP server on `localhost:<altium365.redirectPort>` (default 8080), path `<altium365.redirectPath>` (default `/oauth/v2/callback`)
  - Server is ephemeral — created per sign-in flow, torn down after receiving code or timeout

**Outgoing:**
- None

---

*Integration audit: 2026-05-19*
