# Phase 11: Unit Tests and Code Organisation - Research

**Researched:** 2026-06-01
**Domain:** Vitest unit testing of VS Code extension modules — pure function extraction, VS Code mock design, per-plan testability inventory
**Confidence:** HIGH (all findings from direct source code inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Single shared mock at `test/__mocks__/vscode.ts` (already aliased in vitest.config.ts). Extended incrementally — no separate mock files per plan.
- **D-02:** Mock state reset via `beforeEach`. Tests fully isolated — no state bleeding.
- **D-03:** Mock provides factory functions returning fresh instances per test (`makeSecretStorage()`, `makeGlobalState()`, `makeExtensionContext()`). No global mock instances shared across tests.
- **D-04:** Primary unit = pure sub-functions extracted from command handlers. Functions mixing VS Code API + business logic have their pure core extracted and tested in isolation.
- **D-05:** Extraction needed for testability is included in the plan as a prerequisite step. No separate refactoring phase.
- **D-06:** All test files in `test/` mirroring `src/` structure. `vitest.config.ts` already includes `test/**/*.test.ts`.
- **D-07:** No numeric coverage threshold. Goal: happy path + most important error/edge cases per module.
- **D-08:** VS Code-heavy functions (QuickPick flows, showErrorMessage, progress notifications): skip with a note rather than invest in complex UI mocking. Document skipped functions in comment block.
- **D-09:** Code reorganisation is agent-decided, module-by-module, as tests reveal structure issues. If a module is untestable without reorganisation, the plan includes it.
- **D-10:** Refactoring in D-05/D-09 must not break `npm run compile` or existing tests.

### Agent's Discretion

- Exact mock surface coverage for each VS Code API
- Whether to use `vi.spyOn` vs factory functions for specific VS Code APIs
- Ordering of plans (the 7 plans may be reordered if dependencies require it)
- Whether to add `vitest --coverage` reporting to CI as an informational step

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

## Summary

Phase 11 adds a structured unit test suite across 7 plans. The codebase is a Node-environment VS Code extension; `vitest.config.ts` aliases the `vscode` module to `test/__mocks__/vscode.ts` (currently empty — `export {}`). The existing 4 test files all test pure functions with zero VS Code mock surface needed.

The single highest-leverage investment in this phase is building the shared mock (`test/__mocks__/vscode.ts`) with factory functions for `SecretStorage`, `GlobalState`, and `ExtensionContext`, plus stubs for the handful of VS Code APIs that boundary-level functions call. Every plan after that consumes from the same mock pool.

A recurring pattern across modules: business logic is embedded inside private functions inside large source files. Phase 11 needs targeted extractions before tests can be written. The extractions are small (rename private → export, or lift into a new pure helper file) but are prerequisites for each plan.

**Primary recommendation:** Build `test/__mocks__/vscode.ts` with factory functions as Plan 11-01's Wave 0, then each subsequent plan adds its module's tests. Prioritise plans with the most pure-function coverage: `store.ts`, `workspace.ts` URL helpers, `identity.ts`, and `remoteScriptFs.ts` URI helpers all have high testable surface area with minimal mock depth.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token storage (base + per-workspace) | Extension Host | VS Code SecretStorage | Tokens live in `context.secrets`; all auth functions take an `ExtensionContext` |
| Test event storage | Extension Host | VS Code GlobalState | `context.globalState` under `altium365.scriptParams.*` keys |
| Script identity resolution | Extension Host | In-memory registry (`localScriptCache`) | URI scheme discrimination + registry lookup |
| GraphQL calls | Extension Host | Network (`fetch`) | All workspace queries/mutations go through `graphqlRequest` |
| File system virtual docs | VS Code FileSystemProvider | Extension Host | Two FSPs: `altium365:` and `altium365-event:` |
| Auth state broadcast | Extension Host | Module-level `EventEmitter` | `authStateEmitter` is a singleton; module-level per CONVENTIONS exception |

---

## Standard Stack

### Core (already installed — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^2.0.0 | Test runner, assertion, mocking | Already installed (Phase 7); aliased vscode mock already wired in vitest.config.ts |
| `@vitest/coverage-v8` | optional | Coverage reporting | Standard vitest coverage provider; add `--coverage` for local runs if desired |

**No new packages needed.** [VERIFIED: package.json inspection] `vitest@^2.0.0` is already in `devDependencies`. `vitest run --passWithNoTests` is already wired as the `test` script.

---

## Package Legitimacy Audit

> No new packages are installed in this phase. The test infrastructure (vitest) is already present. No audit required.

---

## Architecture Patterns

### Recommended Project Structure (tests only)

```
test/
├── __mocks__/
│   └── vscode.ts               ← shared mock (built out in Plan 11-01 Wave 0)
├── auth.test.ts                ← Plan 11-01
├── testEvents/
│   ├── store.test.ts           ← Plan 11-03
│   ├── identity.test.ts        ← Plan 11-03
│   ├── resolver.test.ts        ← Plan 11-03
│   └── importSibling.test.ts   ← Plan 11-03 (skip UI parts per D-08)
├── workspace.test.ts           ← Plan 11-06
├── remoteScriptFs.test.ts      ← Plan 11-04
├── eventFs.test.ts             ← Plan 11-04
└── [further plans tbd]
```

### Pattern 1: Factory Functions for Mock Contexts (D-03)

```typescript
// test/__mocks__/vscode.ts — illustrative skeleton for Wave 0 (Plan 11-01)
export function makeSecretStorage(): vscode.SecretStorage {
    const store = new Map<string, string>();
    return {
        get: vi.fn(async (key: string) => store.get(key)),
        store: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
        delete: vi.fn(async (key: string) => { store.delete(key); }),
        onDidChange: new EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };
}

export function makeGlobalState(): vscode.Memento & { setKeysForSync: (keys: readonly string[]) => void } {
    const store = new Map<string, unknown>();
    return {
        get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined =>
            (store.has(key) ? store.get(key) : defaultValue) as T | undefined),
        update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
        keys: vi.fn(() => [...store.keys()]),
        setKeysForSync: vi.fn(),
    };
}

export function makeExtensionContext(overrides?: Partial<vscode.ExtensionContext>): vscode.ExtensionContext {
    return {
        secrets: makeSecretStorage(),
        globalState: makeGlobalState(),
        asAbsolutePath: vi.fn((rel: string) => `/mock/extension/${rel}`),
        subscriptions: [],
        ...overrides,
    } as unknown as vscode.ExtensionContext;
}
```

### Pattern 2: Pure Function Extraction (D-04/D-05)

The planner extracts private helper functions to be exported (or moved to a new helper file) as a prerequisite step in the same plan. Example for `auth.ts`:

```typescript
// Before: private function
function withExpiry(tok: TokenSet): TokenSet { ... }

// After: exported for testing
export function withExpiry(tok: TokenSet): TokenSet { ... }
// OR moved to src/authHelpers.ts and imported by auth.ts
```

### Pattern 3: fetch Mock for GraphQL (Plan 11-06)

```typescript
// In test setup — vi.stubGlobal works because vitest runs in Node environment
vi.stubGlobal('fetch', vi.fn());

// Per-test:
(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    text: async () => JSON.stringify({ data: { desWorkspaceInfos: [] } }),
});
```

### Anti-Patterns to Avoid

- **Shared module-level mock instances:** The module-level `authStateEmitter` and `storeChangeEmitter` are created once at import time. Tests that subscribe to these events must dispose the listener in `afterEach` to avoid cross-test listener bleed. Do NOT try to replace them with fresh instances per test — module singletons aren't reset between tests in Vitest.
- **Testing command handlers directly:** The whole-handler approach bundles UI, VS Code API, and business logic. Per D-04, extract the pure core, test that.
- **Mocking what you don't need:** `remoteScriptFs.ts` URI helpers (`buildScriptUri`, `parseScriptUri`) only need `vscode.Uri.from` and `vscode.FileSystemError` — not the full `ExtensionContext`. Keep mock surface minimal.

---

## Per-Plan Testability Inventory

This section is the core research output. It maps each of the 7 plans to: testable surface, required mock depth, extraction prerequisites, and skip candidates.

---

### Plan 11-01: Auth Module (`src/auth.ts`)

**File stats:** 646 lines, mostly `async` functions taking `ExtensionContext + OAuthConfig`.

#### Pure Functions to Extract (D-05 prerequisites)

| Function | Currently | Extraction Required | Test value |
|----------|-----------|---------------------|------------|
| `decodeIdTokenClaims(idToken)` | private | Export or move to `src/authHelpers.ts` | JWT base64url decode, 3-part validation, JSON parse fallback |
| `userLabelFromClaims(claims)` | private | Export or move | Claim priority: preferred_username → email → name → fallback |
| `withExpiry(tok)` | private | Export | `expires_at = now + expires_in - 30` only when absent |
| `isExpired(tok)` | private | Export | `Date.now() / 1000 >= expires_at`; false when no expires_at |
| `b64url(buf)` | private | Export (optional) | Base64url encoding correctness |

**Recommended approach:** Export these 4-5 functions directly from `auth.ts` (not a new file) since they're closely coupled to `TokenSet`. 5-line change each.

#### Functions Testable With Factory Mocks

| Function | Mock Needed | Key test cases |
|----------|-------------|----------------|
| `getStoredTokens(ctx)` | `makeSecretStorage` | returns undefined when empty; parses stored JSON |
| `clearAllTokens(ctx)` | `makeSecretStorage` + `makeGlobalState` | clears base key + per-workspace keys from index; fires `signedIn:false` event |
| `clearAllTokens(ctx, {silent:true})` | same | does NOT fire event |
| `refreshTokens(ctx, cfg)` | `makeSecretStorage` + `fetch` mock | calls `postForm` with `refresh_token` grant; re-stores; preserves refresh_token when not rotated; calls `clearAllTokens` on postForm throw |
| `getBaseAccessToken(ctx, cfg)` | `makeSecretStorage` + `fetch` mock | returns `undefined` when no stored token; returns `access_token` when valid; triggers refresh on expired + refresh_token present; calls `clearAllTokens` when expired + no refresh_token |
| `ensureWorkspaceToken(ctx, cfg, ws)` | `makeSecretStorage` + `makeGlobalState` + `fetch` mock | cache hit (fast path); cache miss → exchange → store → index update; double-check locking (expired cache entry overwritten) |

#### Skip Candidates (D-08)

- `signIn(ctx, cfg)` — orchestrates `pollActionWait` + `vscode.env.openExternal` + `postForm`. Testing the happy path requires mocking `postJson` (Node's http/https) AND `vscode.env.openExternal`. High complexity, low yield given the individual pieces are tested. **Skip with note.**
- `pollActionWait()` — involves Node `http.request` abort/timeout mechanics. Not worth mocking at this layer. **Skip with note.**
- `readOAuthConfig()` — reads `vscode.workspace.getConfiguration`. Simple enough to test with a config stub, but low value (just accesses named keys). **Optional — test only the key-fallback behaviour if the mock surface is already present.**

#### VS Code Mock Surface Required

```typescript
// SecretStorage (get/store/delete) — from makeSecretStorage()
// GlobalState (get/update) — from makeGlobalState()
// EventEmitter — for authStateEmitter (module-level)
// vscode.workspace.getConfiguration → stub returning config values (readOAuthConfig only)
// vscode.env.openExternal → vi.fn() stub (signIn only; recommended skip)
```

**EventEmitter note:** `authStateEmitter` is created at module load time. Tests that assert `onAuthStateChanged` fires must subscribe in the test, execute the action, then dispose the subscription in `afterEach`. The emitter itself is not reset — only the subscriptions.

---

### Plan 11-02: UI/UX Module (`src/sidePanel.ts`, `src/treeCommands.ts`, `src/testEvents/picker.ts`)

#### `src/testEvents/picker.ts` — best candidate

`pickTestEvent(identity, store, options)` uses `vscode.window.createQuickPick()` which returns a QuickPick object. Per D-08, the QuickPick flow itself is skip-worthy. However, the **item-building logic** (what items appear given a store snapshot) can be extracted and tested purely.

**Extraction:** Extract a `buildPickerItems(store, options)` pure function that returns the `PickerItem[]` array. Test it with various store shapes (empty, single event, multi event, with/without default, eventsOnly mode).

**`previewBody(body)`** — private pure function in `picker.ts`. Export and test: long JSON truncation to 77 chars + `…`, unserializable fallback.

#### `src/sidePanel.ts` — skip-heavy

The `A365TreeDataProvider` builds tree items from cached workspace/project/script/extension-point data. The pure core is the item-building logic (which `TreeItem` label/icon/collapsibleState to produce for a given node type). This can be extracted, but the full provider is tightly coupled to `vscode.TreeItem`, `ThemeIcon`, `ThemeColor`, etc.

Per D-08: **skip the full provider**. If a pure `buildWorkspaceTreeItem(info, isActive)` or similar is extractable, test that.

#### `src/treeCommands.ts`

Tree commands dispatch to other commands or call `vscode.window.showQuickPick`. Per D-08: skip. The state-mutation side effects (workspace selection) are tested in auth/workspace plans.

---

### Plan 11-03: Test Events Module (`src/testEvents/`)

This is the highest-value plan — 7 files, most with good pure-function or mockable-context coverage.

#### `src/testEvents/store.ts` — highest priority, cleanest surface

All functions take `(ctx, identity, ...)` where ctx is only used for `globalState.get` / `globalState.update`. Fully testable with `makeGlobalState()`. No extraction needed.

| Function | Test cases |
|----------|-----------|
| `readStore(ctx, identity)` | undefined when no entry; returns undefined for invalid shape (no events object); returns valid store |
| `writeStore(ctx, identity, store)` | updates globalState at correct key; fires `onDidChangeTestEventStore` with identity |
| `deleteEvent(ctx, identity, eventName)` | no-op when store missing; no-op when event not in store; deletes event; clears defaultEventName when deleting the default; removes entire store entry when last event deleted |
| `listEvents(ctx, identity)` | empty array when no store; returns sorted event names |
| `setDefault(ctx, identity, eventName)` | throws when event not in store; updates defaultEventName; calls writeStore |
| `eventCount(ctx, identity)` | 0 for missing store; correct count |
| `isBloatWarned / markBloatWarned` | get/set bloat flag per identity |

**EventEmitter note:** `storeChangeEmitter` is module-level. Tests asserting `onDidChangeTestEventStore` fires must subscribe, execute, dispose in `afterEach`.

#### `src/testEvents/identity.ts` — pure-ish, needs Uri mock

`resolveScriptIdentity(uri)` branches on `uri.scheme`. The private `parseAltium365Uri(uri)` is tested indirectly via `resolveScriptIdentity`.

**Dependency on `localScriptCache`:** `resolveScriptIdentity` calls `getLocalScript(uri.fsPath)` and `normalizeLocalScriptKey(uri.fsPath)` — both from the in-memory registry in `localScriptCache.ts`. The registry is a module-level `Map`. In tests: simply don't call `registerLocalScript` before the test → `getLocalScript` returns `undefined` (local-kind path). To test the cached-remote path: call `registerLocalScript(fsPath, identity)` in the test setup, then call `resolveScriptIdentity`.

**`normalizeLocalScriptKey(fsPath)`** calls `fsSync.realpathSync` — this hits the disk. For non-existent paths it falls back to the original path (see the `catch` block). Tests can use paths that don't exist on disk and the function still works correctly (fallback path).

**VS Code mock needed:** `vscode.Uri` with `.scheme` and `.path` and `.fsPath` properties. Simplest approach: plain objects `{ scheme: 'altium365', path: '/grid:workspace:my-team:scripts:script/uuid-here', fsPath: '' }`.

```typescript
// Minimal Uri mock sufficient for identity.ts tests
const makeUri = (scheme: string, path: string, fsPath = ''): vscode.Uri =>
    ({ scheme, path, fsPath, authority: '', query: '', fragment: '', toString: () => `${scheme}:${path}` }) as vscode.Uri;
```

| Test case | Setup |
|-----------|-------|
| `altium365://` valid GRID → remote kind, scriptId + workspaceAuthId | Uri with scheme='altium365', valid GRID path |
| `altium365://` malformed path → undefined | Uri with scheme='altium365', bad path |
| `file://` path in localScriptCache → remote kind with scriptId | `registerLocalScript(path, identity)` before call |
| `file://` path NOT in cache → local kind, identity = normalized fsPath | no registration |
| `altium365-event://` scheme → undefined | Uri with scheme='altium365-event' |

#### `src/testEvents/resolver.ts` — extract `stringifyEvent`

`stringifyEvent` is a private pure function (null/undefined filtering before `String()`). Extract and export it. Test: object with null/undefined values filtered; non-null primitives stringified; empty object → undefined.

`resolveScriptParameters` is deeply coupled to VS Code commands (`executeCommand`). Per D-08: **skip** the full resolver. Document skip.

#### `src/testEvents/importSibling.ts` — partial

`maybePromptForSiblingImport` uses `vscode.window.showInformationMessage` (D-08 skip). The precondition checks (marker exists, store exists, sibling file exists) can be tested by passing a seeded context and relying on `fs.existsSync`. But `fs.existsSync` hits disk — easier to skip the whole function and document.

**Recommended:** Skip `importSibling.ts` in Plan 11-03, document as SKIPPED. Only test `stringifyEvent` extraction.

---

### Plan 11-04: File Management (`src/remoteScriptFs.ts`, `src/testEvents/eventFs.ts`)

#### `src/remoteScriptFs.ts` — URI helpers are excellent targets

**`buildScriptUri(workspaceAuthId, scriptId, scriptName)`:** Calls `vscode.Uri.from()`. Tests: valid input → correct scheme + path; invalid authId (contains `/` or `:`) → throws Error; the built URI path matches the expected GRID format.

**`parseScriptUri(uri)`:** Calls `vscode.FileSystemError.FileNotFound(uri)`. Tests: wrong scheme → throws FileNotFound; path matches GRID regex → returns ParsedRemoteUri; invalid UUID → throws FileNotFound; round-trip `parseScriptUri(buildScriptUri(...))` returns original components.

**Mock needed:** `vscode.Uri.from()` and `vscode.FileSystemError.FileNotFound()`. Both are straightforward to mock:
- `Uri.from({scheme, path})` → returns a plain object with those properties
- `FileSystemError.FileNotFound(uri)` → returns an Error subclass

`AltiumRemoteScriptFs.readFile/writeFile` — skipped per D-08 (network-heavy). The URI parsing/building is the testable surface.

#### `src/testEvents/eventFs.ts` — extract `parseEventUri`, test `buildEventUri` round-trip

**`buildEventUri(identity, eventName)`:** Calls `vscode.Uri.from()`. Test: percent-encoding round-trip with special chars in identity/eventName; identity containing `:` (UUID-style); path shape starts with `/`.

**`parseEventUri(uri)` (private):** Extract and export. Tests: valid URI → `{identity, eventName}`; wrong scheme → undefined; missing slash → undefined; path not ending in `.json` → undefined; identity or eventName empty → undefined.

**Round-trip test:** `parseEventUri(buildEventUri(identity, eventName))` returns original values — especially important for identities containing `:` and `/` (UUID hex, Windows paths).

---

### Plan 11-05: Python-Specific (`python/_runner.py`, `src/localScriptCache.ts`)

**`src/localScriptCache.ts`:**
- `normalizeLocalScriptKey(fsPath)` — hits `fs.realpathSync`. For non-existent paths falls back to input. Test: platform-conditional lowercase on darwin/win32; non-existent path uses original; existing path resolves symlinks (skip on CI unless tmpdir stable).
- `registerLocalScript / getLocalScript` — pure in-memory registry ops. Test: register then get by same path; case-insensitive lookup on darwin; miss on unregistered path.
- `findLocalScriptByRemoteId(scriptId)` — tests: finds registered entry by scriptId; returns undefined when not present.
- `rehydrateLocalScriptCacheFromDisk()` — hits `fs.readdirSync`. Only meaningful with actual temp files. **Skip or test with a real tmpdir fixture.**

**`registerLocalScriptSaveBridge`** — uses `vscode.workspace.onDidSaveTextDocument` (D-08 skip).

**`python/_runner.py`** — Python tests are out of scope for Vitest (Node test runner). Document as SKIPPED.

---

### Plan 11-06: Altium Runtime/Dependency (`src/workspace.ts`)

**Highest-value pure functions — no VS Code mock needed:**

| Function | Mock needed | Pure? |
|----------|-------------|-------|
| `getWorkspaceApiUrl(ws, envGlobalEndpoint)` | none | YES — pure |
| `getWorkspaceFilesUrl(ws, fallback)` | none | YES — pure, throws on missing URL |
| `GraphQLError` constructor | none | YES — class test |
| `graphqlRequest(endpoint, token, query)` | `fetch` global mock | near-pure |

**`getWorkspaceApiUrl` test cases:**
- `ws.location.apiServiceUrl` present and non-empty → return it
- `ws.location.apiServiceUrl` empty/whitespace → return `envGlobalEndpoint`
- `ws` undefined → return `envGlobalEndpoint`

**`getWorkspaceFilesUrl` test cases:**
- `ws.location.filesServiceUrl` present → return it
- `ws` undefined, fallback given → return fallback
- `ws` undefined, no fallback → throws `'Workspace filesServiceUrl unavailable'`

**`graphqlRequest` test cases (fetch mock):**
- HTTP 200 with data → returns `payload.data`
- HTTP 200 with `errors[]` → throws `GraphQLError` with message + code from first error
- HTTP 4xx → throws plain `Error` with status
- Non-JSON response body → throws plain `Error`
- `errors` is not an array → handled (wrapped in array)

**`listWorkspaces`, `listScripts`, `listProjects`, `listExtensionPoints`** — all delegate to `graphqlRequest`. Test the data-shaping logic with a mocked response (e.g., `listExtensionPoints` builds the Map correctly from the `assignments.nodes` shape).

**`checkAppInstalled`** — test: installed apps list contains appId → true; list does not contain appId → false; empty array → false; non-array `gloAppInstalledApps` → false.

---

### Plan 11-07: Entity/Platform API (Script identity round-trip, app installation)

This plan covers the integration between the URI helpers and identity resolution — specifically:

**Script identity round-trip (`buildScriptUri` + `parseScriptUri`):**
```typescript
// The round-trip:
const uri = buildScriptUri(authId, scriptId, displayName);
const parsed = parseScriptUri(uri);
// parsed.authId === authId, parsed.scriptId === scriptId
```
These tests already belong to Plan 11-04 and can be referenced here, or an explicit round-trip test can live in `test/scriptIdentity.test.ts`.

**App installation check (`checkAppInstalled`, `installApp`):**
- `checkAppInstalled` — covered in Plan 11-06 above
- `installApp` permission error mapping: GraphQL error with code `AUTH_FORBIDDEN` → throws admin escalation message; code `PERMISSION_DENIED` → same; other GraphQL errors → re-throw; non-GraphQL errors → re-throw

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-memory SecretStorage | Custom class | `makeSecretStorage()` factory (D-03) | Map-backed, reusable; factories keep tests composable |
| fetch mock | Custom http server | `vi.stubGlobal('fetch', vi.fn())` | Standard Vitest global stub; no network |
| VS Code Uri construction | String manipulation | `vscode.Uri.from({scheme, path})` in mock | Mock returns plain object; tests match structural shape |
| Module state reset between tests | Module re-import per test | `beforeEach` factory re-instantiation (D-02) | Module-level emitters (`authStateEmitter`, `storeChangeEmitter`) cannot be reset; factories handle per-test state |

---

## Common Pitfalls

### Pitfall 1: Module-Level EventEmitter Listener Bleed
**What goes wrong:** `authStateEmitter` and `storeChangeEmitter` are created once at module import. A test subscribes to `onAuthStateChanged`, triggers an action, but forgets to dispose — the listener persists into the next test. `clearAllTokens` in the next test fires the event and the stale listener runs.
**How to avoid:** Always call `const d = onAuthStateChanged(handler)` and `afterEach(() => d.dispose())`. Or use `once`-style: subscribe inside the test, dispose immediately after the assertion.

### Pitfall 2: `normalizeLocalScriptKey` Calls `realpathSync`
**What goes wrong:** Tests that call `resolveScriptIdentity` with a `file://` URI pass a `uri.fsPath` that doesn't exist on disk. `realpathSync` throws `ENOENT`; the catch block returns the original path. This is the **correct fallback** — tests using non-existent paths will still work.
**Warning sign:** If a test registers a real temp file path and `realpathSync` resolves a symlink, the normalised key may differ from the input. On macOS: `/tmp` resolves to `/private/tmp`. Always use `normalizeLocalScriptKey` when constructing registry keys in test setup.

### Pitfall 3: `vscode.Uri.from()` Mock Must Preserve Raw Values
**What goes wrong:** If the `Uri.from` mock applies URL-encoding to the path, `parseScriptUri` and `parseEventUri` will fail to match their regexes (which expect raw path characters). The real VS Code `Uri.from` also preserves raw path characters — the mock should too.
**How to avoid:** Mock `Uri.from({scheme, path}) → { scheme, path, toString: () => ... }` with no further encoding.

### Pitfall 4: `FileSystemError` Is an Error Subclass
**What goes wrong:** Tests that `expect(() => parseScriptUri(badUri)).toThrow(...)` may fail if the mock `FileSystemError.FileNotFound` returns a plain object instead of an Error.
**How to avoid:** Mock `FileSystemError.FileNotFound(uri)` as `class FileSystemError extends Error` with a static `FileNotFound` factory that returns `new FileSystemError(...)`.

### Pitfall 5: `vi.stubGlobal('fetch', ...)` Must Be Restored
**What goes wrong:** `vi.stubGlobal` persists across tests if `vi.unstubAllGlobals()` is not called. A fetch mock from `graphqlRequest` tests bleeds into auth tests that also use `fetch` (via `postForm`).
**How to avoid:** Add `afterEach(() => vi.unstubAllGlobals())` in any test file that stubs fetch.

### Pitfall 6: `storeKey` Prefix Consistency
**What goes wrong:** Tests that manually inspect `globalState` after `writeStore` use a hardcoded key string `'altium365.scriptParams.test-identity'` but the test was actually called with a different identity. Store reads silently return `undefined`.
**How to avoid:** Use `TEST_EVENT_KEY_PREFIX` exported constant from `store.ts` when constructing expected keys in tests.

---

## Code Examples

### Minimal vscode.ts Mock Skeleton (Wave 0)

```typescript
// test/__mocks__/vscode.ts
import { vi } from 'vitest';

// ── EventEmitter ──────────────────────────────────────────────────
export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    fire(event: T): void { this.listeners.forEach(l => l(event)); }
    get event(): (listener: (e: T) => void) => Disposable {
        return (listener) => {
            this.listeners.push(listener);
            return new Disposable(() => {
                this.listeners = this.listeners.filter(l => l !== listener);
            });
        };
    }
    dispose(): void { this.listeners = []; }
}

// ── Disposable ────────────────────────────────────────────────────
export class Disposable {
    constructor(private readonly _dispose: () => void) {}
    dispose(): void { this._dispose(); }
}

// ── Uri ───────────────────────────────────────────────────────────
export const Uri = {
    from: (parts: { scheme: string; path: string; authority?: string; query?: string; fragment?: string }) =>
        ({ ...parts, authority: parts.authority ?? '', query: parts.query ?? '', fragment: parts.fragment ?? '',
           fsPath: parts.path, toString: () => `${parts.scheme}:${parts.path}` }) as any,
    parse: (value: string) => {
        const [scheme, rest] = value.split(':', 2);
        return { scheme, path: rest ?? '', authority: '', fsPath: rest ?? '', toString: () => value } as any;
    },
    file: (path: string) => ({ scheme: 'file', path, authority: '', fsPath: path, toString: () => `file://${path}` }) as any,
};

// ── FileSystemError ───────────────────────────────────────────────
export class FileSystemError extends Error {
    static FileNotFound(uri?: any): FileSystemError {
        const e = new FileSystemError('FileNotFound');
        e.code = 'FileNotFound';
        return e;
    }
    static Unavailable(msgOrUri: any): FileSystemError {
        const e = new FileSystemError(typeof msgOrUri === 'string' ? msgOrUri : 'Unavailable');
        e.code = 'Unavailable';
        return e;
    }
    static FileNotADirectory(uri?: any): FileSystemError {
        const e = new FileSystemError('FileNotADirectory');
        e.code = 'FileNotADirectory';
        return e;
    }
    static NoPermissions(uri?: any): FileSystemError {
        const e = new FileSystemError('NoPermissions');
        e.code = 'NoPermissions';
        return e;
    }
    public code: string = '';
}

// ── FileType ──────────────────────────────────────────────────────
export enum FileType { Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64 }
export enum FileChangeType { Changed = 1, Created = 2, Deleted = 3 }
export enum QuickPickItemKind { Separator = -1, Default = 0 }

// ── window stubs ──────────────────────────────────────────────────
export const window = {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    createQuickPick: vi.fn(),
    setStatusBarMessage: vi.fn(),
};

// ── workspace stubs ───────────────────────────────────────────────
export const workspace = {
    getConfiguration: vi.fn(() => ({
        get: vi.fn(() => undefined),
    })),
    onDidSaveTextDocument: vi.fn(() => new Disposable(() => {})),
    fs: { writeFile: vi.fn() },
};

// ── commands stubs ────────────────────────────────────────────────
export const commands = {
    executeCommand: vi.fn(),
};

// ── env stubs ─────────────────────────────────────────────────────
export const env = {
    openExternal: vi.fn(),
};

// ── Factory functions (D-03) ──────────────────────────────────────
export function makeSecretStorage() {
    const store = new Map<string, string>();
    return {
        get: vi.fn(async (key: string) => store.get(key)),
        store: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
        delete: vi.fn(async (key: string) => { store.delete(key); }),
        onDidChange: new EventEmitter<any>().event,
    };
}

export function makeGlobalState() {
    const store = new Map<string, unknown>();
    return {
        get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined =>
            (store.has(key) ? store.get(key) : defaultValue) as T | undefined),
        update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
        keys: vi.fn(() => [...store.keys()] as readonly string[]),
        setKeysForSync: vi.fn(),
    };
}

export function makeExtensionContext(overrides?: Record<string, unknown>) {
    return {
        secrets: makeSecretStorage(),
        globalState: makeGlobalState(),
        asAbsolutePath: vi.fn((rel: string) => `/mock/extension/${rel}`),
        subscriptions: [],
        ...overrides,
    } as any;
}
```

---

## Extraction Requirements Summary

The following private functions MUST be exported before tests can be written. Each is a D-05 prerequisite step in the relevant plan.

| Plan | Source file | Function | Action |
|------|-------------|----------|--------|
| 11-01 | `src/auth.ts` | `decodeIdTokenClaims` | Export |
| 11-01 | `src/auth.ts` | `userLabelFromClaims` | Export |
| 11-01 | `src/auth.ts` | `withExpiry` | Export |
| 11-01 | `src/auth.ts` | `isExpired` | Export |
| 11-03 | `src/testEvents/resolver.ts` | `stringifyEvent` | Export |
| 11-03 | `src/testEvents/picker.ts` | `buildPickerItems` (new extraction) | Extract from `pickTestEvent` body |
| 11-03 | `src/testEvents/picker.ts` | `previewBody` | Export |
| 11-04 | `src/testEvents/eventFs.ts` | `parseEventUri` | Export |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2.0.0 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test` (= `vitest run --passWithNoTests`) |
| Full suite command | `npm test` |
| Coverage (optional) | `npx vitest run --coverage` (no threshold) |

### Phase Requirements → Test Map

No explicit REQ-IDs were mapped to Phase 11. This is a project-level quality goal. Test coverage is the deliverable.

### Wave 0 Gaps

- [ ] `test/__mocks__/vscode.ts` — the comprehensive shared mock (currently `export {}`); must be built out in Plan 11-01 Wave 0 before any other plan
- [ ] `test/testEvents/` directory — does not exist yet; `mkdir -p` in Plan 11-03

### Sampling Rate

- **Per task commit:** `npm test` (vitest run --passWithNoTests)
- **Per wave merge:** `npm test && npm run compile`
- **Phase gate:** All new test files pass + `npm run compile` clean

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| vitest | All plans | ✓ | ^2.0.0 (in devDependencies) | — |
| Node.js ≥18 | All plans | ✓ | system Node | — |
| `npm run compile` | D-10 verification | ✓ | tsc 5.4+ | — |

---

## Open Questions

1. **`workspaceTokenMutex` and `resolveMutex` in tests**
   - What we know: Both are module-level `AsyncMutex` instances. Concurrent callers are serialized per key.
   - What's unclear: If a test hangs inside `runExclusive`, it could deadlock the test. In practice tests are sequential (`environment: 'node'`) but the mutex still needs the inner async to complete.
   - Recommendation: Don't test the mutex serialization directly (that belongs in a dedicated `asyncMutex.test.ts` if desired). Test only the observable outcomes of the functions that use the mutex.

2. **`vscode.workspace.getConfiguration` mock granularity for `readOAuthConfig`**
   - What we know: `readOAuthConfig` calls `cfg.get<string>('clientId')`, `cfg.get<string>('authEndpoint')`, etc.
   - What's unclear: Whether to provide a full named-key stub or just return a generic stub.
   - Recommendation: `workspace.getConfiguration` mock returns an object with `get: vi.fn((key) => configMap[key])` — pass the config map per test.

3. **Coverage reporting in CI**
   - What we know: `vitest@2` supports `--coverage` via `@vitest/coverage-v8`. No threshold enforcement (D-07).
   - Recommendation: Agent decides whether to add `npm run test:coverage` script pointing at `vitest run --coverage`. Not required by any decision.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `vscode.Uri.from()` preserves raw path characters without percent-encoding | Code Examples / Pitfall 3 | [ASSUMED] If the mock diverges from real Uri.from behaviour, round-trip tests pass in unit tests but fail at runtime |
| A2 | Module-level `authStateEmitter` and `storeChangeEmitter` share the same instance across all tests in a suite (not re-created) | Per-Plan Inventory / Pitfall 1 | [VERIFIED: direct code inspection] Both created at module load via `new vscode.EventEmitter<>()` — single instance per test run |
| A3 | `normalizeLocalScriptKey` falls back to the input path for non-existent files | Per-Plan Inventory §Plan 11-03 | [VERIFIED: direct code inspection] `catch { resolved = fsPath; }` on line 50 of localScriptCache.ts |

---

## Sources

### Primary (HIGH confidence — direct source code inspection)

- `src/auth.ts` (646 lines) — inspected fully
- `src/testEvents/store.ts`, `identity.ts`, `resolver.ts`, `picker.ts`, `importSibling.ts`, `eventFs.ts` — inspected fully
- `src/workspace.ts` (930 lines) — inspected fully
- `src/remoteScriptFs.ts` (350 lines) — inspected fully
- `src/localScriptCache.ts` (259 lines) — inspected fully
- `vitest.config.ts` — inspected
- `test/__mocks__/vscode.ts` — inspected (currently `export {}`)
- `test/dedupLogPage.test.ts`, `test/pythonAnalysisSync.test.ts` — inspected (established patterns)
- `package.json` scripts + devDependencies — inspected

### Secondary (MEDIUM confidence)

- Vitest 2.x API (`vi.stubGlobal`, `vi.fn`, `beforeEach`, `afterEach`) — based on vitest.config.ts having `^2.0.0`

---

## Metadata

**Confidence breakdown:**
- Testability inventory: HIGH — based on direct source file inspection
- Mock surface requirements: HIGH — derived from import analysis of each source file
- Extraction prerequisites: HIGH — based on visibility modifiers in source
- Pitfalls: HIGH — derived from code patterns (module-level state, realpathSync, etc.)

**Research date:** 2026-06-01
**Valid until:** 2026-07-01 (stable codebase; invalidated by major module refactors)
