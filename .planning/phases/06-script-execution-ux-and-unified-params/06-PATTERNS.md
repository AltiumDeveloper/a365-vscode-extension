# Phase 6: Script Execution UX & Unified Parameters — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 6 (5 TS sources + `package.json`)
**Analogs found:** 6 / 6 (every new/modified file has at least one strong analog already in this codebase)

This phase is a refactor — almost every "new" surface has a near-exact precedent in the existing code. The planner's job is mostly "copy this shape into this new function." Concrete excerpts (with file:line citations) follow per file.

---

## File Classification

| File | New / Modified | Role | Data Flow | Closest Analog | Match Quality |
|------|---------------|------|-----------|----------------|---------------|
| `src/extension.ts` | modified | controller (command registrations + UI orchestration) | request-response (user → command → side effects) | self (`runScript`/`prepareRun`/`pickProjectId` already exist; we generalize them) | exact (self-pattern) |
| `src/scriptCommands.ts` | modified | controller (command handlers per script) | request-response | self (`runLocalFromScriptNode` / `downloadScriptToTmp` already exist; we add `target` plumbing + rewrite tmp path builder) | exact (self-pattern) |
| `src/remoteExecution.ts` | modified | service (orchestrates remote GraphQL execution) | request-response + poll loop | self (Block A already does workspace-targeted setup; Block B gets the projectId-prompt fallback) | exact (self-pattern) |
| `src/sidePanel.ts` | modified | provider (`TreeDataProvider`) | event-driven (tree refresh) | self — `case 'error'` (`sidePanel.ts:191-203`) sets `item.command` exactly as `case 'script'` (`:173-182`) needs | exact (same file, sibling switch arm) |
| `src/projectPicker.ts` | **NEW** | utility (QuickPick prompt + project listing) | request-response | `extension.ts:773-852` (current `pickProjectId`) — extract verbatim, add `target?: WorkspaceInfo` parameter | exact (move-and-extend) |
| `package.json` | modified | config (VS Code contribution points) | n/a | self — existing `view/item/context` entries (`:351-407`) + existing `commands` whitelist; new `contributes.submenus` is a fresh contribution point with one new shape | role-match (no prior submenu in this repo; VS Code docs are the reference per RESEARCH §2.1) |

---

## Pattern Assignments

### `src/extension.ts` (controller — modified for D-02, D-08, D-15, D-17)

**Self-analog:** the file already contains the three patterns we need to generalize.

#### Pattern 1 — Workspace-targeted token + endpoint resolution (D-02)

**Source of truth — copy this shape into `prepareRun`:** `src/remoteExecution.ts:99-155` (Block A). It is the *only* place in the codebase today that correctly resolves a workspace-targeted token + apiServiceUrl when the active workspace doesn't match.

```typescript
// remoteExecution.ts:99-155 — REFERENCE IMPLEMENTATION for D-02 plumbing
let ws: WorkspaceInfo | undefined = getSelectedWorkspace(args.context);
if (!ws || ws.workspaceId !== args.workspaceId) {
    // Fall back to a fresh listWorkspaces — rare path (editor-title
    // button pressed against a script whose workspace is not the
    // currently selected one).
    try {
        const baseToken = await getBaseAccessToken(args.context, cfg);
        if (!baseToken) {
            vscode.window.showErrorMessage('Altium 365: ... not signed in.');
            return undefined;
        }
        const list = await listWorkspaces(args.envGlobalEndpoint, baseToken);
        ws = list.find((w) => w.workspaceId === args.workspaceId);
    } catch (e) { /* surface + return undefined */ }
}
if (!ws) { /* surface "workspace not found" + return undefined */ }

let wsToken: string;
try {
    wsToken = await ensureWorkspaceToken(args.context, cfg, {
        workspaceId: args.workspaceId,
        authId: args.workspaceAuthId || ws.authId,
    });
} catch (e) { /* surface + return */ }
const apiUrl = getWorkspaceApiUrl(ws, args.envGlobalEndpoint);
```

**Current `prepareRun` site that must change** (`extension.ts:660-668`):

```typescript
// CURRENT — reads ACTIVE workspace unconditionally
const endpoint = getWorkspaceApiUrl(getSelectedWorkspace(context), envGlobalEndpoint);

const oauthCfg = readOAuthConfig();
let token = await getActiveAccessToken(context, oauthCfg);
```

**Refactor (D-02):** add an optional `target?: { workspaceId: string; workspaceAuthId: string }` parameter to `prepareRun` / `runScriptAtPath` / `debugScriptAtPath`. When `target` is provided, mirror remoteExecution.ts Block A verbatim (workspace lookup + `ensureWorkspaceToken({workspaceId: target.workspaceId, authId: target.workspaceAuthId})` + `getWorkspaceApiUrl(resolvedWs, envGlobalEndpoint)`). When `target` is undefined, keep the current active-workspace path (D-03 fallback).

**Export signature shape:**
```typescript
// extension.ts:533-560 — extend export signature
export async function runScriptAtPath(
    context: vscode.ExtensionContext,
    scriptPath: string,
    target?: { workspaceId: string; workspaceAuthId: string },  // NEW
): Promise<void> {
    const prep = await prepareRun(context, scriptPath, target);
    ...
}
```

**Landmine — workspaceName plumbing (RESEARCH §5.4):** when `target` is provided, also resolve `ws.name` from the same `listWorkspaces` fallback and include it in OutputChannel header lines (`extension.ts:544-545`):

```typescript
// CURRENT (extension.ts:544-545)
outputChannel.appendLine(`\n[Altium 365] Running ${resolvedPath}`);
outputChannel.appendLine(`[Altium 365] Endpoint: ${endpoint}`);
// AFTER D-02 — add workspace name when target is set
outputChannel.appendLine(`[Altium 365] Workspace: ${resolvedWs.name}`);  // NEW
```

#### Pattern 2 — `setContext` listener registered into `context.subscriptions` (D-15)

**Source-of-truth analog:** `updateSignedInContext` (`extension.ts:27-34`) + its activation seed (`extension.ts:151` — `void updateSignedInContext(context)`) + the onAuthStateChanged subscription (`extension.ts:126-129`). Same exact shape applies for `altium365.activeIsRemoteScript`.

```typescript
// extension.ts:27-34 — PATTERN to copy for D-15
async function updateSignedInContext(context: vscode.ExtensionContext): Promise<void> {
    try {
        const tok = await getStoredTokens(context);
        await vscode.commands.executeCommand('setContext', 'altium365.signedIn', !!tok);
    } catch {
        // best-effort — worst case is welcome view stays visible (recoverable)
    }
}
```

**D-15 implementation (drop into `activate`):**

```typescript
import { getLocalScript } from './localScriptCache';

function updateActiveRemoteContext(editor: vscode.TextEditor | undefined) {
    const isRemote = editor?.document.uri.scheme === 'file'
        && getLocalScript(editor.document.uri.fsPath) != null;
    void vscode.commands.executeCommand(
        'setContext', 'altium365.activeIsRemoteScript', !!isRemote);
}

// inside activate(), BEFORE registering listener:
updateActiveRemoteContext(vscode.window.activeTextEditor);  // SEED — RESEARCH §2.2
context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateActiveRemoteContext),
);
```

Add the disposable next to `onAuthStateChanged(...)` (`extension.ts:126-129`) — same `context.subscriptions.push(...)` block.

#### Pattern 3 — Node-less command handler that resolves identity from active editor (D-17)

**Source-of-truth analog:** `resolveScriptContext` in `scriptCommands.ts:118-171` already implements the exact "no node? fall back to active editor's fsPath → cache lookup → identity" pattern. The runLocal / debugLocal handlers already pass `node?: A365Node`; `resolveScriptContext` returns identity from either. No new node-less handler code is needed beyond making sure callers pass `undefined` when invoked from the submenu.

```typescript
// scriptCommands.ts:118-171 — PATTERN already correct for D-17 node-less path
function resolveScriptContext(
    context: vscode.ExtensionContext,
    node?: A365Node
): ScriptContext | undefined {
    if (node && node.kind === 'script') {
        return { ... };  // tree-driven path
    }
    const active = vscode.window.activeTextEditor?.document.uri;
    if (!active) return undefined;
    if (active.scheme === 'file') {
        const identity = getLocalScript(active.fsPath);   // <-- cache hit
        if (identity) { return { ... }; }
    }
    // Legacy altium365: URI fallback
    try { const parsed = parseScriptUri(active); ... } catch { return undefined; }
}
```

**What's missing for D-03/D-17:** when both `node` is undefined AND the active editor's fsPath is NOT in `localScriptCache` (standalone .py), `resolveScriptContext` returns `undefined` today. For D-17 we need `runLocalFromScriptNode` / `debugLocalFromScriptNode` to instead fall through to `runScriptAtPath(context, fsPath)` with no target (active-workspace fallback per D-03). The branch lives in the caller, not `resolveScriptContext`.

Suggested shape:
```typescript
// scriptCommands.ts:289 (runLocalFromScriptNode) — add standalone-.py fallback
async function runLocalFromScriptNode(...) {
    if (!node) {
        const active = vscode.window.activeTextEditor?.document.uri;
        if (active?.scheme === 'file' && !getLocalScript(active.fsPath)) {
            // standalone .py — defer entirely to the palette path (D-03)
            return runScriptAtPath(context, active.fsPath);  // no target
        }
    }
    // existing path: download via FSP and pass target
    const tmpPath = await downloadScriptToTmp(context, output, node, 'Run Script (Local)');
    if (!tmpPath) return;
    const sc = resolveScriptContext(context, node);  // re-derive for target
    await runScriptAtPath(context, tmpPath, sc ? {
        workspaceId: sc.workspaceId,
        workspaceAuthId: sc.workspaceAuthId,
    } : undefined);
}
```

---

### `src/scriptCommands.ts` (controller — modified for D-02 target plumbing, D-10..D-12 tmp path)

#### Pattern 1 — Pass target into `runScriptAtPath` / `debugScriptAtPath`

**Current calls** (`scriptCommands.ts:298, :330`):
```typescript
await runScriptAtPath(context, tmpPath);   // line 298
await debugScriptAtPath(context, tmpPath); // line 330
```

**After D-02:** resolve `sc = resolveScriptContext(context, node)` BEFORE the download (already done inside `downloadScriptToTmp` — hoist it or re-call after), then:
```typescript
await runScriptAtPath(context, tmpPath, {
    workspaceId: sc.workspaceId,
    workspaceAuthId: sc.workspaceAuthId,
});
```

#### Pattern 2 — New tmp path builder (D-09 GRID, D-10 nested layout, D-12 mkdirSync)

**Current tmp-path code to REPLACE** (`scriptCommands.ts:361-369`):
```typescript
const safeBase = sc.scriptName.replace(/[^\w.-]+/g, '_') || 'script.py';
const baseWithExt = safeBase.toLowerCase().endsWith('.py')
    ? safeBase
    : `${safeBase}.py`;
tmpPath = path.join(
    os.tmpdir(),
    `altium365-${sc.scriptId}-${baseWithExt}`
);
await fs.writeFile(tmpPath, bytes);
```

**New shape per D-09/D-10/D-12:**
```typescript
// Altium platform GRID format (D-09): grid:workspace:{authId}:scripts:script/{scriptId}
// We embed the GRID identity into the on-disk layout so the tab title can be the
// readable script name while collisions across workspaces are impossible.
const safeBase = sc.scriptName.replace(/[^\w.-]+/g, '_') || 'script';
const fileName = safeBase.toLowerCase().endsWith('.py') ? safeBase : `${safeBase}.py`;
const dir = path.join(os.tmpdir(), 'altium365', sc.workspaceAuthId, sc.scriptId);
await fs.mkdir(dir, { recursive: true });   // D-12
tmpPath = path.join(dir, fileName);
await fs.writeFile(tmpPath, bytes);
```

**Cache registration shape — UNCHANGED** (`scriptCommands.ts:373-377`):
```typescript
registerLocalScript(tmpPath, {
    workspaceAuthId: sc.workspaceAuthId,
    scriptId: sc.scriptId,
    scriptName: sc.scriptName,
});
```
The cache is fsPath-agnostic — RESEARCH §2.4 confirmed nested paths just work. No `localScriptCache.ts` change.

#### Pattern 3 — `withScriptProgress` wrap stays as-is

The whole `downloadScriptToTmp` body is already wrapped in `withScriptProgress` (`scriptCommands.ts:353-413`). New code inside the body inherits cancellation + progress UI for free. **Do NOT add a nested wrap** (D-22).

---

### `src/remoteExecution.ts` (service — modified for D-05, D-06, D-08, §5.4 workspaceName fix)

#### Pattern 1 — Insert projectId-prompt fallback in Block B

**Current Block B** (`remoteExecution.ts:157-160`):
```typescript
// ----- Block B: parameters (D-05) -----
const parameters = resolveScriptParameters(args.context, args.scriptId);
return { ws, wsToken, apiUrl, parameters };
```

**After D-06 (insert BEFORE the return, INSIDE the `withScriptProgress` wrapper):**
```typescript
// ----- Block B: parameters (D-05 + Phase 6 D-06 projectId-prompt bridge) -----
let parameters = resolveScriptParameters(args.context, args.scriptId);

// D-06: if no per-script params AND user opted into the prompt,
// fall through to pickProjectId with the SCRIPT'S workspace target.
if (parameters === undefined) {
    const wcfg = vscode.workspace.getConfiguration('altium365');
    if (wcfg.get<boolean>('promptForProjectId', true)) {
        const lastKey = `altium365.lastProjectId.${args.workspaceId}`;
        const last = args.context.globalState.get<string>(lastKey, '');
        const picked = await pickProjectId(
            args.context, apiUrl, wsToken, last, ws,   // ws is the target (D-08)
        );
        if (picked === undefined) return undefined;    // user cancelled
        if (picked) {
            await args.context.globalState.update(lastKey, picked);
            parameters = [{ key: 'projectId', value: picked }];
        }
    }
}

return { ws, wsToken, apiUrl, parameters };
```

**Critical (RESEARCH §2.7):** placement is INSIDE the existing `withScriptProgress` wrapper (line 96-163) — no extra wrap (D-22). A cancel of the spinner mid-prompt aborts the whole flow.

#### Pattern 2 — `pickProjectId` import path

After the §6 recommendation (extract to `src/projectPicker.ts`):
```typescript
import { pickProjectId } from './projectPicker';
```

#### Pattern 3 — Reference shape: same params-array shape as before

`resolveScriptParameters` already returns `Array<{ key: string; value: string }>` (`remoteExecution.ts:237`). D-06's prompt path returns `[{ key: 'projectId', value: picked }]` — same shape, no downstream change in `executeScript` (`remoteExecution.ts:182`).

#### Pattern 4 — §5.4 workspaceName fix

Block A already resolves `ws: WorkspaceInfo` (`remoteExecution.ts:101-126`) which has `.name`. The header at `:175-177` uses `args.workspaceName` instead. **Fix:** overwrite `args.workspaceName = ws.name` after the lookup so cross-workspace runs no longer print `<workspace-name unknown>`.

```typescript
// Inside Block A, AFTER ws is resolved:
if (ws.name && ws.name !== args.workspaceName) {
    args.workspaceName = ws.name;   // §5.4 fix — better header
}
```

---

### `src/sidePanel.ts` (provider — modified for D-19)

**Sibling-arm analog (same file, exact shape needed):** `case 'error'` at `sidePanel.ts:191-203` already attaches `item.command` to a TreeItem. Copy that shape into `case 'script'` (`:173-182`).

```typescript
// sidePanel.ts:197-201 — REFERENCE shape (case 'error')
item.command = {
    command: 'altium365.tree.retryNode',
    title: 'Retry',
    arguments: [n],
};
```

**D-19 insertion in `case 'script'` (`sidePanel.ts:173-182`):**

```typescript
// CURRENT (lines 173-182):
case 'script': {
    const item = new vscode.TreeItem(
        n.script.name,
        vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = CTX_SCRIPT;
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.tooltip = n.script.description ?? n.script.name;
    return item;
}

// AFTER D-19 — add item.command BEFORE return:
case 'script': {
    const item = new vscode.TreeItem(
        n.script.name,
        vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = CTX_SCRIPT;
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.tooltip = n.script.description ?? n.script.name;
    item.command = {                            // NEW — D-19
        command: 'altium365.script.edit',
        title: 'Edit Script',
        arguments: [n],
    };
    return item;
}
```

---

### `src/projectPicker.ts` (utility — NEW per RESEARCH §6 recommendation)

**Source-of-truth analog:** extract verbatim from `extension.ts:773-852` (current `pickProjectId`). Add `target?: WorkspaceInfo` parameter per D-08.

```typescript
import * as vscode from 'vscode';
import { listProjects, getSelectedWorkspace, WorkspaceInfo } from './workspace';

/**
 * Prompts the user to pick a projectId. Returns:
 *   - the picked id (string, possibly empty if user chose "no parameters")
 *   - undefined if the user cancelled
 *
 * D-08: when `target` is provided, the placeholder text + project-list lookup
 * use that workspace's name; otherwise we read the active workspace (legacy
 * `prepareRun` callers).
 *
 * Extracted from extension.ts in Phase 6 to break a circular import risk
 * (remoteExecution → extension → remoteExecution) and to keep extension.ts
 * under the 500-line soft cap (AGENTS.md).
 */
export async function pickProjectId(
    context: vscode.ExtensionContext,
    endpoint: string,
    accessToken: string,
    last: string,
    target?: WorkspaceInfo,   // NEW (D-08)
): Promise<string | undefined> {
    type Item = vscode.QuickPickItem & { value?: string; manual?: boolean };
    const wsName = (target ?? getSelectedWorkspace(context))?.name || '-';

    const projects = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Loading projects from "${wsName}"...`,
        },
        async () => {
            try {
                return await listProjects(endpoint, accessToken);
            } catch (e) {
                // Caller's outputChannel is not in scope here — surface via console
                // (the parent flow already wraps this in withScriptProgress).
                return undefined;
            }
        }
    );

    // ... rest unchanged from extension.ts:799-851 ...
}
```

**Key differences from the original `extension.ts:773-852`:**
1. New parameter `target?: WorkspaceInfo`.
2. Line 780 changes from `getSelectedWorkspace(context)?.name || '-'` to `(target ?? getSelectedWorkspace(context))?.name || '-'`.
3. The `outputChannel.appendLine(...)` call at the original line 791-793 needs replacing — `outputChannel` is module-scoped in `extension.ts`. Options:
   - Pass an optional `output?: vscode.OutputChannel` parameter.
   - Or drop the log (catch handler already falls through to the manual-input fallback — UX-equivalent).
   - Recommend: add `output?: vscode.OutputChannel` as the 6th parameter; both call sites pass theirs.

**Caller migration:**
```typescript
// extension.ts:717 (prepareRun) — no behavioral change
const picked = await pickProjectId(context, endpoint, token!, last);   // target undefined → reads active ws

// remoteExecution.ts (D-06 new call site) — passes target
const picked = await pickProjectId(args.context, apiUrl, wsToken, last, ws, args.output);
```

---

### `package.json` (config — modified for D-13..D-18)

#### Pattern 1 — Existing whitelist + command shape stays (no analog needed)

The five `altium365.script.*` commands at `package.json:89-112` stay as-is. They already have `category: "Altium 365"` (palette eligibility per Phase 4 D-02 — RESEARCH §5.3). Do NOT add `"when": "false"` to their palette entries — they need to remain palette-invocable.

#### Pattern 2 — NEW `contributes.submenus` (no in-repo analog; VS Code docs are source — RESEARCH §2.1)

```jsonc
"contributes": {
  // ... existing keys ...
  "submenus": [
    {
      "id": "altium365.editorTitle",
      "label": "Altium 365",
      "icon": {
        "light": "media/altium365.png",
        "dark":  "media/altium365.png"
      }
    }
  ],
  "menus": {
    // ... existing keys ...
    "editor/title": [
      {
        "submenu": "altium365.editorTitle",
        "group": "navigation@1",
        "when": "resourceLangId == python"
      }
    ],
    "altium365.editorTitle": [
      { "command": "altium365.script.runLocal",
        "group": "1_run@1",
        "when": "resourceLangId == python" },
      { "command": "altium365.script.debugLocal",
        "group": "1_run@2",
        "when": "resourceLangId == python" },
      { "command": "altium365.script.executeRemote",
        "group": "2_remote@1",
        "when": "resourceLangId == python && altium365.activeIsRemoteScript" },
      { "command": "altium365.script.publish",
        "group": "3_publish@1",
        "when": "resourceLangId == python && altium365.activeIsRemoteScript" }
    ]
  }
}
```

#### Pattern 3 — REMOVALS

| Lines | What | Why |
|-------|------|-----|
| `package.json:297-313` | Three flat `editor/title` entries (publish / executeRemote / debugScript with `resourceFilename =~ /^altium365-/`) | D-13 — replaced by single submenu button. D-16 — the regex is invalidated by the new tmp layout anyway. |
| `package.json:372-376` | The `altium365.script.publish` entry inside `view/item/context` | D-18 — Cmd+S already publishes via save bridge; redundant. |

**Group renumbering after publish removal:** The `view/item/context` group `2_edit@2` (publish, removed) leaves `2_edit@1` (edit) alone in group `2_edit`. Optionally renumber `edit` to `2_edit@1` (already is). No reflow needed.

#### Pattern 4 — `editor/title/run` + `explorer/context` untouched

The two `altium365.runScript` / `altium365.debugScript` entries at `:314-337` are palette-style commands gated on `resourceLangId == python` — they remain (they're the `.py`-targeted run/debug, orthogonal to the submenu).

---

## Shared Patterns

### Workspace-targeted GraphQL setup (used by D-02, D-06, D-08)

**Single source of truth:** `remoteExecution.ts:99-155` — the three-step incantation `getSelectedWorkspace(ctx) ?? listWorkspaces(...).find` → `ensureWorkspaceToken({workspaceId, authId})` → `getWorkspaceApiUrl(ws, envGlobalEndpoint)`.

**Apply to:** any new code in `extension.ts` (prepareRun target branch), `remoteExecution.ts` (already correct), `projectPicker.ts` (callers already pass `endpoint` + `accessToken` pre-resolved — `pickProjectId` itself stays decoupled from token resolution).

**Anti-pattern to avoid:** do NOT call `getActiveAccessToken` (`auth.ts:587-600`) when a workspace target is supplied — it implicitly reads the active workspace and would defeat D-01's "transparent token, no active-workspace switch."

### Cancellable async with progress UI (used by D-06 prompt, downloadScriptToTmp)

**Source:** `withScriptProgress` (`src/progress.ts`, Phase 5 D-05). Already wraps `executeRemoteScript` Block A/B (`remoteExecution.ts:96-163`) and `downloadScriptToTmp` body (`scriptCommands.ts:353-413`).

**Apply to:** D-06's new `pickProjectId` call inside Block B (already inside the wrap — no extra needed). New tmp-path mkdirSync (already inside the wrap).

**Anti-pattern:** D-22 says "no extra wrap needed" — do not double-wrap.

### Command boundary error handling (used by every command handler)

**Source:** `scriptCommands.ts:100-116` (`mapGraphQLErrorToUserMessage`) + the try/catch shape at `scriptCommands.ts:385-398`:

```typescript
} catch (e) {
    const err = e as Error & { code?: string };
    const code = (err as { code?: string }).code;
    const userMsg = mapGraphQLErrorToUserMessage(code, err.message);
    output.appendLine(`[Altium 365] ${actionLabel} failed: ` + err.message
        + (code ? ' (code=' + code + ')' : ''));
    if (err.stack) output.appendLine(err.stack);
    vscode.window.showErrorMessage('Altium 365: ' + userMsg);
    return undefined;
}
```

**Apply to:** any new error site in this phase (e.g. `pickProjectId` failure inside `executeRemoteScript` Block B if added).

### Context-key gating for menu visibility (used by D-15)

**Source:** `extension.ts:27-34` + activation seed at `:151` — `setContext('altium365.signedIn', ...)`. Used by `package.json:42` welcome view (`"when": "!altium365.signedIn"`).

**Apply to:** D-15's `altium365.activeIsRemoteScript` — identical mechanism, new key, new listener (`onDidChangeActiveTextEditor` instead of `onAuthStateChanged`).

---

## No Analog Found

All six files have at least one strong in-repo analog. The `contributes.submenus` block in `package.json` is the only contribution point not previously used in this repo; the planner should cite VS Code's official docs (RESEARCH §2.1, §7) rather than an in-repo example.

---

## Metadata

**Analog search scope:** `src/extension.ts`, `src/scriptCommands.ts`, `src/remoteExecution.ts`, `src/sidePanel.ts`, `src/localScriptCache.ts`, `package.json` (all read in full).
**Files scanned:** 6
**Pattern extraction date:** 2026-05-22

## PATTERN MAPPING COMPLETE

**Phase:** 06 - Script Execution UX & Unified Parameters
**Files classified:** 6
**Analogs found:** 6 / 6

### Coverage
- Files with exact analog (self-pattern in same file or sibling switch arm): 5 (`extension.ts`, `scriptCommands.ts`, `remoteExecution.ts`, `sidePanel.ts`, `projectPicker.ts` — extracted verbatim)
- Files with role-match analog (in-repo precedent for the role but new contribution shape): 1 (`package.json` submenus — VS Code docs supplement)
- Files with no analog: 0

### Key Patterns Identified
- **Workspace-targeted setup is already correctly implemented once** — in `remoteExecution.ts:99-155` (Block A). D-02's job is to generalize that exact shape into `prepareRun` rather than invent a new pattern.
- **`setContext` + activation-seed + listener pattern already exists** for `altium365.signedIn` (`extension.ts:27-34, :126-129, :151`). D-15 is a direct copy with a different key and a different event source.
- **`TreeItem.command` is already used in this file** at `sidePanel.ts:197-201` (`case 'error'`). D-19 is a 5-line copy into `case 'script'`.
- **`pickProjectId` has exactly one caller** (`extension.ts:717`); extraction to `src/projectPicker.ts` is a verbatim move + one new optional parameter (RESEARCH §2.6).
- **Tmp path builder is a single chokepoint** (`scriptCommands.ts:361-369`); D-10's nested-layout rewrite is local and trivial.
- **`contributes.submenus` has no in-repo precedent** — `package.json` work follows VS Code's official docs (RESEARCH §2.1); icon path reuses the already-shipped `media/altium365.png`.

### File Created
`.planning/phases/06-script-execution-ux-and-unified-params/06-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files. Recommended plan-to-pattern mapping:
- **Plan 1 (Quick Wins):** sidePanel.ts D-19 (1-line copy from `case 'error'`); package.json D-18 removal; scriptCommands.ts D-10..D-12 tmp-path rewrite.
- **Plan 2 (Title-bar UX):** package.json D-13..D-18 submenu block; extension.ts D-15 setContext listener (copy `updateSignedInContext` shape); scriptCommands.ts D-17 standalone-.py fallback.
- **Plan 3 (Execution Correctness):** extract `src/projectPicker.ts`; extension.ts D-02 plumbing (mirror remoteExecution.ts:99-155); remoteExecution.ts D-06 Block B insertion + §5.4 workspaceName fix.
