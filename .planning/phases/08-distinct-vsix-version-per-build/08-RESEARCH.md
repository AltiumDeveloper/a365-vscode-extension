# Phase 8: distinct-vsix-version-per-build — Research

> **AMENDMENT 2026-05-25 — EXTENSION REBRAND:** Phase 8 now also renames the extension to **`altium.developer`** (displayName **"Altium Developer"**). See CONTEXT.md "Part 3 — Extension Rebrand" for the authoritative decision. Throughout this research file, every mention of the extension ID `altium.altium365-scripting`, the package name `altium365-scripting`, the displayName `Altium 365 Developer Tools`, and any VSIX filename of the form `altium365-scripting-*.vsix` is **superseded** — the correct values are `altium.developer`, `developer`, `Altium Developer`, and `developer-*.vsix` respectively. The original strings are preserved below for historical accuracy and for the Pitfall #1 narrative (which still applies — the publisher.name shape is the same gotcha, just with the new name). Command IDs (`altium365.*`) and config keys (`altium365.*`) are explicitly unchanged.

**Researched:** 2026-05-25
**Domain:** GitHub Actions CI versioning + VS Code extension self-updater
**Confidence:** HIGH (most decisions are locked in CONTEXT.md; research validates them and surfaces gotchas)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Part 1 — CI versioning**
- Phase 8 ships BOTH Part 1 (CI versioning) AND Part 2 (in-extension self-updater, ~100 LOC).
- Version scheme: `${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}` (e.g. `0.1.0-ci.42+a1b2c3d`).
  - `BASE` reads from current `package.json` version.
  - `-ci.N` pre-release suffix monotonic per Actions run number.
  - `+SHA7` is semver build metadata (audit trail).
- Version write: `npm version "$VERSION" --no-git-tag-version --allow-same-version` in CI only; never committed back.
- `npx vsce package --pre-release` required (version carries pre-release tag).
- Every push to `main` auto-creates a GitHub Release; name = computed version; `.vsix` attached as release asset. Release body = head commit message.
- Existing `actions/upload-artifact` step stays (parallel channel for short-lived debugging).
- Only `main` builds get the unique version + release. Non-main keeps producing the static-version VSIX in the workflow artifact (local install testing for reviewers). No PR-numbered versions in v1.

**Part 2 — Self-updater (Option B, ~100 LOC)**
- New setting `altium365.checkForUpdates` (boolean, default `true`), under existing `contributes.configuration.properties`.
- Activation-time check debounced to once per 24h via `globalState` key `altium365.lastUpdateCheckAt` (ISO timestamp).
- Endpoint: `GET https://api.github.com/repos/altium/a365-vscode-extension/releases` (LIST, not `/releases/latest` — pre-releases would be excluded). Filter `draft == true` out; sort by `published_at` desc; take first.
- No auth header (public repo; anonymous 60 req/hr quota fine for 24h debounce).
- Tiny inline semver comparator in `src/updater.ts` (no runtime deps). Parse `MAJOR.MINOR.PATCH-ci.N` ignoring `+SHA7`; compare `(MAJOR,MINOR,PATCH)` then `N`.
- UX: `vscode.window.showInformationMessage("Altium 365: v{X} available", "Update Now", "Later")`.
  - `Update Now` → download VSIX to `os.tmpdir()` via `https.get` (no new deps) → `workbench.extensions.installExtension` with `Uri.file(vsixPath)` → prompt reload via `workbench.action.reloadWindow`.
  - `Later` → dismiss; next 24h window re-prompts if still newer.
- Manual command `altium365.checkForUpdates` registered in `package.json` (palette-visible). Bypasses debounce.
- Errors during AUTO check → log to existing `outputChannel`, no user toast. Best-effort; never blocks activation.
- Asset selection: `name` ends with `.vsix`. Multiple → largest. Zero → log and skip.
- No checksum verification in v1.

### Claude's Discretion (implementation details)
- File layout: extract `src/updater.ts` vs inline in `src/extension.ts` — planner picks based on LOC (~80 threshold).
- Release-creation action: `softprops/action-gh-release@v2` vs `gh release create` shell.
- Whether manual command shows "no update available" toast.
- Output-channel category prefix for updater logs.

### Deferred Ideas (OUT OF SCOPE)
- Signed VSIX builds.
- Marketplace publish from CI.
- Channel-based updates (stable/insiders).
- Update rollback / install-specific-version QuickPick.
- Hand-curated release notes / CHANGELOG.
- Pre-install checksum verification.
- Status-bar update indicator.
</user_constraints>

## Project Constraints (from AGENTS.md)
- All VS Code commands prefixed `altium365.` — new `altium365.checkForUpdates` command/setting comply.
- Async/await throughout; errors at command boundary surfaced via `vscode.window.showErrorMessage` (but AUTO update check is silent per CONTEXT — only MANUAL command surfaces user-facing messages).
- Single `outputChannel` singleton — updater logs MUST go through it (passed from `activate()`).
- No module-level state except `outputChannel`.
- Atomic commit per plan (one commit per completed plan).
- Token storage via `context.secrets` — N/A here (no secret material; downloaded VSIX in `os.tmpdir()`).
- TypeScript `strict: true`, 4-space indent, single quotes, trailing commas, `interface` over `type`, named exports, no barrel files.
- Module pattern mirrors `src/auth.ts` / `src/workspace.ts`: public functions exported, helpers module-private, namespace-imported Node built-ins.

## Summary

Phase 8 has two halves that must ship together: (Part 1) the CI workflow stamps every push-to-main with a unique pre-release version (`${BASE}-ci.${RUN_NUMBER}+${SHA7}`), packages a `--pre-release` VSIX, and publishes it as a GitHub Release asset; (Part 2) a new `src/updater.ts` module polls the GitHub Releases API on activation (24h-debounced), compares the latest release's version against the running extension's version using a tiny inline SemVer 2.0 comparator, and offers a toast-driven download → `workbench.extensions.installExtension` → reload flow. Both halves are mechanically simple — the research effort is in surfacing three real gotchas: (a) vsce's tolerance of SemVer `+build-metadata`, (b) the extension ID is `altium.altium365-scripting`, not the guessed `altium.altium365`, and (c) Node's `https.get` does not follow 302 redirects, which matters for `browser_download_url` (S3-signed).

**Primary recommendation:** Use `softprops/action-gh-release@v2` for release publishing (one-step, declarative, gates trivially on `if: github.ref == 'refs/heads/main'`). Implement the updater as a separate `src/updater.ts` exporting a single `registerUpdater(context, outputChannel)` — at ~100 LOC + a pure `compareVersions` helper for unit-testing in vitest, it clears the size threshold and matches the existing `auth.ts`/`workspace.ts` module pattern.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Build versioning (stamp version, package VSIX) | CI / GitHub Actions | — | Build-time concern; never runs in extension host |
| Release publishing (create GH Release, attach VSIX) | CI / GitHub Actions | GitHub Releases API | Same CI job; releases are the distribution channel |
| Update polling (LIST releases, choose latest) | Extension host (Node runtime) | GitHub Releases API | Network read, runs in extension `activate()` |
| Version comparison | Extension host (pure helper) | — | No I/O; testable in vitest in pure-Node env |
| VSIX download | Extension host (Node `https`) | GitHub Releases CDN (S3 redirect) | Binary download to `os.tmpdir()` |
| Install + reload | VS Code command tier | `workbench.extensions.installExtension` + `workbench.action.reloadWindow` | Built-in VS Code commands; no third-party API |
| Settings + command surface | `package.json` `contributes` | — | Manifest tier; user-facing |

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@vscode/vsce` | ^3.9.1 (devDep) | VSIX packaging + `--pre-release` flag | Official VS Code packaging tool [VERIFIED: package.json:453] |
| Node `https` (built-in) | bundled | JSON fetch + VSIX download | Already used in `src/auth.ts` for OAuth (no `fetch` — extension host quirk per Phase 02.3 D-17) [VERIFIED: src/auth.ts:3] |
| `vscode` API | ^1.85.0 | `commands.executeCommand`, `extensions.getExtension`, `Uri.file`, `globalState`, `window.showInformationMessage` | Mandatory [VERIFIED: package.json:8] |
| `vitest` | ^2.0.0 (devDep) | Pure-helper unit tests | Already bootstrapped in Phase 7 [VERIFIED: package.json:454, vitest.config.ts] |

### New CI dependency
| Action | Version | Purpose |
|--------|---------|---------|
| `softprops/action-gh-release` | `@v2` | Create GitHub Release + attach assets in one step [CITED: github.com/softprops/action-gh-release] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `softprops/action-gh-release@v2` | `gh release create` shell | More verbose YAML; needs explicit `GH_TOKEN` env; trickier multi-line body (head commit message can contain quotes/backticks). Action handles all of this declaratively. |
| Inline updater in `extension.ts` | Separate `src/updater.ts` | At ~100 LOC + a testable pure helper, a separate module matches the `auth.ts`/`workspace.ts` convention and keeps `extension.ts` (already 910 LOC) from growing further. |
| Adding `semver` npm package | Inline regex parser | Phase decision: zero new runtime deps. SemVer-2.0 precedence for the `-ci.N` shape is ~15 lines of logic. |
| `node-fetch` / `axios` | Built-in `https.get` | Same dep-minimisation rule; `src/auth.ts` already establishes the precedent (and documents why `globalThis.fetch` is broken in extension host). |

**No `npm install` required.** All needed pieces are already in `devDependencies`; runtime imports are Node built-ins + `vscode`.

## Package Legitimacy Audit

Only one new external dependency is introduced (a GitHub Action, not an npm package).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `softprops/action-gh-release@v2` | GitHub Marketplace | 7+ yrs | tens of millions of runs | github.com/softprops/action-gh-release (4k+ stars) | N/A (not an npm package) | Approved [CITED: github.com/softprops/action-gh-release] |

No new npm runtime or dev packages installed. No slopcheck/`npm view` step needed.

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────┐
   git push main ─────▶│  GitHub Actions: ci.yml             │
                       │  1. checkout                        │
                       │  2. compute VERSION                 │
                       │     BASE-ci.N+SHA7                  │
                       │  3. npm version $VERSION            │
                       │     --no-git-tag-version            │
                       │     --allow-same-version            │
                       │  4. npm ci && npm run compile       │
                       │  5. vsce package --pre-release      │
                       │  6a. upload-artifact (always)       │
                       │  6b. softprops/action-gh-release    │
                       │      (if main) → create release,    │
                       │      attach .vsix                   │
                       └────────────────┬────────────────────┘
                                        │
                                        ▼
                       ┌─────────────────────────────────────┐
                       │  GitHub Releases API                │
                       │  /repos/altium/a365-vscode-         │
                       │  extension/releases                 │
                       └────────────────┬────────────────────┘
                                        │ poll (24h debounced)
                                        ▼
   VS Code activate() ─▶ registerUpdater(ctx, outputChannel)
                            │
                            ├─▶ check globalState last-check
                            │     timestamp; if < 24h ago, skip
                            │
                            ├─▶ https.get LIST releases (5s timeout)
                            │     ↓ on error: log + return
                            │
                            ├─▶ filter draft==false; sort by
                            │     published_at desc; pick [0]
                            │
                            ├─▶ compareVersions(installed, latest)
                            │     ↓ if latest <= installed: log + return
                            │
                            ├─▶ showInformationMessage(
                            │     "v{X} available",
                            │     "Update Now", "Later")
                            │     ↓ "Later" or dismissed: return
                            │     ↓ "Update Now":
                            │
                            ├─▶ https.get vsix asset to os.tmpdir()
                            │     (must follow 302 redirects manually)
                            │
                            ├─▶ executeCommand(
                            │     'workbench.extensions
                            │      .installExtension',
                            │     Uri.file(vsixPath))
                            │
                            └─▶ showInformationMessage(
                                  "Reload to apply", "Reload Now")
                                  ↓ executeCommand(
                                    'workbench.action.reloadWindow')
```

### Recommended Project Structure
```
src/
├── extension.ts        # activate() calls registerUpdater(context, outputChannel)
├── updater.ts          # NEW — public registerUpdater + compareVersions
│                       # private helpers: fetchReleases, pickLatest, download,
│                       # readDebounceState, writeDebounceState
├── auth.ts             # unchanged — pattern source
├── workspace.ts        # unchanged — pattern source
└── ...

test/
└── compareVersions.test.ts  # NEW — pure helper coverage

.github/workflows/
└── ci.yml              # MODIFIED — stamp version + release step

package.json            # MODIFIED — +1 setting, +1 command
```

### Pattern 1: VS Code activation-time best-effort task
**What:** Run a non-critical async task from `activate()` without awaiting it, swallowing all errors to a log channel.
**When to use:** Update checks, telemetry, anything that must never delay activation or break the extension.
**Example:**
```typescript
// Source: project pattern (mirrors how src/extension.ts treats updateSignedInContext)
export function registerUpdater(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
): void {
    // Manual command — always registered, bypasses debounce.
    context.subscriptions.push(
        vscode.commands.registerCommand('altium365.checkForUpdates', () =>
            runCheck(context, outputChannel, { manual: true }),
        ),
    );

    // Auto check — fire-and-forget; never blocks activate().
    const cfg = vscode.workspace.getConfiguration('altium365');
    if (cfg.get<boolean>('checkForUpdates', true)) {
        void runCheck(context, outputChannel, { manual: false });
    }
}
```

### Pattern 2: Node `https.get` JSON with timeout + GitHub API headers
**What:** Match the existing `src/auth.ts` `postJson` style for HTTP I/O.
**Example:**
```typescript
// Source: adapted from src/auth.ts postJson (lines 14-50ish)
function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'altium365-vscode-extension',  // GitHub API REQUIRES UA
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch (e) { reject(e); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        req.on('error', reject);
    });
}
```
> GitHub REST requires a `User-Agent` header or it returns HTTP 403 [CITED: docs.github.com/en/rest/overview/resources-in-the-rest-api#user-agent-required].

### Pattern 3: Following 302 redirects for asset download
**What:** GitHub `browser_download_url` returns 302 → S3 signed URL. Node `https.get` does NOT auto-follow.
**Example:**
```typescript
function downloadFollowingRedirects(
    url: string,
    destPath: string,
    maxHops = 5,
    timeoutMs = 60000,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const visit = (currentUrl: string, hopsLeft: number) => {
            if (hopsLeft < 0) { reject(new Error('too many redirects')); return; }
            const req = https.get(currentUrl, {
                headers: { 'User-Agent': 'altium365-vscode-extension' },
                timeout: timeoutMs,
            }, (res) => {
                const status = res.statusCode ?? 0;
                if (status >= 300 && status < 400 && res.headers.location) {
                    res.resume();  // discard body
                    const next = new URL(res.headers.location, currentUrl).toString();
                    visit(next, hopsLeft - 1);
                    return;
                }
                if (status !== 200) {
                    res.resume();
                    reject(new Error(`download HTTP ${status}`));
                    return;
                }
                const out = fs.createWriteStream(destPath);
                res.pipe(out);
                out.on('finish', () => out.close(() => resolve()));
                out.on('error', reject);
            });
            req.on('timeout', () => req.destroy(new Error('download timeout')));
            req.on('error', reject);
        };
        visit(url, maxHops);
    });
}
```

### Anti-Patterns to Avoid
- **`globalThis.fetch` in extension host** — empirically broken for streamed bodies (see `src/auth.ts:7-12` Phase 02.3 D-17). Use `https.get` like the rest of the codebase.
- **Awaiting the update check inside `activate()`** — slow GitHub responses would delay every command/UI subscription registered after it.
- **Throwing from the auto-check** — never reaches a UI surface; the user sees nothing while the extension silently breaks. Wrap the top of `runCheck` in `try/catch` and route to `outputChannel`.
- **Trusting `/releases/latest`** — GitHub excludes pre-releases; every CI build is a pre-release; this endpoint would return stale or 404 [CITED: docs.github.com/en/rest/releases/releases#get-the-latest-release].
- **Storing the downloaded VSIX in the extension storage path** — `context.globalStorageUri` survives reloads and bloats over time. Use `os.tmpdir()` (OS cleans up) per CONTEXT decision and `src/extension.ts` precedent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Creating a GitHub Release + attaching binary | Custom `gh api` shell pipeline | `softprops/action-gh-release@v2` | Handles tag creation, multi-line body escaping, glob asset upload, idempotency |
| Stamping `package.json` version in CI | `jq` / `sed` write | `npm version "$VERSION" --no-git-tag-version --allow-same-version` | Validates SemVer shape; updates `package-lock.json` too; built into npm [CITED: docs.npmjs.com/cli/v10/commands/npm-version] |
| Installing a VSIX programmatically | Spawning `code --install-extension` | `vscode.commands.executeCommand('workbench.extensions.installExtension', uri)` | Works in remote/codespaces/Cursor; no PATH assumption; integrates with VS Code's extension lifecycle [CITED: github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/extensions/browser/extensionsActions.ts] |
| Forcing a reload | `process.exit` or telling user to restart | `vscode.commands.executeCommand('workbench.action.reloadWindow')` | Standard VS Code built-in; preserves window state |
| Detecting "currently installed version" | Reading `package.json` from disk | `vscode.extensions.getExtension('altium.altium365-scripting')?.packageJSON.version` | Reflects the actually-loaded extension; works for sideloaded VSIX too |

**Key insight:** Every primitive needed for this phase is already a VS Code built-in command or a Node built-in module. No new runtime dependencies should be added.

## Common Pitfalls

### Pitfall 1: Wrong extension ID
**What goes wrong:** `vscode.extensions.getExtension('altium.altium365')` returns `undefined`, version comparison fails silently.
**Why it happens:** Extension ID is `${publisher}.${name}` from `package.json`: `publisher: "altium"` + `name: "altium365-scripting"` = `altium.altium365-scripting`. The phase additional_context guessed `altium.altium365`.
**How to avoid:** Hardcode `'altium.altium365-scripting'` as a module-level `const` in `updater.ts`. Add a unit test or assertion that getExtension returns truthy.
**Warning signs:** Auto-check silently no-ops; manual command reports "version unknown".

### Pitfall 2: vsce + SemVer build metadata (`+SHA7`)
**What goes wrong:** Historically, `vsce package` has been strict about SemVer shape. The Marketplace explicitly does NOT accept `+build-metadata` in version strings (Marketplace strips or rejects). `vsce package` (as opposed to `vsce publish`) is more permissive but the behavior with `+` has shifted across versions.
**Why it happens:** SemVer 2.0 allows `+build`, but the Marketplace's VSIX schema predates SemVer 2.0 and treats `+` as illegal.
**How to avoid:**
  - **Mitigation A (preferred):** Try the locked version scheme as-is in CI; if `vsce package --pre-release` errors, fall back to embedding the SHA inside the pre-release identifier: `0.1.0-ci.42.a1b2c3d`. This preserves SemVer precedence (`42` numeric compares correctly; sha is alphanumeric tiebreaker that never collides under monotonic `ci.N`) and avoids the `+` entirely.
  - **Mitigation B:** Keep `+SHA7` in the GitHub Release name / body only; stamp `package.json` with `0.1.0-ci.42` only.
  - Planner should add a CI step that runs `vsce package --pre-release` and surfaces the exact error if it fails, with a documented fallback path.
**Warning signs:** CI step exits non-zero on `vsce package` with "invalid version" or "version is not valid SemVer".
**Confidence:** [MEDIUM — needs CI-time verification on actual `@vscode/vsce@3.9.1`]

### Pitfall 3: Node `https.get` does not follow redirects
**What goes wrong:** Asset download to `os.tmpdir()` produces a 0-byte file (the 302 response body) or a tiny HTML "redirecting…" doc; install command then fails with "invalid VSIX".
**Why it happens:** `browser_download_url` from GitHub Releases API returns HTTP 302 to a presigned S3 URL. Node's `https.get` surfaces the 302 to the caller and does NOT recurse.
**How to avoid:** Implement the redirect loop shown in Pattern 3 above. Cap hops at 5.
**Warning signs:** Downloaded file is <100KB or starts with `<html`.

### Pitfall 4: GitHub API 403 with no `User-Agent`
**What goes wrong:** `https.get('api.github.com/...')` returns 403 with body "Request forbidden by administrative rules…".
**Why it happens:** GitHub REST API requires `User-Agent` header on every request [CITED: docs.github.com/rest/overview].
**How to avoid:** Always send `'User-Agent': 'altium365-vscode-extension'` (or similar identifier).

### Pitfall 5: SemVer precedence — "real" releases must beat pre-releases
**What goes wrong:** Team eventually ships `0.1.0` proper (no suffix) to GitHub Releases. Naive comparator (`a > b` when major/minor/patch greater) thinks `0.1.0-ci.999` is newer than `0.1.0` because string `"-ci.999"` > `""`, OR equal because base is the same.
**Why it happens:** SemVer 2.0 §11: a pre-release version has LOWER precedence than the associated normal version. `1.0.0-alpha < 1.0.0`.
**How to avoid:** Comparator MUST treat "no pre-release" as higher than any pre-release at the same base. See pseudocode below.
**Warning signs:** Unit-test asserts `compareVersions("0.1.0", "0.1.0-ci.42") > 0`; if it returns ≤ 0, the bug is present.
[CITED: semver.org/spec/v2.0.0.html#spec-item-11]

### Pitfall 6: `installExtension` argument shape
**What goes wrong:** Passing the path as a string fails or installs from Marketplace by ID (treating the string as an extension identifier).
**Why it happens:** The command is overloaded: string → Marketplace ID lookup; `Uri` → VSIX file install.
**How to avoid:** Always wrap with `vscode.Uri.file(vsixPath)`. Returns a thenable; `await` it before prompting reload.
[CITED: github.com/microsoft/vscode/issues/49807 "Install VSIX programmatically"]

### Pitfall 7: install-then-reload prompt double-up
**What goes wrong:** Some VS Code versions auto-prompt "Reload to apply extension update" after `installExtension`; ours adds a second prompt → confusing UX.
**Why it happens:** Built-in `installExtension` UI may surface its own toast in newer VS Code versions.
**How to avoid:** Prefer our own prompt (consistent UX, clear messaging). Acceptable trade-off: the user may see two reload prompts in some VS Code versions — both reload, so harmless. Document this in PHASE-SUMMARY for verification.
**Confidence:** [MEDIUM — VS Code behavior here varies by version; the duplicate-prompt risk is acceptable per CONTEXT]

## Runtime State Inventory

> Not applicable. Phase 8 is greenfield additive (one new module, one new setting, one new command, one workflow extension). It does not rename or migrate any existing identifier, datastore, or registered system.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified by grep on `globalState` / `secrets` usages | — |
| Live service config | None — GitHub Actions config is in-repo (`.github/workflows/ci.yml`); no external service config to mutate | — |
| OS-registered state | None — no scheduled tasks, daemons, or system services | — |
| Secrets/env vars | None new — workflow uses built-in `GITHUB_TOKEN`; no new repo secrets needed for public-repo release publishing | — |
| Build artifacts | The CI step writes `package.json` in the workflow runner only (`--no-git-tag-version`); the change never reaches a developer's working copy | — |

**Net new state:** `globalState['altium365.lastUpdateCheckAt']` (ISO string). No backfill needed (missing → "run check now").

## Code Examples

### Part 1: Computing the version + writing it
```bash
# Source: locked decision + npm CLI semantics [CITED: docs.npmjs.com/cli/v10/commands/npm-version]
BASE=$(node -p "require('./package.json').version")
SHA7=$(git rev-parse --short=7 HEAD)
VERSION="${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}"
echo "Computed version: $VERSION"
# --no-git-tag-version: don't create a tag/commit (we're in CI on a checkout, not committing back)
# --allow-same-version: tolerate the case where someone hand-edited package.json to the same shape
npm version "$VERSION" --no-git-tag-version --allow-same-version
```

### Part 1: Full workflow step block (recommended)
```yaml
# Source: synthesis of CONTEXT.md decisions + softprops action README [CITED: github.com/softprops/action-gh-release]
name: CI

on:
  push:
    branches: [main]
  pull_request:                       # NEW — keep PR builds producing artifact-only VSIX
    branches: [main]

permissions:
  contents: write                     # required for action-gh-release to create releases

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1              # commit message + SHA only

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Compute version (main only)
        id: ver
        if: github.ref == 'refs/heads/main'
        run: |
          BASE=$(node -p "require('./package.json').version")
          SHA7=$(git rev-parse --short=7 HEAD)
          VERSION="${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          npm version "$VERSION" --no-git-tag-version --allow-same-version

      - run: npm ci
      - run: npm run compile
      - run: npm test                 # vitest — gate releases on green tests

      - name: Package VSIX (main → pre-release)
        if: github.ref == 'refs/heads/main'
        run: npx vsce package --pre-release

      - name: Package VSIX (non-main → plain)
        if: github.ref != 'refs/heads/main'
        run: npx vsce package

      - uses: actions/upload-artifact@v4
        with:
          name: altium365-vsix
          path: '*.vsix'

      - name: Create GitHub Release (main only)
        if: github.ref == 'refs/heads/main'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ steps.ver.outputs.version }}
          name: v${{ steps.ver.outputs.version }}
          body: ${{ github.event.head_commit.message }}
          prerelease: true
          files: '*.vsix'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
> **Note on `permissions:`** — by default, the `GITHUB_TOKEN` provided to workflow runs has read-only `contents` permission. Releasing requires `contents: write`. This MUST be declared either at the workflow or job level [CITED: docs.github.com/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token].
> **Note on tag conflicts** — `action-gh-release` creates the tag if it doesn't exist. The tag `v$VERSION` is unique per run (encodes `GITHUB_RUN_NUMBER`), so no collisions.

### Part 2: SemVer comparator pseudocode

```typescript
// Source: SemVer 2.0 §11 precedence rules [CITED: semver.org/spec/v2.0.0.html#spec-item-11]
//
// Parses "MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]"
// where PRERELEASE = dot-separated identifiers (alphanumeric or numeric).
// Returns: negative if a<b, 0 if equal-precedence, positive if a>b.
// Build metadata (+...) is IGNORED in precedence (§10).

interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    pre: Array<number | string>;  // empty array = NOT a pre-release
}

const RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v: string): ParsedVersion | null {
    const m = RE.exec(v.trim());
    if (!m) return null;
    const pre = m[4]
        ? m[4].split('.').map(id => /^\d+$/.test(id) ? Number(id) : id)
        : [];
    return { major: +m[1], minor: +m[2], patch: +m[3], pre };
}

export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return 0;  // unparseable → treat as equal (safe: no false-positive update)

    // Compare base version
    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    if (pa.patch !== pb.patch) return pa.patch - pb.patch;

    // §11: normal version > any pre-release of the same base.
    if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
    if (pa.pre.length === 0) return 1;   // a is normal, b is pre-release → a > b
    if (pb.pre.length === 0) return -1;  // mirror

    // Both pre-release: compare identifiers left-to-right.
    const n = Math.min(pa.pre.length, pb.pre.length);
    for (let i = 0; i < n; i++) {
        const x = pa.pre[i], y = pb.pre[i];
        if (x === y) continue;
        // numeric < alphanumeric (§11.4.3)
        const xn = typeof x === 'number', yn = typeof y === 'number';
        if (xn && yn) return (x as number) - (y as number);
        if (xn) return -1;
        if (yn) return 1;
        return (x as string) < (y as string) ? -1 : 1;
    }
    // All compared identifiers equal → longer is greater (§11.4.4)
    return pa.pre.length - pb.pre.length;
}
```

### Part 2: GitHub API JSON shape (excerpt — what the updater consumes)
```jsonc
// Source: GitHub REST API [CITED: docs.github.com/rest/releases/releases#list-releases]
[
  {
    "name": "v0.1.0-ci.42+a1b2c3d",
    "tag_name": "v0.1.0-ci.42+a1b2c3d",
    "draft": false,
    "prerelease": true,
    "published_at": "2026-05-25T12:34:56Z",
    "assets": [
      {
        "name": "altium365-scripting-0.1.0-ci.42.vsix",
        "size": 482034,
        "browser_download_url":
          "https://github.com/altium/a365-vscode-extension/releases/download/v0.1.0-ci.42+a1b2c3d/altium365-scripting-0.1.0-ci.42.vsix"
        // ↑ this URL responds with HTTP 302 → S3 presigned URL
      }
    ]
  }
]
```
> **Version extraction:** strip leading `v` from `name` or `tag_name`, OR parse the VSIX filename. Recommend `name`/`tag_name` (controlled by us) over the filename (vsce may sanitize the `+SHA7` out — pitfall #2).

### Part 2: package.json deltas
```jsonc
// contributes.configuration.properties — add at the end of existing altium365.* properties
"altium365.checkForUpdates": {
    "type": "boolean",
    "default": true,
    "description": "Automatically check GitHub Releases for newer Altium 365 extension builds once per day. Manual checks via the 'Altium 365: Check for Updates' command are always available."
}

// contributes.commands — add to the existing array
{
    "command": "altium365.checkForUpdates",
    "title": "Check for Updates",
    "category": "Altium 365"
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vsce publish` only (Marketplace) | `vsce package --pre-release` + sideload via GitHub Releases | `@vscode/vsce@1.88` (2022) added `--pre-release` flag for non-Marketplace pre-release semantics | Lets us ship pre-release VSIXes outside the Marketplace [CITED: github.com/microsoft/vscode-vsce/releases] |
| Polling `/releases/latest` | LIST `/releases` and filter | N/A — always was the right call when shipping pre-releases | Phase decision aligns with the API's documented exclusion of pre-releases from `/latest` |
| `actions/create-release` (archived) | `softprops/action-gh-release@v2` | 2021 (GitHub archived their official action) | Don't reach for the archived action; community fork is the de-facto standard |

**Deprecated/outdated:**
- `actions/create-release` and `actions/upload-release-asset` — both archived; do not use [CITED: github.com/actions/create-release].

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.0.0 |
| Config file | `vitest.config.ts` (already exists; includes `test/**/*.test.ts`) |
| Quick run command | `npm test` |
| Full suite command | `npm test` (same — small project, no separate fast/slow split) |

### Phase Requirements → Test Map
| Req (to be derived by planner) | Behavior | Test Type | Automated Command | File Exists? |
|--------------------------------|----------|-----------|-------------------|-------------|
| Part 1: CI stamps unique version on main | `package.json` version becomes `${BASE}-ci.${RUN_NUMBER}+${SHA7}` inside the runner | manual-CI | observe workflow logs + release name | ❌ verified by CI run, not unit test |
| Part 1: VSIX attached to GitHub Release | Release page shows `*.vsix` asset | manual-CI | inspect the auto-created release | ❌ manual verification |
| Part 1: non-main builds unchanged | PR/non-main build uploads workflow artifact only; no release | manual-CI | observe workflow runs on PR | ❌ manual verification |
| Part 2: `compareVersions` honors SemVer §11 | Pure function returns correct sign for all enumerated cases | unit | `npm test` runs `test/compareVersions.test.ts` | ❌ Wave 0 (new file) |
| Part 2: extension ID resolves to currently installed version | `vscode.extensions.getExtension('altium.altium365-scripting')` returns truthy | smoke (manual) | run extension in dev host; log version | ❌ manual UAT |
| Part 2: 24h debounce honored | Second activation within 24h skips network | manual | inspect output channel; clear `globalState` to re-trigger | ❌ manual UAT |
| Part 2: end-to-end VSIX-over-VSIX upgrade | Toast → Update Now → install → reload → new version active | manual | UAT script below | ❌ manual UAT |

### Sampling Rate
- **Per task commit:** `npm test` (vitest — fast, runs the pure helper coverage)
- **Per wave merge:** `npm test` + `npm run compile` (catches TS errors)
- **Phase gate:** A CI run on a PR branch produces a non-release VSIX successfully; a follow-up merge to `main` produces a release + VSIX asset; manual UAT of the update flow against that release.

### Wave 0 Gaps
- [ ] `test/compareVersions.test.ts` — covers SemVer §11 cases below
- [ ] No new framework install (vitest already bootstrapped)

### Required `compareVersions` test cases (minimum)
```typescript
// Source: SemVer §11 + phase-specific edge cases
describe('compareVersions', () => {
    it('normal > pre-release of same base', () => {
        expect(compareVersions('0.1.0', '0.1.0-ci.42')).toBeGreaterThan(0);
        expect(compareVersions('0.1.0-ci.42', '0.1.0')).toBeLessThan(0);
    });
    it('higher ci.N wins among pre-releases of same base', () => {
        expect(compareVersions('0.1.0-ci.100', '0.1.0-ci.42')).toBeGreaterThan(0);
    });
    it('build metadata ignored in precedence', () => {
        expect(compareVersions('0.1.0-ci.42+abc', '0.1.0-ci.42+def')).toBe(0);
    });
    it('patch bump wins over pre-release suffix', () => {
        expect(compareVersions('0.1.1', '0.1.0-ci.999')).toBeGreaterThan(0);
    });
    it('equal versions return 0', () => {
        expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    });
    it('unparseable input returns 0 (safe — no false update prompt)', () => {
        expect(compareVersions('not-a-version', '0.1.0')).toBe(0);
    });
    it('numeric < alphanumeric pre-release identifier', () => {
        expect(compareVersions('0.1.0-alpha', '0.1.0-1')).toBeGreaterThan(0);
    });
});
```

### Manual UAT script (the actual VSIX-over-VSIX upgrade)
> Required because no automated harness can sanely test the install+reload flow.

1. **Setup:** Install a known-older VSIX (e.g. `0.1.0-ci.5+xxx`) via `code --install-extension <vsix>`. Confirm `Extensions panel → Altium 365 → version` shows `0.1.0-ci.5`.
2. **Force the check:** Open Command Palette → `Altium 365: Check for Updates` (manual command bypasses debounce).
3. **Expect:** Toast `"Altium 365: v0.1.0-ci.42 available"` with `Update Now` / `Later` buttons.
4. **Click Update Now.** Observe progress in output channel (`Altium 365` panel).
5. **Expect:** Toast `"Altium 365: update installed. Reload window to apply."` with `Reload Now` button.
6. **Click Reload Now.** Window reloads.
7. **Verify:** Extensions panel shows `0.1.0-ci.42`. The "Altium 365" output channel shows install log line.
8. **Edge UAT:** Open Command Palette → `Altium 365: Check for Updates` again. Expect toast `"You're on the latest version"` (planner's discretion choice) OR silent log; either is acceptable per CONTEXT.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth required — public GitHub API + public release assets |
| V3 Session Management | no | No session state |
| V4 Access Control | no | Read-only GitHub API access |
| V5 Input Validation | yes | Validate `browser_download_url` is `https:` and host is `github.com` or `*.githubusercontent.com` before download; validate filename ends with `.vsix` |
| V6 Cryptography | no (v1) | No signing/verification in v1 (deferred); TLS provided by `https` module |
| V7 Error Handling | yes | Never expose stack traces in toasts; route errors to `outputChannel` |
| V8 Data Protection | yes | Downloaded VSIX written to `os.tmpdir()` (OS-managed cleanup); no PII or secrets touched |
| V12 File / Resource | yes | `vscode.Uri.file(vsixPath)` — never construct from untrusted string concat; use `path.join(os.tmpdir(), <sanitized-filename>)` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious redirect from `browser_download_url` to non-GitHub host | Tampering | Validate post-redirect URL host is `*.githubusercontent.com` or `*.amazonaws.com` (S3) — or accept TLS-only and rely on GitHub's CDN trust. Phase choice: accept TLS-only (no host whitelist) given the threat model says "GitHub-hosted release assets are trusted" |
| VSIX install of a tampered binary | Tampering | Deferred to signed-builds phase per CONTEXT |
| Excessive API requests / rate-limit DoS on user IP | DoS | 24h debounce + best-effort error swallow — already designed in |
| Path traversal via attacker-controlled filename | Tampering | Sanitize the asset filename: `path.basename(asset.name).replace(/[^a-zA-Z0-9._-]/g, '_')` before joining to `os.tmpdir()` |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | CI + tests | ✓ | 20 (CI), local varies | — |
| `npm` | CI + tests | ✓ | bundled with Node | — |
| `@vscode/vsce` | CI package step | ✓ | 3.9.1 (devDep) | — |
| `vitest` | unit tests | ✓ | 2.0.0 (devDep) | — |
| GitHub Actions runner (ubuntu-latest) | CI | ✓ | provided | — |
| `softprops/action-gh-release@v2` | CI release step | ✓ | pulled at run time | `gh release create` shell |
| GitHub Releases API (public, anonymous) | Runtime updater | ✓ | live | — (best-effort skip on failure) |

No blocking gaps.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@vscode/vsce@3.9.1` accepts SemVer `+build-metadata` in `package.json` version | Pitfall #2 | CI fails on `vsce package` step. Mitigation documented (move SHA into pre-release segment as `-ci.42.a1b2c3d`). [ASSUMED] |
| A2 | `workbench.extensions.installExtension` with `Uri.file(vsix)` installs in place (no manual uninstall) | Don't Hand-Roll table | Update flow ends in "already installed" error; user has to uninstall first. Surface error toast → user has manual path. [ASSUMED — well-supported pattern but unverified on the exact installed VS Code engine 1.85+] |
| A3 | VS Code does not auto-show its own reload prompt after `installExtension` of a sideloaded VSIX in 1.85+ | Pitfall #7 | User sees two reload prompts. Harmless. [ASSUMED] |
| A4 | The `softprops/action-gh-release@v2` `body:` parameter handles multi-line/quoted commit messages safely (no shell injection class issues) | Code Examples (workflow YAML) | Release body looks corrupted. Mitigation: use `body_path:` with a tempfile if it breaks. [ASSUMED — but widely used pattern] |
| A5 | Anonymous rate limit on `api.github.com` is 60 req/hr per IP, sufficient for 24h debounce per user | CONTEXT decision | Multiple users behind a shared NAT could throttle each other. Mitigation: 24h debounce makes hitting 60/hr extremely unlikely in practice. [CITED: docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting] |

## Open Questions (RESOLVED)

1. **Does `vsce package --pre-release` v3.9.1 accept `+SHA7` build metadata?**
   - What we know: SemVer 2.0 allows it; the Marketplace historically does not; `vsce package` has been inconsistent across versions.
   - What's unclear: Behavior on the exact installed version.
   - Recommendation: First CI run is the verification. If it fails, the planner's fallback is documented (Pitfall #2 Mitigation A: shift SHA into pre-release segment).

2. **"No update available" toast on manual command — yes or no?**
   - CONTEXT marks this as Claude's Discretion.
   - Recommendation: YES — manual invocation deserves explicit feedback ("You're on the latest version: v0.1.0-ci.42"). Silent success after a manual click is confusing.

3. **In-flight check while user triggers manual command?**
   - Not in CONTEXT.
   - Recommendation: Simple module-private `let isChecking = false` flag. Manual command early-returns with a "Already checking…" toast if true.

4. **First-activation behavior (no `lastUpdateCheckAt` in `globalState`)?**
   - Not explicit in CONTEXT.
   - Recommendation: Treat missing key as "infinitely old" → run check immediately on first activation. This is the natural fall-out of `if (Date.now() - last < 24h) skip` when `last = 0`.

5. **Released version OLDER than installed (someone yanked a release)?**
   - Recommendation: `compareVersions` returns negative → no toast, log only. Already covered.

## Suggested Plan Boundary

Recommend splitting Phase 8 into **3 plans** (matches the Wave model — Plan 1 is pure CI YAML, Plan 2 is the testable pure helper, Plan 3 is the VS Code integration that depends on Plan 2):

| Plan | Title | Objective (one line) | Depends on |
|------|-------|----------------------|------------|
| 08-01 | CI versioning + GitHub Release publishing | Extend `.github/workflows/ci.yml` to compute `${BASE}-ci.N+SHA7`, run `vsce package --pre-release` on main, and attach the VSIX to an auto-created GitHub Release via `softprops/action-gh-release@v2`. Verify with one merge-to-main producing a release with the VSIX asset attached. | — |
| 08-02 | `compareVersions` pure helper + vitest coverage | Add `src/updater.ts` exporting `parseVersion` and `compareVersions` (no VS Code or I/O imports yet). Add `test/compareVersions.test.ts` with the 7 enumerated SemVer §11 cases. `npm test` green. | — |
| 08-03 | Updater integration: GitHub poll + download + install + reload | Add the rest of `src/updater.ts`: `registerUpdater(context, outputChannel)`, GitHub LIST + filter + sort, download with redirect-following, `installExtension` invocation, reload prompt. Wire from `activate()`. Add `altium365.checkForUpdates` setting + command to `package.json`. Manual UAT per the script above. | 08-01, 08-02 |

**Wave plan (per CONFIG `parallel_execution`):**
- Wave 1 (parallel): 08-01, 08-02 — independent (CI YAML changes vs pure-helper TS).
- Wave 2: 08-03 — depends on the helper from 08-02 and is best-validated against a real CI-produced release from 08-01.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/08-distinct-vsix-version-per-build/08-CONTEXT.md` — locked decisions
- `package.json` (current) — base version, scripts, contributes, devDeps
- `.github/workflows/ci.yml` (current) — baseline workflow to extend
- `src/auth.ts`, `src/workspace.ts`, `src/extension.ts` — module pattern, `https.get` precedent, outputChannel usage
- `.planning/codebase/CONVENTIONS.md` — style + module rules
- `vitest.config.ts` + `test/dedupLogPage.test.ts` — existing test pattern
- semver.org/spec/v2.0.0.html §10 (build metadata), §11 (precedence)
- docs.github.com/rest/releases/releases — endpoint shapes
- docs.github.com/actions/security-guides/automatic-token-authentication — `GITHUB_TOKEN` permissions
- docs.github.com/rest/overview/resources-in-the-rest-api — UA requirement, rate limits
- docs.npmjs.com/cli/v10/commands/npm-version — `--no-git-tag-version`, `--allow-same-version`

### Secondary (MEDIUM confidence)
- github.com/softprops/action-gh-release README — action input shapes
- github.com/microsoft/vscode-vsce — `--pre-release` flag history
- github.com/microsoft/vscode issues — `workbench.extensions.installExtension` signature discussion

### Tertiary (LOW confidence — flagged in Assumptions Log)
- vsce tolerance of `+SHA7` build metadata in version (A1)
- Exact behavior of `installExtension` with already-installed extension on VS Code 1.85+ (A2)
- Whether VS Code surfaces its own reload prompt after sideloaded VSIX install on 1.85+ (A3)

## Metadata

**Confidence breakdown:**
- CI workflow YAML changes: HIGH — every primitive is documented, well-trodden
- Self-updater module design: HIGH — mirrors existing `auth.ts`/`workspace.ts` patterns exactly
- SemVer comparator: HIGH — spec is unambiguous and testable in pure-Node vitest
- `vsce` + `+build-metadata` interaction: MEDIUM — needs CI-time verification (Pitfall #2, A1)
- `installExtension` over-existing-install behavior: MEDIUM — pattern is widely used but not formally documented for VS Code 1.85 (A2)

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (30 days — stable APIs, but vsce ships regularly; revisit if Phase 8 hasn't been executed by then)
