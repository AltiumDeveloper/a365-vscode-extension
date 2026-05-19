# Phase 2: Side Panel - Research

**Researched:** 2026-05-19
**Domain:** VS Code Extension UI (TreeDataProvider + status bar) + Altium 365 GraphQL `gloScrScripts`
**Confidence:** HIGH for VS Code APIs (Context7 + official docs); HIGH for `gloScrScripts` schema (verified against published Altium platform-api-docs); MEDIUM for D-09 script-body fetch path (schema reveals a `fileToken` indirection that CONTEXT.md did not anticipate — flagged below).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Root nodes = all workspaces from `listWorkspaces()`. Per-workspace token exchanged lazily on first expand, cached in `context.secrets` keyed by workspace id.
- **D-02:** Workspaces eager on view open; projects + scripts lazy on expansion. In-memory cache only — no disk persistence.
- **D-03:** Manual refresh via title-bar icon; clears in-memory cache and re-fetches visible level.
- **D-04:** Status bar item `A365: <user> • <env>` when signed in; click opens QuickPick with Sign Out / Switch Environment / Switch Workspace.
- **D-05:** Signed-out state uses `viewsWelcome` with a Sign In button running `altium365.signIn`.
- **D-06:** Zero-workspace account → single informational tree item.
- **D-07:** Network/auth failure during fetch → inline error tree item, re-runs on click; detail to `outputChannel`; no toast.
- **D-08:** All four `altium365.script.*` commands + context menu wired in `package.json` now; only `runLocal` fully implemented; the other three show "Coming in Phase 3" `showInformationMessage`.
- **D-09:** Run-local flow = fetch script body via `gloScrScripts`, write to `os.tmpdir()` as `.py`, invoke existing `python/_runner.py` pipeline, clean up temp file when execution completes.

### Agent's Discretion
- Activity Bar `viewsContainer` icon (Codicon or contributed SVG that pairs with `resources/icon.png`).
- TreeItem `contextValue` strings (`workspaceNode`, `projectNode`, `scriptNode` recommended).
- Whether scripts are fetched per-project or per-workspace — research below resolves this against the actual schema.

### Deferred Ideas (OUT OF SCOPE)
- Remote script edit/execute/publish business logic (Phase 3 owns).
- Disk-persisted tree cache across sessions.
- Phase 1 carry-forward items (LICENSE file, ci.yml hardening) — tracked in `01-REVIEW.md`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PANEL-01 | Activity Bar entry point opens the A365 side panel | `contributes.viewsContainers.activitybar` + `contributes.views.<container-id>` (Standard Stack §1) |
| PANEL-02 | Side panel shows workspaces at top level | `TreeDataProvider.getChildren(undefined)` returns workspace nodes from `listWorkspaces()` (Pattern 1) |
| PANEL-03 | Each workspace expands to show its projects | Lazy `getChildren(workspaceNode)` calls `listProjects()` after per-workspace token exchange (Pattern 1) |
| PANEL-04 | Each workspace expands to show its scripts (sibling to projects) | `listScripts(workspaceToken, workspaceUrl)` via `gloScrScripts` — **workspace-scoped, NOT project-scoped** (Schema Finding §1) |
| PANEL-05 | Scripts have 4 context menu actions | `contributes.menus["view/item/context"]` with `when: viewItem == scriptNode` + group ordering (Pattern 2) |
| PANEL-06 | Auth status visible in status bar | `vscode.window.createStatusBarItem` with click command opening QuickPick (Pattern 3) |
| SCRIPT-01 | List all scripts in selected workspace via `gloScrScripts` | Query verified (Schema Finding §1); cursor pagination available but a single 100-item page is sufficient for v1 |
</phase_requirements>

## Summary

VS Code's `TreeDataProvider<T>` + `EventEmitter`-driven refresh is the well-trodden path for hierarchical side panels and is the only correct pattern here — do not roll a webview. The Activity Bar entry point requires three coordinated `contributes` blocks (`viewsContainers`, `views`, `viewsWelcome`); missing any one of them produces a silently empty container.

The phase's only real research surprise is in the GraphQL schema: `gloScrScripts` is **workspace-scoped, not project-scoped** (no `projectId` argument), which (a) confirms PANEL-04's "scripts as sibling to projects" decision and (b) invalidates the speculative `listScripts(workspaceToken, workspaceUrl, projectId)` signature sketched in CONTEXT.md line 90. More importantly, the script body is **not** returned inline by GraphQL — `GloScrScriptVersion.package` returns `GloScrScriptPackage { fileToken: String! }`, meaning D-09 needs a two-step fetch (GraphQL for the fileToken, then a separate HTTP file-download using that token). This gap must be resolved in planning before D-09 can be implemented; the planner should flag a checkpoint to confirm the file-download endpoint with the human.

**Primary recommendation:** Implement a single `A365TreeDataProvider implements vscode.TreeDataProvider<A365Node>` in a new `src/sidePanel.ts`, where `A365Node` is a discriminated union (`workspace | project | script | error | info`); drive refresh through one `EventEmitter<A365Node | undefined>`; cache per-workspace tokens under secrets key `altium365.workspaceTokens.<workspaceId>`; and resolve the D-09 fileToken question with the human before writing the run-local task.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tree rendering & lazy expansion | VS Code Extension Host (UI) | — | TreeDataProvider runs in the extension host; only VS Code can render TreeView UI |
| Workspace/project/script data fetch | Extension Host (network client) | A365 GraphQL API | Existing `graphqlRequest` pattern in `src/workspace.ts` |
| Token exchange & caching | Extension Host (auth) | VS Code SecretStorage | D-01 mandates `context.secrets`; never plaintext |
| Status bar lifecycle | Extension Host (UI) | — | `vscode.window.createStatusBarItem` is extension-host-only |
| Script body retrieval (D-09) | Extension Host (network client) | A365 GraphQL + A365 file storage | Two-step: GraphQL `fileToken` → HTTP file download (see §Schema Finding 2) |
| Local script execution | Node subprocess (Python runtime) | Filesystem (`os.tmpdir()`) | Reuse existing `python/_runner.py` pipeline verbatim — no change to subprocess tier |

## Standard Stack

### Core
| Library / API | Version | Purpose | Why Standard |
|---|---|---|---|
| `vscode.window.createTreeView` / `registerTreeDataProvider` | API ≥1.85.0 | Side panel tree rendering | Only supported way to render an Activity Bar tree [CITED: code.visualstudio.com/api/extension-guides/tree-view] |
| `vscode.EventEmitter<T \| undefined \| void>` | API ≥1.85.0 | Drives `onDidChangeTreeData` for refresh | Documented refresh pattern in the official tree-view sample [CITED: code.visualstudio.com/api/extension-guides/tree-view#updating-tree-view-content] |
| `vscode.window.createStatusBarItem` | API ≥1.85.0 | Status bar item for D-04 | Standard API; `command` field makes clicks trivial [CITED: code.visualstudio.com/api/references/vscode-api#StatusBarItem] |
| `vscode.window.showQuickPick` | API ≥1.85.0 | Sign Out / Switch Env / Switch Workspace menu | Standard API [CITED: code.visualstudio.com/api/references/vscode-api#window.showQuickPick] |
| `context.secrets` (SecretStorage) | API ≥1.85.0 | Per-workspace token cache (D-01) | Only API approved by AGENTS.md for token storage |

### Supporting
| Library / API | Version | Purpose | When to Use |
|---|---|---|---|
| `vscode.ThemeIcon` | API ≥1.85.0 | Tree node icons (e.g. `new ThemeIcon('folder')`, `'file-code'`) | All tree nodes — avoids shipping custom SVGs |
| `vscode.TreeItem.contextValue` | API ≥1.85.0 | Gates `view/item/context` menus | Required by D-08 menu wiring |
| `package.json contributes.viewsWelcome` | VS Code ≥1.45 | Signed-out state (D-05) | Native empty-state UX; renders a button that runs a command |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| `TreeDataProvider` | Custom Webview | Webviews are heavier, require manual theming, lose Activity Bar polish — wrong tool for hierarchical data |
| In-memory Map cache | `context.workspaceState` / `globalState` | Disk persistence is **explicitly out of scope** (CONTEXT.md Deferred) |
| New SVG icon | Codicon (e.g. `circuit-board`, `chip`, `symbol-event`) | Codicons require no asset shipping and auto-theme; recommended unless the brand demands a custom mark |

**No npm install required** — every dependency for this phase is part of the `vscode` API surface already in `package.json`. The Package Legitimacy Audit section is therefore N/A.

## Package Legitimacy Audit

**Not applicable.** Phase 2 introduces no new npm dependencies; all functionality is built against the `vscode` API (already declared via `engines.vscode: ^1.85.0` and `@types/vscode`) and the existing internal modules (`src/workspace.ts`, `src/auth.ts`).

## Architecture Patterns

### System Architecture Diagram

```
                                            ┌──────────────────────┐
  Sign-in state change ────────────────────▶│ Status Bar Item      │
  (auth.ts events)                          │  A365: user • env    │
                                            │  onClick → QuickPick │
                                            └──────────────────────┘

  Activity Bar icon click
         │
         ▼
  ┌─────────────────────────┐    onDidChangeTreeData    ┌──────────────────┐
  │ A365 TreeView           │◀──────────────────────────│ EventEmitter     │
  │ (viewsContainer + view) │                           │ (refresh signal) │
  └────────────┬────────────┘                           └────────▲─────────┘
               │ getChildren(element)                            │
               ▼                                                 │
  ┌─────────────────────────┐                                    │
  │ A365TreeDataProvider    │                                    │
  │  - in-mem cache         │────── refresh() ───────────────────┘
  │  - error nodes (D-07)   │
  └────────┬────────────────┘
           │
   element │ undefined ─────▶ listWorkspaces(baseToken) ─────────▶ GraphQL /api
           │ workspace ─────▶ ensureWorkspaceToken(ws)  ─────────▶ Token Exchange
           │                  ├─ secrets[altium365.workspaceTokens.<id>]
           │                  └─ then listProjects + listScripts ▶ GraphQL /api
           │ project   ─────▶ (leaf: no children in Phase 2)
           │ script    ─────▶ (leaf: contextValue=scriptNode)
           ▼
  ┌─────────────────────────┐
  │ Right-click on script   │
  │  view/item/context menu │
  │  when viewItem==script  │
  └────────┬────────────────┘
           │
           ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ altium365.script.runLocal (D-09)                            │
  │  1. GraphQL: gloScrScript(id) → versions[0].package.fileToken│  ◀── ⚠ two-step
  │  2. HTTP GET (fileToken) → script bytes                     │      (see Schema
  │  3. fs.writeFileSync(os.tmpdir()/<id>.py)                   │       Finding §2)
  │  4. spawn python/_runner.py (existing pipeline)             │
  │  5. on exit: fs.unlinkSync(tmpPath) — try/finally           │
  └─────────────────────────────────────────────────────────────┘

  altium365.script.{edit,executeRemote,publish}
   └─▶ Phase 2 stub: vscode.window.showInformationMessage("Coming in Phase 3")
```

### Recommended Project Structure

```
src/
├── extension.ts       # activate(): register view, status bar, 4 script commands
├── auth.ts            # (existing) + add getActiveUserLabel(), event emitter for auth changes
├── workspace.ts       # (existing) + add listScripts(workspaceToken, workspaceUrl)
├── sidePanel.ts       # NEW — A365TreeDataProvider, A365Node union, refresh()
└── statusBar.ts       # NEW — createStatusBarItem + onClick QuickPick wiring

package.json contributes additions:
  viewsContainers.activitybar  → { id: "altium365", title: "Altium 365", icon: "..." }
  views.altium365              → [{ id: "altium365.tree", name: "Workspaces" }]
  viewsWelcome                 → [{ view: "altium365.tree", contents: "[Sign In](...)..."}]
  commands                     → 4 × altium365.script.* + altium365.tree.refresh
  menus["view/title"]          → [{ command: "altium365.tree.refresh", when: "view==altium365.tree", group: "navigation" }]
  menus["view/item/context"]   → 4 × { command: "altium365.script.*", when: "view==altium365.tree && viewItem==scriptNode", group: "..." }
```

### Pattern 1: TreeDataProvider with EventEmitter refresh (D-02 / D-03)

**What:** Single class implements `vscode.TreeDataProvider<T>`. A private `EventEmitter` fires from `refresh()` to invalidate cached subtrees.

**When to use:** Every Activity Bar tree, including signed-out and error states (D-05/D-07 are rendered as TreeItems, not as separate views).

```typescript
// Source: https://code.visualstudio.com/api/extension-guides/tree-view#updating-tree-view-content
type A365Node =
  | { kind: 'workspace'; id: string; name: string; authId: string; url: string }
  | { kind: 'project';   workspaceId: string; id: string; name: string }
  | { kind: 'script';    workspaceId: string; scriptId: string; name: string }
  | { kind: 'info';      label: string }
  | { kind: 'error';     label: string; retry: () => void };

export class A365TreeDataProvider implements vscode.TreeDataProvider<A365Node> {
  private _onDidChange = new vscode.EventEmitter<A365Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  // In-memory cache (D-02). Cleared on refresh() (D-03).
  private workspaces?: A365Node[];
  private childrenCache = new Map<string, A365Node[]>(); // key: workspaceId or workspaceId+":"+projectId

  constructor(private ctx: vscode.ExtensionContext) {}

  refresh(node?: A365Node) {
    if (!node) { this.workspaces = undefined; this.childrenCache.clear(); }
    this._onDidChange.fire(node);
  }

  getTreeItem(n: A365Node): vscode.TreeItem {
    switch (n.kind) {
      case 'workspace': {
        const t = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.Collapsed);
        t.contextValue = 'workspaceNode';
        t.iconPath = new vscode.ThemeIcon('cloud');
        return t;
      }
      case 'project': {
        const t = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.None);
        t.contextValue = 'projectNode';
        t.iconPath = new vscode.ThemeIcon('folder');
        return t;
      }
      case 'script': {
        const t = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.None);
        t.contextValue = 'scriptNode';                              // ← D-08 menu key
        t.iconPath = new vscode.ThemeIcon('file-code');
        return t;
      }
      case 'info': {
        const t = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
        t.iconPath = new vscode.ThemeIcon('info');
        return t;
      }
      case 'error': {
        const t = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
        t.iconPath = new vscode.ThemeIcon('error');
        t.command = { command: 'altium365.tree.retryNode', title: 'Retry', arguments: [n] };
        return t;
      }
    }
  }

  async getChildren(element?: A365Node): Promise<A365Node[]> {
    try {
      if (!element) return await this.loadWorkspaces();          // D-02 eager
      if (element.kind === 'workspace') return await this.loadWorkspaceChildren(element);
      return [];
    } catch (err) {
      outputChannel.appendLine(`[tree] ${String(err)}`);          // D-07 detail to output
      return [{ kind: 'error', label: `Failed: ${(err as Error).message}`, retry: () => this.refresh(element) }];
    }
  }
  // loadWorkspaces / loadWorkspaceChildren omitted — see Pattern 4
}
```

**Why `T | undefined | void` on the EventEmitter:** firing `undefined` re-fetches the root; firing a specific node re-fetches that subtree only [CITED: code.visualstudio.com/api/references/vscode-api#TreeDataProvider].

### Pattern 2: `view/item/context` menus with `contextValue` gating (D-08)

**What:** `package.json` declares menus that appear on right-click; the `when` clause uses `viewItem == <contextValue>` to scope per-node-kind.

```json
// Source: https://code.visualstudio.com/api/references/contribution-points#contributes.menus
"menus": {
  "view/title": [
    { "command": "altium365.tree.refresh",
      "when": "view == altium365.tree",
      "group": "navigation" }
  ],
  "view/item/context": [
    { "command": "altium365.script.runLocal",
      "when": "view == altium365.tree && viewItem == scriptNode",
      "group": "1_run@1" },
    { "command": "altium365.script.edit",
      "when": "view == altium365.tree && viewItem == scriptNode",
      "group": "2_edit@1" },
    { "command": "altium365.script.executeRemote",
      "when": "view == altium365.tree && viewItem == scriptNode",
      "group": "1_run@2" },
    { "command": "altium365.script.publish",
      "when": "view == altium365.tree && viewItem == scriptNode",
      "group": "2_edit@2" }
  ]
}
```

**Group naming:** the `@n` suffix orders within a group; prefix (`1_run`, `2_edit`) orders the group itself. Picking groups now prevents reshuffles in Phase 3.

### Pattern 3: Status bar item with QuickPick (D-04)

```typescript
// Source: https://code.visualstudio.com/api/references/vscode-api#StatusBarItem
const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
item.command = 'altium365.statusBar.click';
ctx.subscriptions.push(item);

function renderStatusBar(user?: string, env?: string) {
  if (!user) { item.hide(); return; }
  item.text = `$(account) A365: ${user} • ${env ?? 'default'}`;   // exact format per D-04
  item.tooltip = 'Altium 365 — click for actions';
  item.show();
}

ctx.subscriptions.push(vscode.commands.registerCommand('altium365.statusBar.click', async () => {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(sign-out) Sign Out',           command: 'altium365.signOut' },
      { label: '$(globe) Switch Environment',    command: 'altium365.switchEnvironment' },
      { label: '$(repo) Switch Workspace',       command: 'altium365.switchWorkspace' }
    ],
    { placeHolder: 'Altium 365' }
  );
  if (pick) await vscode.commands.executeCommand(pick.command);
}));
```

**Note:** `auth.ts` currently has no event emitter for auth-state changes. Phase 2 must add one (or expose a callback the status-bar module subscribes to) so that sign-in/sign-out/environment-switch keep the label accurate (PANEL-06).

### Pattern 4: Per-workspace token cache in SecretStorage (D-01)

```typescript
const SECRET_WS_TOKEN_PREFIX = 'altium365.workspaceTokens.';   // ← new keyed convention

async function ensureWorkspaceToken(
  ctx: vscode.ExtensionContext,
  cfg: AuthConfig,
  ws: { workspaceId: string; authId: string }
): Promise<string> {
  const key = SECRET_WS_TOKEN_PREFIX + ws.workspaceId;
  const cached = await ctx.secrets.get(key);
  if (cached && !isExpired(cached)) return parse(cached).accessToken;
  const fresh = await exchangeWorkspaceToken(ctx, cfg, ws.authId);     // existing
  await ctx.secrets.store(key, JSON.stringify(fresh));
  return fresh.accessToken;
}
```

**Why prefix instead of one JSON blob:** `SecretStorage` has no documented size limit per key, but storing N tokens in one JSON blob means any single token rotation rewrites the entire blob and races with concurrent expansions. Per-key is simpler and matches how the existing `altium365.tokens` singleton already works. The old `altium365.workspaceTokens` singleton key should be deleted on first run to avoid orphan storage.

### Pattern 5: `viewsWelcome` for signed-out state (D-05)

```json
// Source: https://code.visualstudio.com/api/references/contribution-points#contributes.viewsWelcome
"viewsWelcome": [
  {
    "view": "altium365.tree",
    "contents": "You are not signed in to Altium 365.\n\n[Sign In](command:altium365.signIn)\n\nLearn more about [Altium 365](https://www.altium.com/altium-365).",
    "when": "!altium365.signedIn"
  }
]
```

**Companion contract:** `extension.ts` must call `vscode.commands.executeCommand('setContext', 'altium365.signedIn', boolean)` whenever auth state changes, otherwise the welcome view never hides after sign-in.

### Anti-Patterns to Avoid
- **Custom webview for the tree** — loses Activity Bar UX, theming, accessibility; `TreeDataProvider` is the correct primitive.
- **Storing tokens in `globalState` / `workspaceState`** — those are plaintext; violates AGENTS.md.
- **Firing `onDidChangeTreeData` on every keystroke** — refresh should only fire on (a) manual refresh, (b) auth state change, (c) error-node retry click. Each fire re-invokes `getChildren` and re-issues network calls.
- **Registering commands inside `TreeDataProvider` constructor** — register in `activate()`, push to `ctx.subscriptions`, otherwise commands leak if the provider is recreated.
- **Reading `package.json` `activationEvents`** — the project has none, and adding a view contribution implicitly adds `onView:altium365.tree`; do not also add `*` activation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Tree refresh propagation | A polling loop or manual subtree re-render | `vscode.EventEmitter<T \| undefined \| void>` + `onDidChangeTreeData` | Documented contract; VS Code handles diff/animation |
| Empty/signed-out state | Custom welcome panel or webview | `contributes.viewsWelcome` | Native empty state, theming, command-link parsing |
| Secret storage | OS keychain wrappers, file encryption | `context.secrets` (SecretStorage) | OS keychain integration is already done by VS Code |
| QuickPick UI | Custom modal webview | `vscode.window.showQuickPick` | Themed, keyboard-navigable, accessible |
| Status bar updates | DOM-like manual repaint logic | `StatusBarItem.text` setter | Setter triggers re-render; just update the string |
| GraphQL transport | `node-fetch`, `axios`, `graphql-request` | Existing `graphqlRequest(endpoint, token, query, variables)` in `src/workspace.ts` | CONVENTIONS.md mandates reuse; no new deps |

## Runtime State Inventory

Phase 2 is greenfield (no rename / migration), so most categories are not applicable.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — no migration | — |
| Live service config | None — no external services configured by name | — |
| OS-registered state | None | — |
| Secrets / env vars | **Existing** `altium365.workspaceTokens` (single-slot) becomes obsolete when D-01's per-workspace cache lands as `altium365.workspaceTokens.<workspaceId>` | Delete the old single-slot key on first activation after upgrade (one-liner in `activate()`); no data loss because tokens are short-lived. |
| Build artifacts | None | — |

## Common Pitfalls

### Pitfall 1: Activity Bar shows the container but the tree is empty
**What goes wrong:** Container appears in the Activity Bar but clicking it shows no tree at all.
**Why:** A `viewsContainer` without a matching `views.<container-id>` entry, or a view with a `when` clause that's never true, or the provider was never registered with `vscode.window.registerTreeDataProvider(viewId, provider)`.
**How to avoid:** Three things must align — (1) `contributes.viewsContainers.activitybar[].id` (2) `contributes.views.<that-id>[].id` (3) the exact same `viewId` string passed to `registerTreeDataProvider`/`createTreeView`. Use a constant.
**Warning sign:** Container icon visible but body is blank with no `viewsWelcome` shown.

### Pitfall 2: `viewsWelcome` never hides after sign-in
**What goes wrong:** User signs in but the welcome view stays.
**Why:** The `when: "!altium365.signedIn"` clause requires the extension to actively maintain the `altium365.signedIn` context key via `setContext`. Setting it once at activation isn't enough — must fire on every auth state change.
**How to avoid:** Centralize auth-state changes through a helper that does (1) update secrets, (2) `setContext('altium365.signedIn', boolean)`, (3) status-bar re-render, (4) `treeProvider.refresh()`.

### Pitfall 3: Context menu fires for the wrong node kind
**What goes wrong:** "Run Script (local)" appears on workspace or project nodes.
**Why:** `when` clause missed the `viewItem == scriptNode` part or the TreeItem's `contextValue` wasn't set.
**How to avoid:** Centralize `contextValue` literals as TypeScript constants and reference the same constants in tests (when added). Visually verify each level in the Extension Development Host.

### Pitfall 4: Refresh causes N+1 network calls
**What goes wrong:** Clicking refresh causes a workspace re-list AND immediate re-fetch of every previously-expanded project/script list.
**Why:** Firing `onDidChangeTreeData()` with no argument tells VS Code to re-fetch everything that was visible; if you also call `getChildren` proactively for already-expanded nodes, you double-fetch.
**How to avoid:** Just clear the cache and fire `undefined`. VS Code will only call `getChildren` for currently-visible nodes — let it.

### Pitfall 5: Per-workspace token expires silently mid-session
**What goes wrong:** Tree expansion fails with 401 after an hour; user sees a generic error.
**Why:** `getActiveAccessToken` (per CONCERNS.md) silently falls back to the base token on expired workspace token; the workspace-scoped GraphQL endpoint then 401s because the base token lacks workspace scope.
**How to avoid:** In `ensureWorkspaceToken`, check `expiresAt` before returning cached; refresh proactively. On 401 from a workspace query, evict the cached secret and retry once. Surface the failure via D-07's inline error node, not silently.

### Pitfall 6: Command registered before placeholder handler exists
**What goes wrong:** `altium365.script.edit` declared in `package.json` but no `registerCommand` call → "command not found" error when user clicks the menu.
**Why:** Declaration in `contributes.commands` only registers the *name*; the handler still needs `vscode.commands.registerCommand` in `activate()`.
**How to avoid:** Add all four `registerCommand` calls in Phase 2 even though three are stubs (D-08). Stub body: `vscode.window.showInformationMessage('Coming in Phase 3')`.

### Pitfall 7: Engine version mismatch
**What goes wrong:** `viewsWelcome` doesn't render on older VS Code.
**Why:** `viewsWelcome` requires VS Code ≥1.45. Project declares `^1.85.0` so this is fine, but any feature added in the future must be checked against the declared engine.
**How to avoid:** When using a newer API, bump `engines.vscode` accordingly; VS Code refuses to install if mismatch.

### Pitfall 8 (CRITICAL): D-09 assumes single-call body fetch — schema says otherwise
**What goes wrong:** Planner writes a task "fetch script body via gloScrScripts" expecting body in the GraphQL response; the response only returns a `fileToken`.
**Why:** `GloScrScript.versionById(id)` → `GloScrScriptVersion { package: GloScrScriptPackage! }` and `GloScrScriptPackage` has exactly one field: `fileToken: String!` — i.e. a reference to a file in A365 file storage, not the body itself.
**How to avoid:** Plan a **checkpoint:human-verify** task before implementing D-09 to confirm (a) the exact file-download endpoint that consumes a `fileToken` (likely a REST endpoint on the workspace URL, e.g. `/api/files/{fileToken}` — schema is silent on this), (b) whether the package is a single `.py` file or a zip/archive (the type name `Package` strongly suggests the latter), and (c) which authentication header it expects. Until confirmed, do **not** lock the run-local implementation.

## Code Examples

### Activity Bar contribution (`package.json` excerpt)
```jsonc
// Source: https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers
"contributes": {
  "viewsContainers": {
    "activitybar": [
      {
        "id": "altium365",
        "title": "Altium 365",
        "icon": "$(circuit-board)"   // Codicon; swap to "resources/sidebar-icon.svg" if branded asset preferred
      }
    ]
  },
  "views": {
    "altium365": [
      { "id": "altium365.tree", "name": "Workspaces" }
    ]
  }
}
```

### Provider registration in `activate()`
```typescript
// Source: https://code.visualstudio.com/api/extension-guides/tree-view
const provider = new A365TreeDataProvider(ctx);
const view = vscode.window.createTreeView('altium365.tree', {
  treeDataProvider: provider,
  showCollapseAll: true
});
ctx.subscriptions.push(view);

ctx.subscriptions.push(vscode.commands.registerCommand('altium365.tree.refresh', () => provider.refresh()));
ctx.subscriptions.push(vscode.commands.registerCommand('altium365.tree.retryNode', (n: A365Node) => provider.refresh(n)));
```

### Script-list GraphQL query (workspace-scoped, no projectId)
```typescript
// Source: https://altiumdeveloper.github.io/platform-api-docs/operations/queries/gloScrScripts
const LIST_SCRIPTS = `
  query ListScripts($first: Int = 100, $after: String) {
    gloScrScripts(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { scriptId name description createdAt }
    }
  }
`;

export async function listScripts(workspaceToken: string, workspaceUrl: string) {
  const res = await graphqlRequest(`${workspaceUrl}/api`, workspaceToken, LIST_SCRIPTS, { first: 100 });
  // TODO planner: paginate if hasNextPage — v1 likely fine without, flag if any workspace exceeds 100 scripts.
  return res.gloScrScripts?.nodes ?? [];
}
```

### Script body fetch (D-09) — two-step
```typescript
// Source: https://altiumdeveloper.github.io/platform-api-docs/types/objects/GloScrScriptPackage
//         (HTTP file-download URL pattern PENDING HUMAN CONFIRMATION — see Pitfall 8)
const GET_SCRIPT_FILE_TOKEN = `
  query GetScriptFileToken($scriptId: String!) {
    gloScrScript(scriptId: $scriptId) {
      scriptId
      name
      versions(first: 1, order: [{ timestamp: DESC }]) {
        nodes { scriptVersionId package { fileToken } }
      }
    }
  }
`;

async function fetchScriptBody(workspaceToken: string, workspaceUrl: string, scriptId: string): Promise<Buffer> {
  const res = await graphqlRequest(`${workspaceUrl}/api`, workspaceToken, GET_SCRIPT_FILE_TOKEN, { scriptId });
  const fileToken = res.gloScrScript?.versions?.nodes?.[0]?.package?.fileToken;
  if (!fileToken) throw new Error('Script has no published version');

  // ⚠ PLANNER CHECKPOINT — file-download URL/header contract must be confirmed with human before this line ships.
  const dl = await fetch(`${workspaceUrl}/api/files/${encodeURIComponent(fileToken)}`, {
    headers: { Authorization: `Bearer ${workspaceToken}` }
  });
  if (!dl.ok) throw new Error(`File download failed: ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}
```

### Temp file lifecycle for D-09
```typescript
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

async function runLocalScript(ctx: vscode.ExtensionContext, scriptNode: A365Node & { kind: 'script' }) {
  const wsToken = await ensureWorkspaceToken(ctx, cfg, /* ws */ ...);
  const body = await fetchScriptBody(wsToken, workspaceUrl, scriptNode.scriptId);
  const tmpPath = path.join(os.tmpdir(), `altium365-${scriptNode.scriptId}-${Date.now()}.py`);
  await fs.writeFile(tmpPath, body, { mode: 0o600 });
  try {
    await runExistingPythonPipeline(tmpPath);   // reuse existing runScript spawn logic
  } finally {
    await fs.unlink(tmpPath).catch(() => {});   // D-09 explicit cleanup
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Custom webview side panels for hierarchical data | `TreeDataProvider` + `viewsContainers` | VS Code 1.25+ | Less code, better UX, accessible by default |
| `activationEvents: ["*"]` (eager) | Implicit per-contribution activation (`onView:`, `onCommand:`) | VS Code 1.74+ | Faster startup; project already follows this |
| Storing tokens in `workspaceState` | `context.secrets` (SecretStorage) | VS Code 1.53+ | OS keychain integration; AGENTS.md mandates this |

**Deprecated / outdated:**
- `vscode.window.registerTreeDataProvider` is still supported but `vscode.window.createTreeView` is preferred — it returns a `TreeView` handle that exposes `reveal`, `selection`, and `visible` which we'll want eventually [CITED: code.visualstudio.com/api/references/vscode-api#TreeView].
- `activationEvents` (the `*` form) is discouraged; project doesn't use it — keep that posture.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Script body file-download endpoint follows `${workspaceUrl}/api/files/{fileToken}` with `Authorization: Bearer <workspaceToken>` | Code Examples §"Script body fetch" | **HIGH** — wrong URL/auth means D-09 fails at runtime. Planner must add a `checkpoint:human-verify` task before implementation. |
| A2 | The script package returned by `fileToken` is a single text file (the `.py` script), not a zip/archive containing entry-point + dependencies | Pitfall 8, Code Examples | **MEDIUM** — if it's an archive, the run-local task needs an unzip step and a way to choose the entry point. The type name `GloScrScriptPackage` is suspicious; treat single-file as unverified. |
| A3 | A single 100-item page from `gloScrScripts(first: 100)` is sufficient for v1 — no workspace will exceed 100 scripts | Code Examples §"Script-list GraphQL query" | **LOW** — pagination is trivial to add (`pageInfo.hasNextPage` loop); flag during human UAT if any real workspace exceeds the page. |
| A4 | `context.secrets` per-key writes are concurrency-safe across overlapping `await` paths (e.g. two simultaneous workspace expansions) | Pattern 4 | **LOW** — VS Code's SecretStorage API is documented as async-safe per-key; risk is conceptual. |
| A5 | The status bar item shows env name from the existing `cfg.environment` field accessible via the same auth singleton used elsewhere | Pattern 3 | **LOW** — straightforward refactor if the accessor needs adding. |

**Note for planner & discuss-phase:** A1 and A2 in combination justify a single human-confirmation checkpoint task **before** any D-09 implementation work. The rest of Phase 2 (tree, status bar, menus, viewsWelcome, secrets refactor) is unblocked and can proceed in parallel.

## Open Questions

1. **Script-body retrieval endpoint (D-09 / A1+A2)**
   - What we know: GraphQL returns a `fileToken`; the body is not inline.
   - What's unclear: the HTTP endpoint, the headers, and whether the payload is a single `.py` or an archive.
   - Recommendation: planner inserts a `checkpoint:human-verify` task at the front of the D-09 wave; until resolved, the run-local handler stubs the same "Coming in Phase 3"-style message as the other three so the menu still works.

2. **Auth state event source**
   - What we know: `auth.ts` exposes `signIn`, `signOut`, token getters but no event emitter.
   - What's unclear: cleanest way to notify the status bar + tree on state change.
   - Recommendation: add a small `vscode.EventEmitter<AuthState>` exported from `auth.ts`; status bar and provider subscribe in `activate()`. Lightweight, no new deps.

3. **Icon for the Activity Bar container**
   - What we know: Codicon vs custom SVG is the agent's discretion (CONTEXT.md).
   - Recommendation: start with Codicon `circuit-board` (visually evokes PCB; ships free). Defer custom SVG to a polish pass — not a blocker.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| VS Code Extension Host | All UI code | ✓ | engines.vscode `^1.85.0` declared | — |
| Node.js | Extension runtime | ✓ | ≥20 (per STACK.md) | — |
| `tsc` (TypeScript 5.4+) | Build | ✓ | per package.json | — |
| `python3` | D-09 local-run subprocess | ✓ on dev machines (existing requirement) | — | Already required by Phase 1 runScript; no new requirement |
| `npm` / `vsce` | Phase 1 packaging | ✓ | — | Not exercised by Phase 2 |

No new external dependencies introduced by Phase 2.

## Security Domain

Phase 2 introduces no new attack surface, but does refactor token storage. ASVS coverage relevant to this phase:

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes — auth state surfaced via status bar | Reuse existing PKCE flow in `auth.ts`; no new auth code |
| V3 Session Management | yes — per-workspace token cache (D-01) | `context.secrets` (OS keychain via VS Code SecretStorage); expiry check before reuse; evict on 401 |
| V4 Access Control | yes — workspace-scoped tokens enforce server-side isolation | Workspace-scoped GraphQL endpoint rejects mis-scoped tokens; client just honors the boundary |
| V5 Input Validation | yes — script names, project names rendered in TreeItems | VS Code `TreeItem.label` is treated as plain text, not HTML — no XSS via tree |
| V6 Cryptography | no — no new crypto in this phase | Reuse PKCE primitives from Phase 1 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Token leak via plaintext storage | Information Disclosure | `context.secrets` only; old `altium365.workspaceTokens` singleton key deleted on upgrade |
| Symlink attack on temp file (D-09) | Tampering | Use `os.tmpdir()` + randomized filename + mode `0o600`; existing pipeline already follows this — verify in plan |
| Stale token used after sign-out | Spoofing | On sign-out, clear ALL `altium365.workspaceTokens.*` keys, not just the base token |
| Workspace-scope confusion (using one workspace's token to query another) | Elevation of Privilege | Cache key = workspace id; never reuse across IDs. Code review item. |
| Command-injection via script name in temp path | Injection | `path.join(os.tmpdir(), `altium365-${scriptId}-${Date.now()}.py`)` — use `scriptId` (server-issued opaque string) NOT user-controlled `name` |

## Sources

### Primary (HIGH confidence)
- VS Code Extension API — Tree View Guide: https://code.visualstudio.com/api/extension-guides/tree-view
- VS Code API Reference — TreeDataProvider, TreeView, StatusBarItem, EventEmitter, SecretStorage: https://code.visualstudio.com/api/references/vscode-api
- VS Code Contribution Points — viewsContainers, views, viewsWelcome, menus: https://code.visualstudio.com/api/references/contribution-points
- Altium Platform API docs — `gloScrScripts` query: https://altiumdeveloper.github.io/platform-api-docs/operations/queries/gloScrScripts
- Altium Platform API docs — `GloScrScript`: https://altiumdeveloper.github.io/platform-api-docs/types/objects/GloScrScript
- Altium Platform API docs — `GloScrScriptVersion`: https://altiumdeveloper.github.io/platform-api-docs/types/objects/GloScrScriptVersion
- Altium Platform API docs — `GloScrScriptPackage`: https://altiumdeveloper.github.io/platform-api-docs/types/objects/GloScrScriptPackage
- Project codebase: `src/extension.ts`, `src/auth.ts`, `src/workspace.ts`, `package.json`, `.planning/codebase/{ARCHITECTURE,STACK,CONVENTIONS,STRUCTURE,CONCERNS}.md`

### Secondary (MEDIUM confidence)
- Inferred file-download URL pattern (`/api/files/{fileToken}`) — based on common A365 REST conventions; **not verified against official docs**, flagged as A1 in Assumptions Log.

### Tertiary (LOW confidence)
- None — all factual claims are either Primary-sourced or explicitly tagged in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack (VS Code APIs): HIGH — official docs, no version ambiguity.
- Architecture patterns: HIGH — directly from VS Code's published tree-view sample and contribution-points reference.
- Common pitfalls: HIGH for #1-7 (well-known VS Code gotchas); HIGH for #8 (schema-verified, contradicts CONTEXT.md and must reach the planner).
- `gloScrScripts` query shape: HIGH — verified against the published schema page.
- D-09 body-fetch contract: MEDIUM — GraphQL portion HIGH (fileToken confirmed); download URL portion is an assumption (A1) requiring human checkpoint.

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (VS Code API is stable; revalidate if `engines.vscode` is bumped above 1.95 or if Altium publishes API changes)
