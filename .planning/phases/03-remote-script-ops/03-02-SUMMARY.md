---
phase: 03-remote-script-ops
plan: 02
slug: fsp-and-wiring
status: complete
completed: 2026-05-20
requirements: [SCRIPT-02, SCRIPT-03, SCRIPT-04]
provides:
  - altium365-fsp-scheme
  - script-command-wiring
  - editor-title-menus
key-files:
  created:
    - src/remoteScriptFs.ts
    - src/remoteExecution.ts
  modified:
    - src/scriptCommands.ts
    - src/extension.ts
    - package.json
---

# Phase 3 Plan 02: FSP & Wiring Summary

Stood up all extension-host plumbing for Phase 3 so plans 03-03 (read/write impl) and 03-04 (execution impl) can land pure-behavior commits with zero overlap on `extension.ts` / `package.json` / `scriptCommands.ts`. After this commit, the `altium365:` URI scheme is a registered FileSystemProvider, three of four script commands are live (Edit/Publish/Execute Remotely), and editor-title buttons are wired — `readFile`/`writeFile`/`executeRemoteScript` bodies are intentional stubs.

## URI Shape (D-01 contract)

`altium365://<workspaceId>/<scriptId>/<encodedDisplayName>.py`

- **authority** = `workspaceId` (UUID-36) — host segment so VS Code routes per-workspace cleanly and `resourceScheme == altium365` clauses don't leak across workspaces.
- **path** = `/<scriptId>/<URI-encoded display name>` — `scriptId` is the first path segment (UUID-36); display name is the second segment, used only for editor titles and language detection (`.py` → Python).
- `parseScriptUri` enforces UUID regex on both IDs and throws `vscode.FileSystemError.FileNotFound(uri)` on any mismatch (mitigates T-03-02-01 path traversal).
- Builder uses `vscode.Uri.from({ scheme, authority, path })` — never string concatenation.

## Public Surfaces (stable contracts for 03-03 / 03-04)

### `src/remoteScriptFs.ts`

```ts
export interface ParsedRemoteUri {
  workspaceId: string;
  scriptId: string;
  displayName: string;
}
export function buildScriptUri(workspaceId: string, scriptId: string, scriptName: string): vscode.Uri;
export function parseScriptUri(uri: vscode.Uri): ParsedRemoteUri;
export class AltiumRemoteScriptFs implements vscode.FileSystemProvider { /* ... */ }
```

- Constructor: `(ctx, getEnvGlobalEndpoint, output)`. No token caching, no workspace-info caching (D-08).
- `_onDidChangeFile` is the FSP's event emitter — Plan 03-03 will fire it from `writeFile` after a successful publish round-trip.
- `readFile` / `writeFile` currently throw `FileSystemError.Unavailable('... (Plan 03-03)')`. **03-03 replaces these two method bodies only** — no constructor / surface change required.
- `watch`, `stat`, `readDirectory`, `createDirectory`, `delete`, `rename` are all final for v1 (no-op / NoPermissions / FileNotADirectory per the FSP contract).

### `src/remoteExecution.ts`

```ts
export interface ExecuteRemoteArgs {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  workspaceId: string;
  workspaceAuthId: string;
  scriptId: string;
  scriptName: string;
  workspaceName: string;
  envGlobalEndpoint: string;
}
export async function executeRemoteScript(args: ExecuteRemoteArgs): Promise<void>;
```

- Stub body shows a cancellable progress notification + writes one line to OutputChannel. **03-04 keeps this signature unchanged** — only the function body changes (gloScrExecuteScript + result polling).

### `src/scriptCommands.ts` (changed dispatch)

- `altium365.script.runLocal` → STILL placeholder (Phase 02 BLOCKED — out of scope per Phase 3 charter).
- `altium365.script.edit` → resolves `(workspaceId, scriptId, scriptName)` from either an `A365Node` or `activeTextEditor.document.uri` (via `parseScriptUri`), then `vscode.workspace.openTextDocument(uri)` → `showTextDocument(doc)`.
- `altium365.script.publish` → finds the open document by URI, calls `doc.save()` if dirty, info-toasts otherwise. Save will trigger FSP.writeFile (currently the stub) per D-03.
- `altium365.script.executeRemote` → resolves args including `workspaceName` via `getSelectedWorkspace(ctx)` (or "(workspace name unknown)" fallback for editor-title invocation against a non-selected workspace), then calls `executeRemoteScript(...)`.

All three real handlers funnel errors through a single boundary `try/catch` → `showErrorMessage` (terse) + `outputChannel.appendLine` (full body). Plan 03-05 Task 1 wraps `GraphQLError` for this boundary via `mapGraphQLErrorToUserMessage`.

## Wiring (extension.ts + package.json)

- **FSP registration** in `activate()` — constructed before `registerScriptCommands`, registered with `{ isCaseSensitive: true, isReadonly: false }`, disposable pushed into `context.subscriptions`.
- **`editor/title` menus** added to `package.json` with two entries gated on `resourceScheme == altium365 && resourceExtname == .py`:
  - `altium365.script.publish` — `navigation@1`
  - `altium365.script.executeRemote` — `navigation@2`
- No `commandPalette` entries added (D-06: tree/editor-title only for these three commands).
- Existing `view/item/context` entries already point at the real command IDs — untouched.

## Invariants Preserved

- 02.2 auth surface — untouched (no imports added from `auth.ts` in this plan; 03-03 will add `getActiveAccessToken`/`ensureWorkspaceToken` consumption inside `readFile`/`writeFile`).
- D-17 (ActionWait `https`), D-18 (env-switch ordering), D-19 (`getWorkspaceApiUrl`) — untouched.
- D-09 (OutputChannel singleton) — `executeRemoteScript` receives the singleton via `args.output`; no new channels created.
- All commands `altium365.`-prefixed; no new IDs added (`script.edit`, `script.publish`, `script.executeRemote` already declared in 02-phase plans).
- Token hygiene grep clean (no Bearer / access_token / workspaceToken references in any of the three new/modified files).

## Verify Results

- `npm run compile` — clean.
- `registerFileSystemProvider`, `AltiumRemoteScriptFs` present in `extension.ts`.
- `resourceScheme == altium365` declared twice in `package.json` (publish + executeRemote).
- `buildScriptUri`, `executeRemoteScript`, `openTextDocument` all referenced from `scriptCommands.ts`.
- Strict-parse defence (`FileSystemError.FileNotFound`) present in `remoteScriptFs.ts`.
- Token hygiene scan — zero leaks.
- "placeholder" string count in `scriptCommands.ts`: 4 lines, ALL referring to `runLocal` (1 doc-comment block, 1 helper-fn name, 1 inline comment, 1 use-site). Intent satisfied: the only conceptual placeholder is `runLocal`.

## Self-Check: PASSED

- `[x]` `src/remoteScriptFs.ts` exists.
- `[x]` `src/remoteExecution.ts` exists.
- `[x]` `src/scriptCommands.ts` modified (live dispatch for edit/publish/executeRemote; runLocal placeholder retained).
- `[x]` `src/extension.ts` registers FSP and pushes disposable into subscriptions.
- `[x]` `package.json` declares `editor/title` menu entries.
- `[x]` Compile clean.

## Next

- Wave 3 dispatches plans 03-03 (FSP read/write impl + Files Service round-trip) and 03-04 (`gloScrExecuteScript` + result polling) in parallel. Both append to `src/workspace.ts` in disjoint export bands.
- Wave 4: Plan 03-05 (error mapping + UAT doc + README), then HALT at the blocking human-verify checkpoint (Task 4).
