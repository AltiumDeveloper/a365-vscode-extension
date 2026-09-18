# Altium Developer

Browse Altium 365 workspaces, run and debug Python scripts locally with live API access, and manage remote scripts — all without leaving VS Code.

## Prerequisites

- VS Code 1.85 or later
- Python 3.8 or later on your system `PATH` (or configured via the `altium365.pythonPath` setting)
- An Altium 365 account with access to at least one workspace

## Installation

Install **Altium Developer** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=altium.developer), or from the command line:

```
code --install-extension altium.developer
```

Pre-release builds are published on every push to `main`. To receive them, use **Switch to Pre-Release Version** on the extension's page in VS Code.

## Getting Started

1. **Sign in** — Run **Altium Developer: Sign In** from the Command Palette. Your browser opens and completes the OAuth2 login. Tokens are stored in VS Code's secure secret storage.
2. **Select a workspace** — Run **Altium Developer: Select Workspace**. Pick a workspace from the list. A workspace-scoped token is obtained and stored automatically.
3. **Run a script** — Open any `.py` file that defines `onExecute(context, input_parameters)`. Click the run button (▷) in the editor title bar, or right-click the file in the Explorer and choose **Altium Developer: Run Python Script**.

## Running and Debugging Scripts

Scripts must define a top-level `onExecute(context, input_parameters)` function. The extension calls it with:

- `context.auth_token` — the current Altium 365 access token (workspace-scoped when a workspace is selected)
- `context.graphql_url` — the active GraphQL endpoint
- `input_parameters` — a dict supplied by the active **test event** for this script (see [Test Events](#test-events) below). For local `.py` files that have never been parameterized, the extension offers a one-time import of a sibling `<script>.params.json` file if present.

A bundled `a365` helper module is auto-injected onto `PYTHONPATH`, so scripts can call the Altium 365 GraphQL API directly:

```python
import a365

data = a365.query("query { __typename }")
```

To debug a script, run **Altium Developer: Debug Python Script** from the Command Palette or the editor title bar. The script launches under the VS Code debugger, so breakpoints, step-through, and variable inspection all work.

## Authentication & Scopes

The extension uses OAuth2 PKCE with the following scopes:

- **`openid profile`** — basic user identity and profile information
- **`offline_access`** — enables refresh tokens for silent sign-in on VS Code restart
- **`workspace:scripts.manage`** — required for editing and publishing scripts
- **`workspace:scripts.execute`** — required for remote script execution

When you sign in, the browser completes an OAuth flow and the extension stores the resulting access token and refresh token securely in VS Code's secret storage. On subsequent activations, the extension silently refreshes the token using the stored refresh token — no browser interaction required unless the refresh token expires or is revoked.

## Global vs Workspace Tokens

The extension manages two types of tokens:

- **Global token** — obtained via the browser OAuth flow when you sign in. This token represents your identity and is scoped to the entire Altium 365 platform. It's stored securely in VS Code secrets.
- **Workspace token** — obtained automatically via token exchange when you first interact with a specific workspace (e.g., selecting it or running a script within it). Workspace tokens are workspace-scoped and cached per workspace ID.

When running a script, the `context.auth_token` passed to your `onExecute` function is:
- The **global token** if no workspace has been selected
- A **workspace-scoped token** for the selected workspace if one has been chosen

Signing out deletes **all** locally stored tokens — both the global token and every cached workspace token.

## Switching Environments

Run **Altium Developer: Select Environment** from the Command Palette to switch the active A365 environment. Three environments are pre-configured (Dev, Uat, Prod). Switching environments clears the active workspace and workspace token. Run **Altium Developer: Select Workspace** again after switching to pick a workspace in the new environment.

You can define additional environments under the `altium365.environments` setting; each entry may override `graphqlEndpoint`, `authEndpoint`, `tokenEndpoint`, `actionWaitEndpoint`, `redirectUri`, and `scopes`.

## Remote scripts

From the **Altium Developer** side panel, right-click any script to **Edit**, **Publish**, or **Execute Remotely**. Scripts open as virtual VS Code documents under the `altium365:` scheme — saving the document publishes the new version back to A365.

From the **Extension Points** tree, right-click an extension point and choose **Create Script** to create a new Python script, assign it to that extension point, and open it for editing. The existing run, debug, execute, edit, publish, and test-event flows then work on the created script the same way they work for other script assignments.

### Open + Edit + Publish

- Right-click a script in the side panel → **Edit Script** opens the live script body in a Python editor.
- Press `Ctrl+S` / `Cmd+S` to save **and** publish the new version. The publish comment is recorded as _"Updated via VS Code extension"_. **Publish Script** also remains available in the Command Palette for explicit invocations.
- When an `altium365:` document is the active editor, **Execute Remotely** appears in the editor title bar.

> **Last-write-wins caveat.** Publishing uses last-write-wins. If two clients edit the same script, the most recent save wins — coordinate edits out-of-band. A diff/conflict UI is planned but is not in this release.

### Execute Remotely

- Right-click a script → **Execute Remotely** kicks off a server-side execution. A cancellable progress notification appears, and log lines stream into the **Altium Developer** Output channel as they arrive (polled every 1.5 s).
- Parameters come from the active **test event** for the script (see [Test Events](#test-events) below). Values are passed to the server as strings.

> **Cancellation caveat.** Cancelling the progress notification stops the local poll loop, but the server-side execution continues. The Output channel will print `Remote execution cancelled (server-side execution continues)` to make this explicit. There is currently no server-side cancel API.

### Authentication + workspaces

Remote scripts use a workspace-scoped token obtained automatically the first time you act on a script in that workspace. Switching environments (e.g. **Prod** ↔ **Dev**) invalidates any open `altium365:` editors — close and reopen them after the switch to pick up tokens from the new environment.

## Test Events

**Test events** are named JSON parameter sets attached to a script — AWS-Lambda-style. The same event is used uniformly by **Run**, **Debug**, and **Execute Remotely**, so you can develop a script locally and execute it on the server against the same payload without juggling files.

### Why

Test events let you keep multiple named parameterizations per script — e.g. `small-project`, `with-errors`, `production-id` — and switch between them in one click, instead of editing a single JSON file. Sibling `<script>.params.json` files next to local scripts trigger a one-time import prompt on first run with no stored events.

### Commands

| Command | What it does |
| --- | --- |
| Altium Developer: Pick Test Event | Unified picker — lists events, offers Create / Edit current; picking an event sets it as the default |
| Altium Developer: Create Test Event | New event from `Empty` or `Project-related` preset |
| Altium Developer: Edit Test Event | Open the event's JSON in a tab — `Cmd+S` / `Ctrl+S` saves |
| Altium Developer: Delete Test Event | Remove an event (modal confirm) |
| Altium Developer: Set Default Test Event | Mark an event as the default for unattended Run / Debug / Execute |

### UI affordances

For Python files (local `.py` or remote-tmp script bodies) the test-event picker is reachable from two surfaces:

- **Status bar indicator** (bottom-right of VS Code, next to the `A365` user/env item) — shows the **current default event name** with a `$(symbol-event)` icon, only when a Python editor is active. Click it to open the unified picker (events list + Create + Edit). Turns yellow when events exist but no default is set.
- **Altium Developer editor-title submenu** → `Pick Test Event` row — same unified picker, grouped with the other A365 actions.

### Storage

Test events live in **`vscode.context.globalState`** under the key `altium365.scriptParams.<identity>` — scoped to your machine and **shared across all VS Code workspaces** on that machine. `<identity>` is derived from the script's `(workspaceId, scriptId)` for remote scripts or its absolute path for local `.py` files.

Test events are **not** synced via Settings Sync. This is intentional: parameter payloads frequently contain machine-specific paths or workspace-specific IDs that would break on a teammate's machine.

If you store more than 25 events for one script, the extension surfaces a one-time non-blocking toast suggesting you delete unused ones. The warning fires only once per script over the extension's lifetime.

## Commands Reference

All commands are prefixed with **Altium Developer:**. Most are available in the Command Palette; the ones marked **side panel** are offered only from the context menus of the **Workspaces** view in the Altium Developer side panel.

### Authentication & Environment
| Command | Description |
| --- | --- |
| Sign In | Opens the browser for OAuth2 PKCE login and stores tokens securely |
| Sign Out | Clears all stored tokens (global and workspace tokens) |
| Select Workspace | Lists accessible workspaces and exchanges for a workspace-scoped token |
| Select Environment | Switches the active A365 environment (pre-configured or custom) |

### Script Execution (Local)
| Command | Description |
| --- | --- |
| Run Python Script | Runs the active `.py` file locally with A365 API access |
| Debug Python Script | Runs the active `.py` file under the VS Code debugger |

### Script Operations (Remote)
| Command | Description |
| --- | --- |
| Edit Script | **Side panel.** Opens a remote script in the editor (via `altium365:` scheme) |
| Create Script | **Side panel.** Creates a Python script from an extension point and assigns it there |
| Publish Script | Publishes local changes to a remote script back to A365 |
| Execute Script Remotely | Triggers server-side execution on A365 (logs stream to Output channel) |

### Test Events
| Command | Description |
| --- | --- |
| Pick Test Event | Unified picker — lists events, offers Create/Edit; picking sets default |
| Create Test Event | New event from Empty or Project-related preset |
| Edit Test Event | Open an event's JSON in a tab (via `altium365-event:` scheme) |
| Delete Test Event | Remove an event (with confirmation) |
| Set Default Test Event | Mark an event as the default for Run/Debug/Execute |

### Tooling & Setup
| Command | Description |
| --- | --- |
| Configure Python IntelliSense | Syncs runtime PYTHONPATH into editor IntelliSense settings |
| Install Script Dependencies | Installs Python dependencies from requirements comment blocks |

### Tree Actions (Context Menu)
| Command | Description |
| --- | --- |
| Refresh Workspaces | Refreshes the **Workspaces** view |
| Copy ID | Copies workspace/project/script/extension point ID to clipboard |
| Open in Browser | Opens workspace/project/assignment in A365 web UI |
| Run Script (Local) | Downloads a script from the tree to a temp file and runs it locally |
| Debug Script (Local) | Same, under the VS Code debugger |
| Select Workspace | Makes the clicked workspace node the active workspace |

## Configuration

Key settings (see VS Code Settings for the full list):

- `altium365.pythonPath` — path to the Python interpreter (default: auto-detect via the Python extension or `python` on `PATH`)
- `altium365.environments` — object of named environments; each entry can override `graphqlEndpoint`, `authEndpoint`, `tokenEndpoint`, `actionWaitEndpoint`, `redirectUri`, and `scopes`
- `altium365.activeEnvironment` — name of the active entry in `altium365.environments` (default: `Prod`); managed by **Select Environment**
- `altium365.clientId` — OAuth2 `client_id` used for the PKCE flow. This is a public client identifier, not a secret; change it only if you have your own registered Altium application
- `altium365.extraEnv` — extra environment variables passed to the Python process
- `altium365.injectHelper` — inject the bundled `a365` helper module on PYTHONPATH (default: `true`)
