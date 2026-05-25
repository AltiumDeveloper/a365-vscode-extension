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

## Remote scripts

From the Altium 365 side panel, right-click any script to **Edit**, **Publish**, or **Execute Remotely**. Scripts open as virtual VS Code documents under the `altium365:` scheme — saving the document publishes the new version back to A365.

### Open + Edit + Publish

- Right-click a script in the side panel → **Edit Script** opens the live script body in a Python editor.
- Press `Ctrl+S` / `Cmd+S` (or right-click → **Publish Script**) to save **and** publish the new version. The publish comment is recorded as _"Updated via VS Code extension"_.
- When an `altium365:` document is the active editor, **Publish Script** and **Execute Remotely** also appear in the editor title bar.

> **Last-write-wins caveat.** Publishing uses last-write-wins. If two clients edit the same script, the most recent save wins — coordinate edits out-of-band. A diff/conflict UI is planned but is not in this release.

### Execute Remotely

- Right-click a script → **Execute Remotely** kicks off a server-side execution. A cancellable progress notification appears, and log lines stream into the **Altium 365** Output channel as they arrive (polled every 1.5 s).
- Parameters are read from the per-workspace state key `altium365.scriptParams.<scriptId>` (reserved for a future Set Parameters UI). Values are passed to the server as strings.
- The `altium365.promptForProjectId` setting controls whether a `projectId` input box appears for executions that need one.

> **Cancellation caveat.** Cancelling the progress notification stops the local poll loop, but the server-side execution continues. The Output channel will print `Remote execution cancelled (server-side execution continues)` to make this explicit. There is currently no server-side cancel API.

### Authentication + workspaces

Remote scripts use a workspace-scoped token obtained automatically the first time you act on a script in that workspace. Switching environments (e.g. **Prod** ↔ **Dev**) invalidates any open `altium365:` editors — close and reopen them after the switch to pick up tokens from the new environment.

## Test Events

**Test events** are named JSON parameter sets attached to a script — AWS-Lambda-style. The same event is used uniformly by **Run**, **Debug**, and **Execute Remotely**, so you can develop a script locally and execute it on the server against the same payload without juggling files.

### Why

Test events replace the older `<script>.params.json` / `altium365.inputParametersPath` workflow. Instead of editing one JSON file per script, you can keep multiple named parameterizations per script — e.g. `small-project`, `with-errors`, `production-id` — and switch between them in one click.

### Commands

| Command | What it does |
| --- | --- |
| Altium 365: Pick Test Event | Choose the event to run with; offers Create/Edit/Set-default from the picker |
| Altium 365: Create Test Event | New event from `Empty` / `Project-related` / `From settings.inputParametersPath` preset |
| Altium 365: Edit Test Event | Open the event's JSON in a tab — `Cmd+S` / `Ctrl+S` saves |
| Altium 365: Delete Test Event | Remove an event (modal confirm) |
| Altium 365: Set Default Test Event | Mark an event as the default for unattended Run / Debug / Execute |

### UI affordances

For Python files (local `.py` or remote-tmp script bodies) the test-event picker is one click away — both placements are shipped during the v1 trial:

- **Title-bar icon** next to the Run button — direct entry to `Pick Test Event`.
- **Altium 365 editor-title submenu** → `Test events ▾` sub-row — same command, grouped with the other A365 actions.

The picker header shows the current default event prominently and includes inline `Create new…` and `Edit current default…` rows. Picking an event sets it as the default and runs the script.

### Storage

Test events live in **`vscode.context.globalState`** under the key `altium365.scriptParams.<identity>` — scoped to your machine and **shared across all VS Code workspaces** on that machine. `<identity>` is derived from the script's `(workspaceId, scriptId)` for remote scripts or its absolute path for local `.py` files.

Test events are **not** synced via Settings Sync. This is intentional: parameter payloads frequently contain machine-specific paths or workspace-specific IDs that would break on a teammate's machine.

If you store more than 25 events for one script, the extension surfaces a one-time non-blocking toast suggesting you delete unused ones. The warning fires only once per script over the extension's lifetime.

### Migration from `inputParametersPath`

The `altium365.inputParametersPath` setting is still honoured as an **escape hatch** — if set to an existing JSON file, its contents win over any stored test event for that run. It is also exposed as the `From settings.inputParametersPath` preset when creating a new event, so you can one-shot import its current contents into a named test event and then unset the setting.

Sibling `<script>.params.json` files next to local scripts trigger a one-time import prompt (`Import` / `Not now` / `Never for this file`) the first time you run a script with no stored events. Imported events land as the `imported` event and are set as the default. The sibling file is never deleted.

### Note on `promptForProjectId`

The `altium365.promptForProjectId` setting is a legacy back-compat shim and no longer prompts at runtime — use the `Project-related` preset when creating a test event instead.

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
