# Phase 2: Side Panel - Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 7 new/modified files
**Analogs found:** 6 / 7 (`sidePanel.ts` has only partial analogs — TreeDataProvider is greenfield)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/sidePanel.ts` (NEW) | provider (TreeDataProvider) | request-response (lazy fetch on expand) | `src/workspace.ts` (data fetch shape) + `src/extension.ts` (vscode UI wiring) | partial — no existing TreeDataProvider in codebase |
| `src/statusBar.ts` (NEW) | provider (StatusBarItem + QuickPick) | event-driven (auth-state → re-render) | `src/extension.ts` `doSelectEnvironment` (QuickPick) + activation subscriptions block | role-match |
| `src/workspace.ts` (MODIFY) — add `listScripts()` | helper (GraphQL query function) | request-response | `listProjects()` and `listWorkspaces()` in same file | **exact** |
| `src/auth.ts` (MODIFY) — per-workspace secret cache, auth-state emitter, `getActiveUserLabel()` | helper (token storage + event source) | request-response + pub-sub | `exchangeWorkspaceToken()` + `SECRET_*` constants in same file | **exact** |
| `src/extension.ts` (MODIFY) — register view, status bar, 4 script commands, `setContext('altium365.signedIn')` | handler (activate wiring) + 4 command handlers | request-response | `activate()` + `doSignIn`/`doSignOut` in same file | **exact** |
| `package.json` (MODIFY) — `viewsContainers`, `views`, `viewsWelcome`, 5 new commands, `menus.view/title` + `menus.view/item/context` | contributes (manifest) | declarative | existing `contributes.commands` + `contributes.menus.editor/title/run` in same file | **exact** |
| `python/_runner.py` invocation (REUSE — no new file) | handler (subprocess pipeline) | streaming (stdout/stderr) | `runScript()` in `src/extension.ts` lines 214-238 | **exact** (reuse verbatim) |

## Pattern Assignments

### `src/sidePanel.ts` (provider, request-response) — NEW FILE

**Analog (data fetch shape):** `src/workspace.ts` — for GraphQL call structure
**Analog (vscode UI primitives):** `src/extension.ts` — for `outputChannel` use, error message style, `context.subscriptions` pattern
**No existing analog** for TreeDataProvider class itself — use RESEARCH.md Pattern 1 as the template.

**Imports pattern to mirror** (from `src/extension.ts:1-12`):
```typescript
import * as vscode from 'vscode';
// then local modules with named imports:
import {
    getActiveAccessToken,
    readOAuthConfig,
    exchangeWorkspaceToken,
    OAuthConfig,
} from './auth';
import {
    graphqlRequest,
    listWorkspaces,
    listProjects,
    WorkspaceInfo,
    ProjectInfo,
} from './workspace';
```
Project convention (CONVENTIONS.md §Import Organization): namespace import for `vscode`, named imports for local modules, no default imports, no barrel files.

**Interface placement convention** (from `src/extension.ts:96-102, 276-285`):
Define interfaces at top of the file that primarily uses them. So `A365Node` discriminated union goes at top of `sidePanel.ts`.

**Error handling pattern** (copy from `src/extension.ts:91-93` and `src/workspace.ts:75-78`):
```typescript
} catch (e) {
    outputChannel.appendLine(`[Altium 365] tree: ${(e as Error).message}`);
    // For tree: return an error TreeItem (D-07), don't toast
}
```
Cast unknown caught error to `Error` to read `.message` — used everywhere in the codebase.

**Logging pattern** (from `src/extension.ts:163-166, 222-237`):
```typescript
outputChannel.appendLine(`[Altium 365] ...`);
```
All diagnostic lines prefixed `[Altium 365]`. The `outputChannel` is a module-level singleton declared in `src/extension.ts:14` — `sidePanel.ts` must receive it via constructor (or accept a logger callback) since per CONVENTIONS.md §Module Design no module-level state exists outside `extension.ts`.

**Constructor + DI pattern** (no exact analog — closest is the way `extension.ts` passes `context` into every command handler):
```typescript
// Mirror "every function takes context as first arg" pattern from extension.ts
constructor(
    private ctx: vscode.ExtensionContext,
    private output: vscode.OutputChannel,
) {}
```

---

### `src/statusBar.ts` (provider, event-driven) — NEW FILE

**Analog:** `src/extension.ts` — `doSelectEnvironment` (lines 104-182) for QuickPick + setting-update pattern, and `activate()` (lines 16-36) for subscription registration

**QuickPick pattern** (lines 115-128 of `src/extension.ts`):
```typescript
const items = names.map((name) => {
    const e = envs[name] || {};
    return {
        label: name,
        description: name === active ? '$(check) active' : undefined,
        detail: e.graphqlEndpoint || '(no graphqlEndpoint set)',
        name,
        spec: e,
    };
});
const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select Altium 365 environment',
    ignoreFocusOut: true,
});
if (!pick) {
    return;
}
```
Apply the same shape for the status-bar click menu (Sign Out / Switch Environment / Switch Workspace) — augment items with `command: string` and `executeCommand` on the picked entry.

**Codicon-in-label pattern** (from `src/extension.ts:444, 448` inside `pickProjectId`):
```typescript
items.push({
    label: '$(edit) Enter project id manually...',
    manual: true,
});
items.push({
    label: '$(circle-slash) No input_parameters',
    description: 'Run without projectId',
    value: '',
});
```
Use `$(codicon-name)` prefix on labels — matches existing convention. For status bar text (D-04 mandates exact `A365: <user> • <env>`): `item.text = `$(account) A365: ${user} • ${env}`;`.

**Subscription registration** (from `src/extension.ts:19-35`):
```typescript
context.subscriptions.push(
    outputChannel,
    vscode.commands.registerCommand('altium365.signIn', () => doSignIn(context)),
    ...
);
```
All disposables go through `context.subscriptions.push()` in `activate()` — never created inside the provider class itself (CONVENTIONS.md §VS Code API Conventions; RESEARCH.md anti-pattern §"Registering commands inside TreeDataProvider constructor").

---

### `src/workspace.ts` — add `listScripts()` (helper, request-response) — MODIFY

**Analog:** `listProjects()` at `src/workspace.ts:111-122` — exact role + data flow match.

**Exact template to copy** (lines 106-122):
```typescript
export interface ProjectInfo {
    id: string;
    name: string;
}

export async function listProjects(
    endpoint: string,
    accessToken: string
): Promise<ProjectInfo[]> {
    const data = await graphqlRequest(
        endpoint,
        accessToken,
        'query { desProjects { nodes { id name } } }'
    );
    const nodes = data?.desProjects?.nodes;
    return Array.isArray(nodes) ? (nodes as ProjectInfo[]) : [];
}
```

**Apply to `listScripts`:**
1. Define `ScriptInfo` interface (`scriptId: string; name: string; description?: string;`) immediately above the function — same pattern as `ProjectInfo`.
2. Function signature must match the (endpoint, token) pair used by siblings. **Note from RESEARCH.md §Schema Finding:** `gloScrScripts` is workspace-scoped (no `projectId` arg). Signature: `listScripts(endpoint: string, workspaceToken: string): Promise<ScriptInfo[]>`.
3. Use the multi-line query string from RESEARCH.md lines 458-465 (with `first: 100` variable per the Code Examples block).
4. Reuse `graphqlRequest` as-is.
5. Defensive null-coalesce on `data?.gloScrScripts?.nodes` mirrors `data?.desProjects?.nodes`.

**Critically:** `graphqlRequest` (lines 19-48) already throws on HTTP non-OK and on GraphQL `errors` arrays. Do not re-wrap — let it propagate; caller in `sidePanel.ts` catches and converts to error tree node (D-07).

---

### `src/auth.ts` — modifications (helper, request-response + pub-sub) — MODIFY

**Analog (existing):** `exchangeWorkspaceToken` lines 184-206 and secret-key constants lines 26-27.

**Constants pattern to extend** (lines 26-27):
```typescript
const SECRET_TOKENS = 'altium365.tokens';
const SECRET_WORKSPACE_TOKENS = 'altium365.workspaceTokens';
```
**Add (D-01, RESEARCH.md Pattern 4):**
```typescript
const SECRET_WS_TOKEN_PREFIX = 'altium365.workspaceTokens.'; // new per-workspace keying
```
Keep the old `SECRET_WORKSPACE_TOKENS` constant referenced by `clearAllTokens` so the singleton key continues to be cleared on sign-out (RESEARCH.md §Runtime State Inventory mandates deletion of the obsolete key).

**Token-exchange + storage pattern to mirror** (lines 184-206):
```typescript
export async function exchangeWorkspaceToken(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    workspaceAuthId: string
): Promise<TokenSet> {
    const base = await getStoredTokens(context);
    if (!base) {
        throw new Error('Sign in first.');
    }
    // ... postForm ...
    const stored = withExpiry(tok);
    await context.secrets.store(SECRET_WORKSPACE_TOKENS, JSON.stringify(stored));
    return stored;
}
```
**New `ensureWorkspaceToken(context, cfg, workspaceId, workspaceAuthId)`** wraps this:
- `key = SECRET_WS_TOKEN_PREFIX + workspaceId`
- `cached = await context.secrets.get(key)`; if present and `!isExpired(JSON.parse(cached))`, return it
- else call `exchangeWorkspaceToken(...)` and `await context.secrets.store(key, JSON.stringify(fresh))`

Reuse the private `isExpired` helper (line 248) — currently unexported, may need to be re-used by adding a thin wrapper or by keeping all callers inside `auth.ts`.

**`clearAllTokens` extension** (lines 243-246):
```typescript
export async function clearAllTokens(context: vscode.ExtensionContext): Promise<void> {
    await context.secrets.delete(SECRET_TOKENS);
    await context.secrets.delete(SECRET_WORKSPACE_TOKENS);
}
```
Add: enumerate and delete every `altium365.workspaceTokens.*` key. VS Code SecretStorage has no `keys()` enumeration API — track the set of known workspace IDs in `context.globalState` (key e.g. `altium365.workspaceTokenIds`, an array of strings) and iterate that list. This pattern fits the existing globalState use for `altium365.selectedWorkspace` (`src/extension.ts:73`).

**New `AuthState` event emitter** (no exact analog; closest pattern is RESEARCH.md Pattern 3):
```typescript
export interface AuthState {
    user?: string;
    environment?: string;
    signedIn: boolean;
}
const authStateEmitter = new vscode.EventEmitter<AuthState>();
export const onAuthStateChanged = authStateEmitter.event;
export function fireAuthStateChanged(s: AuthState) { authStateEmitter.fire(s); }
```
Fire from `signIn` (line 178), `clearAllTokens` (line 244), and whenever the environment changes (call from `doSelectEnvironment` in `extension.ts` after `cfg.update('activeEnvironment', ...)` at line 161).

**`getActiveUserLabel()` accessor** (new — needed for D-04 status bar):
- Decode the `id_token` JWT (already stored on `TokenSet.id_token`, see line 19) without verification — read `preferred_username` / `email` / `name` claim. Use stdlib `Buffer.from(b64url, 'base64')` — same b64url alphabet helper already present at line 29-31.
- Fallback: return `'(signed in)'` when no id_token is present.

**Module-private helper pattern** (line 169 of CONVENTIONS.md): keep JWT decoder unexported, like `b64url`/`pkcePair`/`postForm`/`isExpired`.

---

### `src/extension.ts` — activate() additions + 4 script commands (handler) — MODIFY

**Analog:** `activate()` lines 16-36 (subscription block) and `doSignIn/doSelectWorkspace` (lines 40-94) for command handler shape.

**Subscription block pattern to extend** (lines 19-35):
```typescript
context.subscriptions.push(
    outputChannel,
    vscode.commands.registerCommand('altium365.signIn', () => doSignIn(context)),
    vscode.commands.registerCommand('altium365.signOut', () => doSignOut(context)),
    vscode.commands.registerCommand('altium365.selectWorkspace', () =>
        doSelectWorkspace(context)
    ),
    vscode.commands.registerCommand('altium365.runScript', (uri?: vscode.Uri) =>
        runScript(context, uri)
    ),
    ...
);
```

**Append the following to the same `push` call** (do not create a second push — match the established single-push convention):
- `vscode.window.createTreeView('altium365.tree', { treeDataProvider, showCollapseAll: true })` (whole TreeView returned and pushed — RESEARCH.md §"Provider registration in activate()")
- `vscode.commands.registerCommand('altium365.tree.refresh', () => treeProvider.refresh())`
- `vscode.commands.registerCommand('altium365.tree.retryNode', (n) => treeProvider.refresh(n))`
- `vscode.commands.registerCommand('altium365.statusBar.click', () => onStatusBarClick(context))`
- 4 × `vscode.commands.registerCommand('altium365.script.<action>', ...)`
- the StatusBarItem itself (so VS Code disposes it)

**Placeholder handler shape** (D-08, three of four script commands in Phase 2):
Use the existing one-liner notification idiom from `src/extension.ts:74, 89`:
```typescript
vscode.window.showInformationMessage('Altium 365: Coming in Phase 3');
```
Each stub is registered with `vscode.commands.registerCommand('altium365.script.edit', () => vscode.window.showInformationMessage('Altium 365: Coming in Phase 3'));` — Phase 3 swaps the body without touching `package.json` (D-08).

**`setContext` companion (RESEARCH.md Pitfall 2)** — new pattern; no analog. Add a helper and call it (a) once at activation after reading stored tokens, (b) inside `doSignIn` after `signIn` succeeds (line 56), (c) inside `doSignOut` after `clearAllTokens` (line 72), (d) inside `doSelectEnvironment` after `clearAllTokens` (line 176):
```typescript
await vscode.commands.executeCommand('setContext', 'altium365.signedIn', boolean);
```
This is the same `vscode.commands.executeCommand(...)` style already used at lines 140 and 322 (`workbench.action.openSettings`, recursive `doSignIn`).

**Run-local handler (D-09) pattern** — fuse two existing patterns from this file:
1. **Two-step body fetch** — new pattern per RESEARCH.md Code Examples §"Script body fetch" (`gloScrScript` GraphQL → `fetch` for fileToken). ⚠ Per RESEARCH.md Assumption A1, **the file-download URL is unconfirmed** — planner inserts `checkpoint:human-verify` before this lands.
2. **Temp-file write + cleanup** — copy structure from `src/extension.ts:362-371`:
```typescript
const tmpFile = path.join(
    os.tmpdir(),
    `altium365-params-${Date.now()}-${process.pid}.json`
);
fs.writeFileSync(
    tmpFile,
    JSON.stringify({ projectId: picked }, null, 2),
    'utf-8'
);
paramsPath = tmpFile;
```
For D-09 the filename pattern becomes `altium365-script-${scriptId}-${Date.now()}-${process.pid}.py` (use `scriptId` not user-controlled `name` per RESEARCH.md §Security Domain → Command-injection threat). Add explicit `try { runPipeline(); } finally { fs.unlinkSync(tmpPath) }` cleanup — the existing params-temp pattern leaks the file; D-09 explicitly requires cleanup.
3. **Subprocess pipeline** — reuse the `spawn(python, ['-u', runnerPath, ...args], { cwd, env })` block from `runScript` lines 229-237 verbatim. The simplest implementation refactors `runScript` to accept `(context, scriptPath)` and reuses it from both the file-system invocation and the new tree-driven invocation.

**Error handling at command boundary** (lines 66-68, 91-93):
```typescript
} catch (e) {
    vscode.window.showErrorMessage(`Sign-in failed: ${(e as Error).message}`);
}
```
The Run-Local handler MUST wrap the GraphQL fetch + download + subprocess in this try/catch and show a `showErrorMessage` on failure — D-07's silent-output-channel rule applies only to **tree-fetch** failures, not to user-invoked commands.

---

### `package.json` — contributes additions (contributes) — MODIFY

**Analog (commands block):** lines 21-52 — pattern for each command entry.
**Analog (menus block):** lines 165-190 — pattern for `when`/`group`/`command` shape.

**Commands pattern to copy** (lines 22-26):
```json
{
  "command": "altium365.runScript",
  "title": "Altium 365: Run Python Script",
  "category": "Altium 365"
}
```
Apply to: `altium365.tree.refresh`, `altium365.tree.retryNode`, `altium365.statusBar.click`, `altium365.script.runLocal`, `altium365.script.edit`, `altium365.script.executeRemote`, `altium365.script.publish`. All keep `category: "Altium 365"` and a `Altium 365: …` title prefix.

**Menus pattern to copy** (lines 165-189):
```json
"menus": {
  "editor/title/run": [
    {
      "command": "altium365.runScript",
      "when": "resourceLangId == python",
      "group": "navigation"
    },
    ...
  ],
  ...
}
```
Extend with `view/title` and `view/item/context` per RESEARCH.md Pattern 2 (lines 252-275 of RESEARCH.md). Same field ordering (`command`, `when`, `group`) as the existing block to match style.

**Activity Bar contribution** (RESEARCH.md Code Examples §"Activity Bar contribution"):
Add the new top-level keys `viewsContainers`, `views`, `viewsWelcome` inside `contributes` (currently has only `commands`, `configuration`, `menus`). Order matters for diff readability — group them in the order shown in RESEARCH.md lines 159-166.

**Engine compatibility** (line 7-9): already `"vscode": "^1.85.0"` which satisfies every API in RESEARCH.md Standard Stack including `viewsWelcome` (needs ≥1.45). No bump required.

---

### Python subprocess invocation (handler, streaming) — REUSE

**Analog:** `src/extension.ts:229-237` — the existing `runScript` spawn block. Phase 2 reuses verbatim.
```typescript
const proc = spawn(python, ['-u', runnerPath, ...args], { cwd: scriptDir, env });
proc.stdout.on('data', (d) => outputChannel.append(d.toString()));
proc.stderr.on('data', (d) => outputChannel.append(d.toString()));
proc.on('error', (err) =>
    outputChannel.appendLine(`[Altium 365] Failed to start Python: ${err.message}`)
);
proc.on('close', (code) =>
    outputChannel.appendLine(`\n[Altium 365] Exit code: ${code}`)
);
```
**Refactor recommendation:** extract the spawn block (and the `prepareRun → spawn` pipeline) into an exported helper `runScriptAtPath(context, scriptPath)` so the new tree-driven runLocal handler doesn't duplicate ≈25 lines. This keeps the "no module-level state except `outputChannel`" rule (CONVENTIONS.md §Module Design).

## Shared Patterns

### Pattern S1: Error handling at command boundary
**Source:** `src/extension.ts:66-68` (`doSignIn` catch), `src/extension.ts:91-93` (`doSelectWorkspace` catch), `src/workspace.ts:75-78` (`pickAndExchangeWorkspace` catch)
**Apply to:** All four `altium365.script.*` handlers, `altium365.tree.refresh`, `altium365.statusBar.click`, `onStatusBarClick`
```typescript
try {
    await /* operation */;
} catch (e) {
    vscode.window.showErrorMessage(`Altium 365: ${(e as Error).message}`);
}
```
Exception per D-07: tree-fetch errors (`getChildren`) render an error TreeItem and write detail to `outputChannel` — no toast.

### Pattern S2: Diagnostic logging to outputChannel
**Source:** `src/extension.ts:14` (singleton), `:163-166, :222-237` (call sites)
**Apply to:** Every new file
```typescript
outputChannel.appendLine(`[Altium 365] <area>: <message>`);
```
Lines are always prefixed `[Altium 365]`. The singleton lives in `extension.ts` — pass it to `sidePanel.ts` / `statusBar.ts` via constructor or function argument (no new module-level singletons).

### Pattern S3: Async returns `T | undefined` for cancellable flows
**Source:** `src/extension.ts:287-398` (`prepareRun`), `src/extension.ts:405-483` (`pickProjectId`), `src/workspace.ts:62-98` (`pickAndExchangeWorkspace`)
**Apply to:** `onStatusBarClick` (QuickPick can be dismissed), `ensureWorkspaceToken` if cached fetch can be cancelled
```typescript
async function foo(...): Promise<T | undefined> {
    if (!precondition) {
        vscode.window.showErrorMessage('...');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(...);
    if (!pick) {
        return undefined;
    }
    ...
}
```
Throws are for unexpected/network errors; `undefined` for "user said no."

### Pattern S4: Secrets storage exclusivity
**Source:** `src/auth.ts:179, 204, 232, 244` and CONVENTIONS.md §VS Code API Conventions, AGENTS.md project rule
**Apply to:** Any new token caching code (`ensureWorkspaceToken`, per-workspace cache, sign-out cleanup)
```typescript
await context.secrets.store(key, JSON.stringify(value));
await context.secrets.get(key);
await context.secrets.delete(key);
```
**Never** `globalState` / `workspaceState` for token-like material. `globalState` is reserved for non-sensitive selection state (existing examples: `altium365.selectedWorkspace`, `altium365.lastProjectId.*`, and the new `altium365.workspaceTokenIds` index list).

### Pattern S5: Configuration access
**Source:** `src/extension.ts:78-81, 104-107, 184-186` and `src/auth.ts:278-289`
**Apply to:** Any new setting read in `sidePanel.ts`, `statusBar.ts`
```typescript
const cfg = vscode.workspace.getConfiguration('altium365');
const value = cfg.get<string>('keyName', 'defaultValue');
```
Always namespaced under `altium365`; always pass an explicit default; never cache the configuration object across `await` boundaries.

### Pattern S6: Constructor/parameter dependency injection of `context`
**Source:** Every command handler in `src/extension.ts` takes `context: vscode.ExtensionContext` as first arg (lines 40, 71, 77, 104, 214, 240, 287, 405)
**Apply to:** `A365TreeDataProvider` constructor, `statusBar.ts` factory, `ensureWorkspaceToken`, all new helpers
```typescript
async function doFoo(context: vscode.ExtensionContext, ...) { ... }
```
Never reach for `context` via a module-level singleton — always passed in. Aligns with CONVENTIONS.md §Module Design "No module-level state except `outputChannel`."

## No Analog Found

Files / patterns with no close match in the codebase (planner should use RESEARCH.md patterns directly):

| File / Pattern | Role | Data Flow | Reason | RESEARCH.md Pointer |
|----------------|------|-----------|--------|---------------------|
| `A365TreeDataProvider` class | provider | request-response | No TreeDataProvider exists in this codebase yet | RESEARCH.md Pattern 1 (lines 168-244) |
| `vscode.EventEmitter<T \| undefined \| void>` refresh signal | helper | pub-sub | No EventEmitter usage in current code | RESEARCH.md Pattern 1 + Sources §TreeDataProvider |
| `vscode.window.createStatusBarItem` lifecycle | provider | event-driven | No status bar code currently | RESEARCH.md Pattern 3 (lines 281-307) |
| `contributes.viewsContainers` / `views` / `viewsWelcome` | contributes | declarative | Manifest currently has no view contributions | RESEARCH.md Code Examples §"Activity Bar contribution" (lines 421-439) + Pattern 5 (lines 330-343) |
| Two-step file-token → HTTP download flow (D-09) | helper | request-response (mixed GraphQL + REST) | No REST file-download code anywhere — all current network calls are GraphQL via `graphqlRequest` | RESEARCH.md Code Examples §"Script body fetch" (lines 474-502) + Assumption A1 (requires `checkpoint:human-verify`) |
| JWT decode (for `getActiveUserLabel()`) | helper | transform | No JWT decoding present; only b64url helpers exist | Reuse the `b64url` shape from `src/auth.ts:29-31` and add a base64-decode inverse |

## Metadata

**Analog search scope:** `src/` (3 files), `package.json`, `python/` (read-only context — no changes needed there)
**Files scanned:** 8 source + 2 codebase intel docs + CONTEXT.md + RESEARCH.md
**Pattern extraction date:** 2026-05-19

---

## PATTERN MAPPING COMPLETE

**Phase:** 2 - side-panel
**Files classified:** 7
**Analogs found:** 6 / 7 (sidePanel.ts class itself is greenfield; data-fetch & vscode wiring patterns are well-mapped)

### Coverage
- Files with exact analog: 5 (`workspace.ts`, `auth.ts`, `extension.ts`, `package.json`, python subprocess reuse)
- Files with role-match analog: 1 (`statusBar.ts` — QuickPick pattern)
- Files with partial analog: 1 (`sidePanel.ts` — data-fetch shape mapped; TreeDataProvider class greenfield)
- Files with no analog: 0 (every pattern has either an in-repo source or a cited RESEARCH.md template)

### Key Patterns Identified
- All command handlers take `context: vscode.ExtensionContext` as first arg, surface errors via `vscode.window.showErrorMessage(`...: ${(e as Error).message}`)` at the boundary, and log via the `outputChannel` singleton with `[Altium 365]` prefix.
- `listScripts()` is a direct copy-of-shape from `listProjects()`/`listWorkspaces()` in `src/workspace.ts` — same `graphqlRequest` reuse, same `data?.field?.nodes` null-coalesce.
- Token storage is exclusively `context.secrets` (per AGENTS.md + CONVENTIONS.md §VS Code API Conventions); per-workspace caching extends the existing `SECRET_*` constant pattern in `src/auth.ts` with a new `altium365.workspaceTokens.<id>` prefix (RESEARCH.md Pattern 4).
- All disposables (TreeView, StatusBarItem, all `registerCommand` returns) push through the single `context.subscriptions.push(...)` call in `activate()` — extend the existing block rather than creating a new one.
- ⚠ D-09 script-body fetch has **no analog** and depends on Assumption A1 (file-download URL); planner must insert `checkpoint:human-verify` before the run-local task.

### File Created
`.planning/phases/02-side-panel/02-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files; every per-file action has a concrete code excerpt to copy from in the existing codebase, with explicit RESEARCH.md fallbacks for the three greenfield surfaces (TreeDataProvider class, status bar API, file-token download).
