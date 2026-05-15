# Altium 365 Scripting (VS Code extension)

Run Python ERC / scripting rules locally with the same `onExecute(context, input_parameters)` contract as the in-browser editor on Altium 365. Includes browser-based OAuth2 sign-in (Authorization Code + PKCE) modeled on the Renesas R365 MATLAB toolbox.

## Sign-in flow

`Altium 365: Sign In` →

1. Opens the system browser at `auth.../connect/authorize` (PKCE S256, `state`).
2. Spins up a loopback HTTP listener on `http://localhost:<port><path>`.
3. Receives the auth code, exchanges it at `connect/token` for `access_token` + `refresh_token`.
4. Stores tokens in VS Code SecretStorage.

`Altium 365: Select Workspace` →

1. Calls GraphQL `desWorkspaceInfos { name workspaceId authId }` with the base access token.
2. Lets you pick a workspace.
3. Performs a `urn:ietf:params:oauth:grant-type:token-exchange` with scope `a365:workspace:<authId> <baseScopes>` and stores the workspace token.

`Altium 365: Run Python Script` uses the workspace token if present, otherwise the base token (auto-refreshed via `refresh_token`).

`Altium 365: Sign Out` clears all tokens.

## Defaults (override in Settings)

| Setting | Default |
|---|---|
| `altium365.clientId` | `20C490ED-58EF-11EF-9194-02A5C34CA889` |
| `altium365.authEndpoint` | `https://auth.dev1.altium.com/connect/authorize` |
| `altium365.tokenEndpoint` | `https://auth.dev1.altium.com/connect/token` |
| `altium365.scopes` | `openid profile` |
| `altium365.redirectPort` | `8080` |
| `altium365.redirectPath` | `/oauth/v2/callback` |
| `altium365.graphqlEndpoint` | `https://usw2.dev-365.altium.com/napi/gateway/graphql` |

The redirect URI sent to the IdP is `http://localhost:<redirectPort><redirectPath>`. It must be registered on the OAuth client.

## Script contract

When you run a `.py` file, the extension spawns:

```
python -u python/_runner.py <yourScript.py> [<params.json>]
```

The bootstrap imports your script as a module and calls:

```python
onExecute(context, input_parameters)
```

- `context.auth_token` — current Altium 365 access token (workspace token if available).
- `context.graphql_url` — value of `altium365.graphqlEndpoint`.
- `input_parameters` — dict from `<scriptName>.params.json` next to the script, or from the `altium365.inputParametersPath` setting, or `{}`.

Environment variables also injected: `ALTIUM365_TOKEN`, `ALTIUM365_GRAPHQL_ENDPOINT`.

The script's directory is added to `sys.path`, so sibling modules (e.g. `ProjectData.py`, `altium_data_models.py`) work as in the A365 editor.

The bundled `a365` Python helper (stdlib-only) is auto-injected on `PYTHONPATH`:

```python
import a365
data = a365.query("query { __typename }")
```

## Build

```powershell
npm install
npm run compile
```

Press **F5** to launch an Extension Development Host. Then:

1. Run **Altium 365: Sign In** (browser opens; complete login).
2. Run **Altium 365: Select Workspace**.
3. Open a `.py` script defining `onExecute(context, input_parameters)` and run **Altium 365: Run Python Script**.
