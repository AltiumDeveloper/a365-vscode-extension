# Altium 365 Developer Tools

Browse Altium 365 workspaces, run and debug Python scripts locally with live API access, and manage remote scripts — all without leaving VS Code.

## Prerequisites

- VS Code 1.85 or later
- Python 3.8 or later on your system `PATH` (or configured via the `altium365.pythonPath` setting)
- An Altium 365 account with access to at least one workspace

## Installation

1. Download the latest `.vsix` from the [GitHub Releases](https://github.com/altium/a365-vscode-extension/releases) page (or from the CI workflow artifacts).
2. In VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **Extensions: Install from VSIX...**, and select the downloaded file.
3. Reload VS Code when prompted.

## Getting Started

1. **Sign in** — Run **Altium 365: Sign In** from the Command Palette. Your browser opens and completes the OAuth2 login. Tokens are stored in VS Code's secure secret storage.
2. **Select a workspace** — Run **Altium 365: Select Workspace**. Pick a workspace from the list. A workspace-scoped token is obtained and stored automatically.
3. **Run a script** — Open any `.py` file that defines `onExecute(context, input_parameters)`. Click the run button (▷) in the editor title bar, or right-click the file in the Explorer and choose **Altium 365: Run Python Script**.

## Running and Debugging Scripts

Scripts must define a top-level `onExecute(context, input_parameters)` function. The extension calls it with:

- `context.auth_token` — the current Altium 365 access token (workspace-scoped when a workspace is selected)
- `context.graphql_url` — the active GraphQL endpoint
- `input_parameters` — a dict loaded from `<script>.params.json` next to the script, or from the file pointed to by `altium365.inputParametersPath`

A bundled `a365` helper module is auto-injected onto `PYTHONPATH`, so scripts can call the Altium 365 GraphQL API directly:

```python
import a365

data = a365.query("query { __typename }")
```

To debug a script, run **Altium 365: Debug Python Script** from the Command Palette or the editor title bar. The script launches under the VS Code debugger, so breakpoints, step-through, and variable inspection all work.

## Switching Environments

Run **Altium 365: Select Environment (Dev / Uat / Prod)** from the Command Palette to switch the active A365 environment. Three environments are pre-configured:

- **Dev** — `usw2.dev-365.altium.com`
- **Uat** — `eur.uat-365.altium.com`
- **Prod** — `eur.365.altium.com`

Switching environments clears the active workspace and workspace token. Run **Altium 365: Select Workspace** again after switching to pick a workspace in the new environment.

You can define additional environments under the `altium365.environments` setting; each entry may override `graphqlEndpoint`, `authEndpoint`, `tokenEndpoint`, `scopes`, and `audience`.

## Commands Reference

| Command | Description |
| --- | --- |
| Altium 365: Sign In | Opens the browser for OAuth2 login and stores tokens securely |
| Altium 365: Sign Out | Clears all stored tokens |
| Altium 365: Select Workspace | Lists accessible workspaces and stores a workspace-scoped token |
| Altium 365: Select Environment (Dev / Uat / Prod) | Switches the active A365 environment |
| Altium 365: Run Python Script | Runs the active `.py` file against the A365 API |
| Altium 365: Debug Python Script | Runs the active `.py` file under the VS Code debugger |

## Configuration

Key settings (see VS Code Settings for the full list):

- `altium365.pythonPath` — path to the Python interpreter (default: auto-detect via the Python extension or `python` on `PATH`)
- `altium365.inputParametersPath` — path to a JSON file passed as `input_parameters` (default: look for `<script>.params.json` next to the script)
- `altium365.promptForProjectId` — whether to prompt for a `projectId` when no params file is found (default: `true`)
- `altium365.environments` — object of named environments; each entry can override `graphqlEndpoint`, `authEndpoint`, `tokenEndpoint`, `scopes`, and `audience`
