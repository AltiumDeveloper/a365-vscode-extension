---
phase: 02-side-panel
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - package.json
  - src/auth.ts
  - src/extension.ts
  - src/scriptCommands.ts
  - src/sidePanel.ts
  - src/workspace.ts
findings:
  critical: 2
  warning: 7
  info: 6
  total: 15
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-19
**Depth:** standard
**Files Reviewed:** 7 (package.json + 6 sources; `python/` runtime unchanged in this phase)
**Status:** issues_found

## Summary

Phase 02 introduces the Activity Bar tree, status bar, per-workspace token caching, and placeholder script commands. The wiring is mostly correct (disposables pushed to `context.subscriptions`, EventEmitter shared via the singleton documented in CONVENTIONS, `context.secrets` used for all token storage). However, the dual workspace-token storage model introduced in this phase has a **silent token-confusion bug** and a **stale-token-across-sign-in security hole**. There is also a reflected XSS in the OAuth loopback error page (unchanged by this phase but exercised by the new flows) and several lower-severity correctness/quality issues.

No findings on the AGENTS.md "tokens must use `context.secrets`, never plaintext" rule — that constraint is honored end-to-end. Findings concentrate on *logical* token routing, not storage medium.

---

## Critical Issues

### CR-01: Workspace token routing collision — `getActiveAccessToken` silently returns the wrong workspace's token

**File:** `src/auth.ts:238-260` (`exchangeWorkspaceToken`), `src/auth.ts:269-294` (`ensureWorkspaceToken`), `src/auth.ts:324-329` + `371-391` (`getActiveAccessToken`)
**Issue:**
Two parallel storage models coexist:

1. `SECRET_WORKSPACE_TOKENS` (singleton, key `'altium365.workspaceTokens'`) — written by `exchangeWorkspaceToken` (line 258), read by `getStoredWorkspaceTokens` → `getActiveAccessToken`.
2. `SECRET_WS_TOKEN_PREFIX + workspaceId` (per-workspace, key `'altium365.workspaceTokens.<id>'`) — written by `ensureWorkspaceToken` (line 287).

`ensureWorkspaceToken` calls `exchangeWorkspaceToken` on cache-miss (line 286). The inner call **also overwrites the singleton** with that workspace's token. So the moment the tree view expands workspace B (which invokes `ensureWorkspaceToken(B)` from `sidePanel.ts:180`), the singleton `SECRET_WORKSPACE_TOKENS` is replaced with B's token — even though the user's *selected* workspace (per `getSelectedWorkspace`) is still A.

Then `runScript` / `debugScript` → `prepareRun` → `getActiveAccessToken` returns B's token, and the Python subprocess receives `ALTIUM365_TOKEN=<B's token>` along with `ALTIUM365_WORKSPACE_ID=<A's id>`. The user is now running an A-scoped script with a B-scoped token. This is a silent authorization confusion that will either 401 or — worse — operate on the wrong workspace if scopes overlap.

**Fix:** Pick one model. Either:
- Drop `SECRET_WORKSPACE_TOKENS` entirely; have `getActiveAccessToken` resolve via `ensureWorkspaceToken(getSelectedWorkspace(context))` so the active token always tracks the *selected* workspace, OR
- Have `exchangeWorkspaceToken` accept the workspaceId it was exchanged for and only ever write to the per-workspace key; let `getActiveAccessToken` look up by selected workspace.

```ts
// Sketch (option 1):
export async function getActiveAccessToken(context, cfg): Promise<string | undefined> {
    const ws = getSelectedWorkspace(context);
    if (ws) return ensureWorkspaceToken(context, cfg, ws);
    // fall back to base token only if no workspace is selected
    let base = await getStoredTokens(context);
    ...
}
```

---

### CR-02: Per-workspace tokens from previous account survive sign-in / sign-out boundary

**File:** `src/auth.ts:227-228` (`signIn`), `src/auth.ts:331-344` (`clearAllTokens`)
**Issue:**
`signIn` clears `SECRET_TOKENS` and `SECRET_WORKSPACE_TOKENS` but **does not drain the per-workspace cache** (`SECRET_WS_TOKEN_PREFIX + id` entries or the `GLOBAL_WS_TOKEN_INDEX_KEY` index). After User A signs out (which *does* drain via `clearAllTokens`) and User B signs in fresh, the index has been cleared — but if User A signed back in *without first signing out*, prior per-workspace tokens (and their workspaceId index) remain in SecretStorage. Any subsequent `ensureWorkspaceToken` call for a shared workspaceId will return User A's *previous* cached token (it only checks expiry, not identity) until expiry.

This is a privacy/security regression unique to Phase 02 — the per-workspace cache is new. Tokens belonging to one identity can be served to another in the case of account switching without explicit sign-out, and a malicious/compromised script could harvest tokens the user believes were invalidated.

**Fix:** Call `clearAllTokens(context)` at the top of `signIn` (before the OAuth dance), or at minimum drain the per-workspace index + per-key secrets there:
```ts
export async function signIn(context, cfg, timeoutMs = 180_000): Promise<TokenSet> {
    // Defensive: any prior identity's per-workspace cache must not survive a new sign-in.
    await clearAllTokens(context).catch(() => undefined);
    const { verifier, challenge } = pkcePair();
    ...
}
```
(Move the `authStateEmitter.fire({ signedIn: false })` inside `clearAllTokens` behind a flag if you don't want a transient "signed out" event during the re-sign-in flow.)

---

## Warnings

### WR-01: Reflected XSS in OAuth loopback error page

**File:** `src/auth.ts:133-138`
**Issue:** The `error` query parameter from the OAuth redirect is interpolated unescaped into HTML returned by the loopback server:
```ts
res.end(`<html><body><h3>Authentication failed: ${error}</h3></body></html>`);
```
The loopback listens on `127.0.0.1:<port>` only during sign-in, but during that window any page the user visits can trigger `http://127.0.0.1:8080/oauth/v2/callback?error=<img src=x onerror=alert(1)>` (or fetch from a malicious tab). The injected script runs in the `127.0.0.1` origin and can attempt `fetch` against other localhost services. Same-origin policy limits damage but the loopback origin is shared by anything else the user runs locally.

**Fix:** HTML-escape `error` (and ideally treat any unexpected `error` value as a generic "Authentication failed"):
```ts
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
res.end(`<html><body><h3>Authentication failed: ${escapeHtml(error)}</h3></body></html>`);
```

---

### WR-02: Tree view uses raw stored token without refresh / expiry check

**File:** `src/sidePanel.ts:147-154`
**Issue:** `loadWorkspaces` reads `getStoredTokens(this.ctx)` and passes `base.access_token` straight to `listWorkspaces`. There is no expiry check and no `refresh_token` flow — the tree will silently fail (`Failed: GraphQL HTTP 401: ...`) once the access token expires, even though a valid refresh token is present and `getActiveAccessToken` would have refreshed it. The user experience is "tree just stops working, sign out + sign in fixes it."

**Fix:** Call `getActiveAccessToken(this.ctx, readOAuthConfig())` instead. It handles expiry + refresh.
```ts
const token = await getActiveAccessToken(this.ctx, readOAuthConfig());
if (!token) return [];
const list = await listWorkspaces(endpoint, token);
```

---

### WR-03: Temp params file leaks; no restrictive mode

**File:** `src/extension.ts:463-472`
**Issue:** `prepareRun` writes `altium365-params-<ts>-<pid>.json` to `os.tmpdir()` on every run when prompting for projectId, but nothing ever deletes it. Over time the temp dir accumulates files. Also `fs.writeFileSync` is used without `mode: 0o600`, so on Linux where `/tmp` may be world-readable, sibling users on the host can read the JSON (only a projectId in v1, but the same code will likely carry secrets later). Sync I/O in an `async` path also blocks the extension host event loop.

**Fix:**
```ts
const tmpFile = path.join(os.tmpdir(), `altium365-params-${Date.now()}-${process.pid}.json`);
await fs.promises.writeFile(tmpFile, JSON.stringify({ projectId: picked }, null, 2), { encoding: 'utf-8', mode: 0o600 });
context.subscriptions.push({ dispose: () => fs.promises.unlink(tmpFile).catch(() => undefined) });
// Or schedule unlink on proc 'close' for runScript
```

---

### WR-04: Token endpoint error body echoed verbatim — possible secret leak into UI

**File:** `src/auth.ts:97-100`
**Issue:** `postForm` throws `Token endpoint returned ${res.status}: ${text}` with the *full* response body. This message surfaces in `vscode.window.showErrorMessage` (e.g. `extension.ts:136`, `162`). IdPs sometimes echo back fragments of `subject_token` or scopes in error responses; users may screenshot/share these. Other call sites in this file already truncate to `text.slice(0, 500)` — be consistent.

**Fix:**
```ts
throw new Error(`Token endpoint returned ${res.status}: ${text.slice(0, 500)}`);
```

---

### WR-05: Race on per-workspace token index update

**File:** `src/auth.ts:288-292`
**Issue:** `ensureWorkspaceToken` reads the index from globalState, spreads-and-writes. Two concurrent calls for two different new workspaces (e.g. parallel `loadWorkspaceChildren` after a refresh) both await `context.secrets.store` and then both read the *same pre-mutation* index. The second `update` overwrites the first, so one workspaceId is dropped from the index and its secret will be **orphaned** — `clearAllTokens` won't drain it, leaving a residual token in SecretStorage forever.

**Fix:** Serialize index updates (a per-extension lock, or re-read the index immediately before the write and merge), or use a single-element key per workspace tracked by listing key prefixes if SecretStorage supports it (it does not — VS Code SecretStorage has no enumeration API, which is exactly why the index exists).

```ts
// Minimal fix: re-read just before write to narrow the race window.
const cur = context.globalState.get<string[]>(GLOBAL_WS_TOKEN_INDEX_KEY, []);
if (!cur.includes(workspace.workspaceId)) {
    await context.globalState.update(GLOBAL_WS_TOKEN_INDEX_KEY, [...cur, workspace.workspaceId]);
}
```
(Still racy; a proper fix needs a Mutex.)

---

### WR-06: `package.json` engine `node >=20` contradicts AGENTS.md "Node.js ≥18"

**File:** `package.json:9`
**Issue:** AGENTS.md (Tech Stack section) declares Node.js ≥18, but `engines.node` is `">=20"`. VS Code's extension host on 1.85 ships Node 18.x in many distributions — `>=20` will cause `npm install` warnings and may misrepresent runtime requirements to consumers. Pick one source of truth.

**Fix:** Either bump AGENTS.md to ≥20 or relax `package.json` to `">=18"`. Whichever matches the CI matrix.

---

### WR-07: `loadWorkspaces` cache is never invalidated when only `getEndpoint()` changes

**File:** `src/sidePanel.ts:40-62`, `143-170`
**Issue:** The provider caches `workspacesCache` keyed by nothing. After `Select Environment` flips `altium365.graphqlEndpoint`, the existing cache (computed against the old endpoint) is still returned until `refresh()` fires. The auth-state listener in `extension.ts:71-74` calls `treeProvider.refresh()` when `fireAuthStateChanged` runs — and `doSelectEnvironment` does fire that event (line 235) — so in practice this works, but only by coincidence. If anyone later changes the endpoint without firing `onAuthStateChanged`, the tree will silently serve stale data.

**Fix:** Either listen on `vscode.workspace.onDidChangeConfiguration` for `altium365.graphqlEndpoint` and call `refresh()`, or key the cache by endpoint string and re-fetch on mismatch.

---

## Info

### IN-01: Dead read of OAuth config in `loadWorkspaces`

**File:** `src/sidePanel.ts:147-148`
**Issue:**
```ts
const cfg: OAuthConfig = readOAuthConfig();
void cfg;
```
`cfg` is read and immediately discarded. Remove it (or actually use it — note that this same function would benefit from passing `cfg` into `getActiveAccessToken`, see WR-02).

---

### IN-02: `graphqlRequest` returns `any` and is awkward to type

**File:** `src/workspace.ts:19-48`
**Issue:** Return type `Promise<any>` defeats type checking for every caller. Make it generic:
```ts
export async function graphqlRequest<T = unknown>(endpoint, accessToken, query, variables?): Promise<T> { ... }
```
Each caller then narrows on use.

---

### IN-03: `listScripts` pagination TODO is accepted debt — record max page size constant

**File:** `src/workspace.ts:130-141`
**Issue:** Hardcoded `first: 100` is reasonable v1 per RESEARCH.md A3, but `100` appears in two places (query default + call site `{ first: 100 }`). Extract a constant so future paginators don't drift:
```ts
const SCRIPTS_PAGE_SIZE = 100;
```

---

### IN-04: `registerScriptCommands` ignores its parameters

**File:** `src/scriptCommands.ts:21-31`
**Issue:** `context` and `output` are accepted then `void`-discarded. Acceptable as Phase-3-placeholder scaffolding, but the signature lies about its dependencies. Either drop the parameters until Phase 3 needs them, or implement the placeholder using `output.appendLine(...)` instead of `void output`.

---

### IN-05: Empty `activationEvents` may delay first tree render

**File:** `package.json:18`
**Issue:** `"activationEvents": []` relies on VS Code's implicit command-activation. The view container will appear in the Activity Bar without activating the extension; the welcome view (`!altium365.signedIn` context) will not be evaluated until activation occurs. Consider `"onView:altium365.tree"` to guarantee `updateSignedInContext` runs before the welcome view's `when` clause is evaluated.

---

### IN-06: Error messages from `clearAllTokens` are swallowed silently

**File:** `src/auth.ts:331-344`
**Issue:** If any `secrets.delete` rejects (e.g. keychain unavailable on Linux without libsecret), the function continues silently and the `authStateEmitter.fire` reports a successful sign-out. The user thinks they're signed out but secrets may persist. Log the failure to the OutputChannel at least:
```ts
} catch (e) {
    // surface but don't block
    console.error('[Altium 365] clearAllTokens partial failure', e);
}
```
(Pass an `OutputChannel` into the function or accept a logger callback.)

---

_Reviewed: 2026-05-19_
_Reviewer: gsd-code-reviewer (adversarial)_
_Depth: standard_
