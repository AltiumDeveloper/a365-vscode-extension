# Phase 8: distinct-vsix-version-per-build — Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 5 (1 created module, 1 created test, 3 modified)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Status | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|--------|------|-----------|----------------|---------------|
| `.github/workflows/ci.yml` | MODIFIED | ci-config | batch (build pipeline) | `.github/workflows/ci.yml` (current) | exact (extends self) |
| `package.json` | MODIFIED | manifest | config-declaration | `package.json:73-81` (`altium365.signOut` command entry) + `package.json:213-217` (`altium365.injectHelper` setting entry) | exact |
| `src/extension.ts` | MODIFIED | entry-point / activation wiring | event-driven (activation) | `src/extension.ts:113-118` (existing `register*Commands(...)` factory wiring) | exact (same file, mirror existing pattern) |
| `src/updater.ts` | CREATED | service module (network + command registration) | request-response (HTTPS GET) + event-driven (activation hook) | `src/auth.ts` (module shape) + `src/treeCommands.ts:46-49` (register-factory shape) | role-match |
| `test/updater.test.ts` | CREATED | unit test (pure helper) | pure-function I/O | `test/dedupLogPage.test.ts` | exact |

> **Test file location note:** `vitest.config.ts:5` pins `include: ['test/**/*.test.ts']`. The phase prompt mentions `src/__tests__/updater.test.ts` as one option, but the project's existing vitest setup uses a top-level `test/` directory (only `test/dedupLogPage.test.ts` exists today). Match the existing convention — put the new test at `test/updater.test.ts` (or `test/compareVersions.test.ts`, mirroring 08-RESEARCH.md's suggested boundary plan).

## Pattern Assignments

### `src/updater.ts` (service module, request-response + activation hook)

**Primary analog:** `src/auth.ts` (HTTPS via Node built-in, named exports, error surfacing, `outputChannel` log lines)
**Secondary analog:** `src/treeCommands.ts` (`register*` factory shape)

#### Imports pattern — mirror `src/auth.ts:1-6`

```typescript
import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
```

- Namespace imports for Node built-ins (`* as`) — consistent with `src/auth.ts:1-5` and `src/extension.ts:1-5`.
- Use `vscode` namespace import — never destructured.
- **No `node-fetch` / `axios` / `semver` runtime deps.** `src/auth.ts:9-13` documents WHY: `globalThis.fetch` is empirically broken in the extension host. Use `https.get`.

#### `https.get` JSON-fetch pattern — adapt from `src/auth.ts:17-76` (`postJson`)

Differences for our case: GET (not POST), GitHub-specific headers, must surface `statusCode !== 200` as error, must time out via `req.on('timeout', ...)` because anonymous GitHub API can hang.

```typescript
// Adapt from src/auth.ts:22-75 — keep the Promise+chunks idiom; swap method/headers.
function getJson(endpoint: string, timeoutMs = 8000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let url: URL;
        try { url = new URL(endpoint); }
        catch (e) { reject(new Error(`Invalid endpoint: ${endpoint}`)); return; }
        const req = https.get(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                headers: {
                    'User-Agent': 'altium365-vscode-extension',         // GitHub REST 403's without UA
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                timeout: timeoutMs,
            },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                    catch (e) { reject(e); }
                });
                res.on('error', reject);
            }
        );
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        req.on('error', reject);
    });
}
```

#### Module-level constants pattern — mirror `src/auth.ts:98-101`

`src/auth.ts:98-101` uses a small block of UPPER_SNAKE module constants for storage keys. Apply the same shape for the updater:

```typescript
// Mirror src/auth.ts:98-101 — module-private constants block near the top.
const EXTENSION_ID = 'altium.developer';  // ${publisher}.${name} — package.json:name is renamed to 'developer' in this phase (CONTEXT.md Part 3 rebrand). Was 'altium.altium365-scripting' pre-rebrand.
const GLOBAL_LAST_CHECK_KEY = 'altium365.lastUpdateCheckAt';
const RELEASES_URL = 'https://api.github.com/repos/altium/a365-vscode-extension/releases';
const DEBOUNCE_MS = 24 * 60 * 60 * 1000;
```

#### Factory-export shape — mirror `src/treeCommands.ts:46-49`

The project's idiomatic shape for command-registration modules is `register*(context, outputChannel): vscode.Disposable[]`, with the caller spreading the result into the single `context.subscriptions.push(...)` block at `src/extension.ts:119`.

```typescript
// Source: src/treeCommands.ts:46-49 (exact shape)
export function registerTreeCommands(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('altium365.tree.copyId', ...),
    ];
}
```

> **Planner decision point:** 08-RESEARCH.md:206-222 sketches `registerUpdater(context, outputChannel): void` that pushes onto `context.subscriptions` internally. The project convention (`registerTreeCommands`, `registerScriptCommands`, `registerTestEventCommands` at `src/extension.ts:113-115`) is to **return `Disposable[]`** and let `activate()` spread them. **Recommend the planner pick the `Disposable[]` return shape** for consistency, and fire-and-forget the auto-check from inside the factory body (the `void runCheck(...)` call doesn't need to be a disposable — it's a one-shot side effect). Both shapes work; the return-array shape matches three existing precedents in the same file.

#### Error-handling pattern — split by user-visible vs background

`src/auth.ts` surfaces errors with structured prefixes thrown out for the caller (`postForm` lines 198-204). The convention from `AGENTS.md`: errors at the command boundary use `vscode.window.showErrorMessage`. For Phase 8 the contract is:

| Trigger | Surface |
|---------|---------|
| Auto check (activation-time) failure | `outputChannel.appendLine(...)` only, swallow (CONTEXT.md:80) |
| Manual command failure | `outputChannel.appendLine(...)` + `vscode.window.showErrorMessage('Altium 365: ...')` |

**Log-line tag convention** — every log line is prefixed `[Altium 365] <category>: <message>`. Examples found in repo:

```typescript
// src/extension.ts:193-195
outputChannel.appendLine(
    `[Altium 365] testEvents.activate: subsystem active — ${identityCount} identities tracked.`
);
// src/extension.ts:207-209
outputChannel.appendLine(`[Altium 365] Rehydrated ${n} local script(s) from tmpdir cache.`);
// src/treeCommands.ts:55
output.appendLine('[Altium 365] tree.copyId: ignored kind=undefined');
```

→ Updater log prefix: `[Altium 365] updater: ...` (matches the `testEvents.activate:` shape).

#### globalState read/write pattern — mirror `src/auth.ts:461-465`

```typescript
// Source: src/auth.ts:461-465 (read+write idiom with default)
const index = context.globalState.get<string[]>(GLOBAL_WS_TOKEN_INDEX_KEY, []);
if (!index.includes(workspace.workspaceId)) {
    const next = [...index, workspace.workspaceId];
    await context.globalState.update(GLOBAL_WS_TOKEN_INDEX_KEY, next);
}
```

→ For the debounce timestamp:

```typescript
const last = context.globalState.get<number>(GLOBAL_LAST_CHECK_KEY, 0);
if (Date.now() - last < DEBOUNCE_MS) { return; /* debounced */ }
// ... after a successful check:
await context.globalState.update(GLOBAL_LAST_CHECK_KEY, Date.now());
```

> Store as `number` (epoch ms) rather than the ISO string CONTEXT.md mentions — `globalState` round-trips numbers losslessly and avoids `Date.parse` quirks. Either is acceptable per CONTEXT decision; numeric is simpler.

---

### `src/extension.ts` (modified — activation wiring)

**Analog:** existing `register*Commands(...)` calls at `src/extension.ts:113-118` and their inclusion at `src/extension.ts:173-178`.

**Add the new import (alphabetical block at top is not enforced — group at end of existing `./xxx` imports):**

```typescript
// New import — add near src/extension.ts:24 (other local-module imports)
import { registerUpdater } from './updater';
```

**Add the factory call alongside other registrars** — pattern from `src/extension.ts:113-117`:

```typescript
// Source: src/extension.ts:113-117 (factory-call block)
const scriptCommandDisposables = registerScriptCommands(context, outputChannel);
const treeCommandDisposables = registerTreeCommands(context, outputChannel);
const testEventCommandDisposables = registerTestEventCommands(context, outputChannel);
const testEventStatusDisposables = registerTestEventStatusItem(context);
const localScriptSaveBridge = registerLocalScriptSaveBridge(outputChannel, remoteFs);

// → ADD:
const updaterDisposables = registerUpdater(context, outputChannel);
```

**Spread into the single `subscriptions.push` block** — pattern from `src/extension.ts:173-177`:

```typescript
// Source: src/extension.ts:173-177
...scriptCommandDisposables,
...treeCommandDisposables,
...testEventCommandDisposables,
...testEventStatusDisposables,
localScriptSaveBridge

// → ADD:
...updaterDisposables,
```

> **No other `activate()` changes required.** The auto-check fire-and-forget runs inside `registerUpdater`'s body (synchronous return after dispatching `void runCheck(...)`), so activation never awaits the network call — matches the "Pattern 1" anti-pattern guard in 08-RESEARCH.md:200-222.

---

### `package.json` (modified — add 1 command + 1 setting)

**Analog for command entry:** `package.json:77-81` (the `altium365.signOut` command — simplest existing entry, no `icon`).

```jsonc
// Source: package.json:77-81 (exact entry shape — `command`, `title`, `category`)
{
    "command": "altium365.signOut",
    "title": "Sign Out",
    "category": "Altium 365"
},
```

→ Append to `contributes.commands` array (`package.json:45-159`):

```jsonc
{
    "command": "altium365.checkForUpdates",
    "title": "Check for Updates",
    "category": "Altium 365"
}
```

**Analog for setting entry:** `package.json:213-217` (the `altium365.injectHelper` boolean — exact shape match: `type: boolean`, `default`, `description`).

```jsonc
// Source: package.json:213-217 (exact shape — type/default/description)
"altium365.injectHelper": {
    "type": "boolean",
    "default": true,
    "description": "Inject the bundled 'a365' helper module on PYTHONPATH so scripts can `import a365`."
},
```

→ Append to `contributes.configuration.properties` (`package.json:162-267`):

```jsonc
"altium365.checkForUpdates": {
    "type": "boolean",
    "default": true,
    "description": "Automatically check GitHub Releases for newer Altium 365 extension builds once per day. Manual checks via the 'Altium 365: Check for Updates' command are always available."
}
```

**Indentation / style:** `package.json` uses **2-space indent** (verified by reading the file — note this differs from the 4-space TS rule). Trailing comma absent (it's strict JSON). Match the existing key-order convention: `type`, `default`, `description` (verified across all 16 existing `altium365.*` properties).

**No `menus.commandPalette` hide entry needed** — the new command is palette-visible by default (the "when": false suppressions at `package.json:287-320` only apply to commands deliberately hidden from the palette). Confirm via the manual UAT script.

---

### `test/updater.test.ts` (created — vitest unit coverage for the pure helper)

**Analog:** `test/dedupLogPage.test.ts` (the only existing vitest file in the repo, landed in commit `2200a21` per phase-prompt). Mirrors structure 1:1.

**Imports + describe shape — exact mirror of `test/dedupLogPage.test.ts:1-3`:**

```typescript
// Source: test/dedupLogPage.test.ts:1-3
import { describe, it, expect } from 'vitest';
import { dedupLogPage } from '../src/logDedup';

describe('dedupLogPage', () => {
    it('empty first page → no output, count stays 0', () => {
        const r = dedupLogPage([], 0);
        expect(r.fresh).toEqual([]);
        expect(r.newPrintedCount).toBe(0);
    });
    // ...
});
```

→ For the comparator:

```typescript
import { describe, it, expect } from 'vitest';
import { compareVersions } from '../src/updater';

describe('compareVersions', () => {
    it('normal > pre-release of same base', () => {
        expect(compareVersions('0.1.0', '0.1.0-ci.42')).toBeGreaterThan(0);
    });
    // ... 6 more cases per 08-RESEARCH.md:606-633
});
```

**Conventions to honor (verified in `test/dedupLogPage.test.ts`):**
- 4-space indent inside test bodies (matches `.editorconfig` for TS files).
- Single quotes (matches `src/*.ts` convention).
- Arrow-prose style for `it()` titles (`'normal > pre-release of same base'`) — exact mirror of `'first page with 3 lines → all printed, count = 3'`.
- Relative import to `../src/updater` (NOT a path alias — the project has no `tsconfig` paths set up for tests; verified by inspecting `test/dedupLogPage.test.ts:2` using `'../src/logDedup'`).
- The pure helper MUST live in a file with zero `vscode` imports OR be split into a separate file. `src/logDedup.ts:17-19` documents: *"This module intentionally has zero VS Code imports so it can be unit-tested under vitest's node environment without stubbing the `vscode` API."* — **same constraint applies to `compareVersions`/`parseVersion`.**

> **Architectural implication:** if the planner keeps `compareVersions` inside `src/updater.ts` (which imports `vscode`), the vitest run will fail to resolve `vscode` from the node env. Two options: (a) split the pure helpers into `src/semverCompare.ts` and re-export from `src/updater.ts`, or (b) wire a `vscode` stub in `vitest.config.ts`. **Recommend (a)** — matches the `src/logDedup.ts` precedent verbatim and keeps `vitest.config.ts` untouched.

---

### `.github/workflows/ci.yml` (modified — extend with versioning + release)

**Analog:** the file itself (current 21 lines, see read above). Existing structure to preserve:

```yaml
# Current — .github/workflows/ci.yml (full)
name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run compile
      - run: npm run package
      - uses: actions/upload-artifact@v4
        with:
          name: altium365-vsix
          path: '*.vsix'
```

**Conventions verified:**
- 2-space YAML indent.
- Single quotes for string values (`'20'`, `'*.vsix'`).
- `actions/*@v4` is the pinned major-version style — keep `softprops/action-gh-release@v2` consistent.
- `npm run package` already wraps `vsce package` (`package.json:445`). The Phase 8 workflow must call `npx vsce package --pre-release` directly on main (the `--pre-release` flag isn't in the npm script) — keep the existing `npm run package` only for non-main.

**Net changes (per 08-RESEARCH.md:397-460):**
1. Add `pull_request` trigger so PRs still produce an artifact-only VSIX.
2. Add `permissions: contents: write` at job or workflow level (required for `softprops/action-gh-release@v2`).
3. Add conditional "Compute version" step (`if: github.ref == 'refs/heads/main'`) — sets `steps.ver.outputs.version` and runs `npm version --no-git-tag-version --allow-same-version`.
4. Split the package step into two `if`-guarded variants (main → `--pre-release`, non-main → plain).
5. Add `npm test` between compile and package (gate releases on green tests — vitest is already in devDeps and `package.json:446` defines `"test": "vitest run --passWithNoTests"`).
6. Add the `softprops/action-gh-release@v2` step gated on `if: github.ref == 'refs/heads/main'`.

> **No new branches added to the `on.push` filter.** CONTEXT.md:59 explicitly says "only `main` builds get the unique version + release."

---

## Shared Patterns

### Pattern A — `outputChannel` singleton, passed (never global)

**Source:** `src/extension.ts:31` declares `let outputChannel: vscode.OutputChannel;` then *passes it* to every register/factory (`src/extension.ts:91, 93, 113-117`). Modules never import or recreate the channel.

**Apply to:** `src/updater.ts` MUST accept `outputChannel` as a parameter to `registerUpdater(context, outputChannel)` and pass it down to private helpers (`runCheck`, `downloadVsix`, etc.). Per AGENTS.md / CONVENTIONS.md: *"No module-level state except `outputChannel` singleton"* — and that singleton lives in `extension.ts`, not the new module.

### Pattern B — Best-effort async from `activate()`, never awaited

**Source:** `src/extension.ts:225` (`void updateSignedInContext(context);`) and the surrounding `try { ... } catch { /* best-effort */ }` block at `:204-215`.

```typescript
// src/extension.ts:225 — fire-and-forget pattern (no await in activate)
void updateSignedInContext(context);
```

**Apply to:** the auto-update check inside `registerUpdater`. Wrap the top of `runCheck({ manual: false })` in `try/catch` and route any thrown error to `outputChannel.appendLine(...)`. Never let auto-check failures bubble.

### Pattern C — Async command handlers, errors surfaced at the boundary

**Source:** `src/extension.ts:137-145` (`installScriptDependencies` registration — async arrow inside `registerCommand`, surfaces success via `showInformationMessage`).

```typescript
// src/extension.ts:137-145
vscode.commands.registerCommand('altium365.installScriptDependencies', async () => {
    const python = await resolvePythonPath();
    const ok = await ensureSandboxDeps(context, python, outputChannel, true);
    if (ok) {
        vscode.window.showInformationMessage(
            'Altium 365: script dependencies installed.'
        );
    }
}),
```

**Apply to:** the manual `altium365.checkForUpdates` registration. Wrap the body in `try/catch` and call `vscode.window.showErrorMessage('Altium 365: update check failed — see Output panel')` on failure (manual invocation deserves user feedback, per CONTEXT.md:88 and 08-RESEARCH.md Q2 recommendation).

### Pattern D — Defensive URL/scheme validation before external I/O

**Source:** `src/treeCommands.ts:12-36` (`openExternalHttpUrl` — refuses non-http(s) schemes before passing to `vscode.env.openExternal`).

**Apply to:** the redirect-following downloader. After each 302, validate `res.headers.location` parses to `https:` before recursing. Cap hops at 5 (08-RESEARCH.md:271). Optionally validate the post-redirect host is `*.githubusercontent.com` or `*.amazonaws.com` (CONTEXT-permitted: 08-RESEARCH.md:664 says TLS-only is acceptable; planner picks based on threat-model strictness).

### Pattern E — Module-level constants for storage keys

**Source:** `src/auth.ts:98-101` — UPPER_SNAKE module constants for `globalState`/`secrets` keys, with the `altium365.` namespace prefix baked into the string.

**Apply to:** `GLOBAL_LAST_CHECK_KEY = 'altium365.lastUpdateCheckAt'` (and any other keys the updater introduces). Single-namespace convention keeps storage discoverable.

---

## No Analog Found

| File | Reason | Planner direction |
|------|--------|-------------------|
| (none) | Every file has a strong analog in the existing codebase | Planner references this PATTERNS.md verbatim |

---

## Metadata

**Analog search scope:** `src/`, `test/`, `.github/workflows/`, `package.json`, `.planning/codebase/`
**Files scanned:** 7 (auth.ts, extension.ts, treeCommands.ts, logDedup.ts, dedupLogPage.test.ts, ci.yml, package.json)
**Pattern extraction date:** 2026-05-25
**Confidence:** HIGH — every pattern cited has a concrete file:line reference in the current codebase.
