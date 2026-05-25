---
phase: 08-distinct-vsix-version-per-build
verified: 2026-05-26T00:10:00Z
status: human_needed
score: 8/8 must-haves verified (code-level); 5 end-to-end behaviors require human UAT
overrides_applied: 0
human_verification:
  - test: "Push a commit to main and inspect the GitHub Releases page"
    expected: "A release named v0.1.0-ci.{N}+{sha7} exists with a .vsix attached as an asset; prerelease flag set; release body = head commit message"
    why_human: "Requires GitHub-side execution of the Actions workflow and inspection of the Releases UI — verifier cannot trigger or observe this"
  - test: "Push a commit to a non-main branch and verify the workflow"
    expected: "Workflow runs, produces a workflow-artifact VSIX named 0.1.0, but no GitHub Release is created"
    why_human: "Requires actual workflow run on GitHub"
  - test: "Launch the extension in a dev host (F5) with a newer release present on GitHub"
    expected: "Within ~10s of activation, a toast 'Altium 365: v{X} available' with [Update Now] [Later] buttons appears; clicking Update Now downloads, installs, and offers reload"
    why_human: "End-to-end UX flow involving live GitHub API, real VS Code install command, and toast rendering — cannot verify by grep"
  - test: "Run 'Altium Developer: Check for Updates' from the palette with no newer release"
    expected: "Toast 'Altium 365: you're on the latest version (0.1.0).'"
    why_human: "UX feedback path requires manual palette invocation"
  - test: "Set altium365.checkForUpdates = false in Settings, reload, then activate"
    expected: "Output channel logs 'auto check disabled via altium365.checkForUpdates setting'; no network call; palette command still works on demand"
    why_human: "Setting interaction + activation timing — manual reload required"
---

# Phase 8: distinct-vsix-version-per-build Verification Report

**Phase Goal:** Every push to `main` produces a uniquely-versioned VSIX (`${BASE}-ci.${RUN}+${SHA7}`) attached to a GitHub Release; in-extension self-updater polls Releases on 24h-debounced activation hook + palette command, offers one-click download→install→reload toast; rebrand to `altium.developer` (displayName "Altium Developer") with `altium365.*` command/config identifiers preserved.

**Verified:** 2026-05-26
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                       | Status     | Evidence                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every push to main stamps a unique pre-release version via `npm version` in the runner                      | ✓ VERIFIED | `.github/workflows/ci.yml:25-33` — `Compute version` step gated on `github.ref == 'refs/heads/main'`, builds `${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}` and writes via `npm version --no-git-tag-version --allow-same-version` |
| 2   | Every push to main creates a GitHub Release with `.vsix` attached                                            | ✓ VERIFIED | `.github/workflows/ci.yml:44-54` — `softprops/action-gh-release@v2` step, `tag_name: v${{steps.ver.outputs.version}}`, `files: '*.vsix'`, `prerelease: true`, gated on main; `permissions: contents: write` at workflow level (line 9-10) |
| 3   | Non-main pushes produce a workflow-artifact VSIX but no GitHub Release                                       | ✓ VERIFIED | `.github/workflows/ci.yml:6-7` adds `pull_request.branches: [main]`; `:37-39` non-main package step at static 0.1.0; release step gated on main only             |
| 4   | vitest suite runs in CI before packaging                                                                     | ✓ VERIFIED | `.github/workflows/ci.yml:24` — `npm test` runs before either package variant                                                                                     |
| 5   | Pure SemVer comparator implements §10/§11 with safe fallthrough on unparseable input                         | ✓ VERIFIED | `src/semverCompare.ts:50-111`; 8/8 vitest assertions pass in `test/compareVersions.test.ts` (npm test green)                                                       |
| 6   | Auto-check fires on activation, fire-and-forget, debounced 24h via `globalState.altium365.lastUpdateCheckAt` | ✓ VERIFIED | `src/updater.ts:50-52` (`void runCheck(...)`), `:86-94` (debounce gate using `Date.now() - last < DEBOUNCE_MS`), `DEBOUNCE_MS = 24*60*60*1000` line 32           |
| 7   | Setting `altium365.checkForUpdates` (boolean, default true) toggles auto-check; manual command always runs   | ✓ VERIFIED | `src/updater.ts:47-55` reads setting with default true; `package.json` setting `{type:boolean, default:true}`; manual cmd registered line 58 bypasses debounce via `opts.manual` branch |
| 8   | Update-Now flow: download to tmpdir → installExtension(Uri.file) → reload prompt                              | ✓ VERIFIED | `src/updater.ts:211-260` — toast/choice, withProgress, `downloadFollowingRedirects` (path-traversal-sanitized filename line 223), `executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath))` line 238-241, `workbench.action.reloadWindow` line 259 |
| 9   | Extension rebranded to `altium.developer` (name="developer", displayName="Altium Developer"), publisher unchanged, `altium365.*` IDs preserved | ✓ VERIFIED | `package.json`: name=`developer`, displayName=`Altium Developer`, publisher=`altium` → id `altium.developer`; 70 occurrences of `"altium365.` preserved (commands/config/views); `src/updater.ts:29` hardcodes `'altium.developer'`; zero matches for `altium365-scripting` or `Altium 365 Developer Tools` in package.json |

**Score:** 9/9 truths verified at the code level. End-to-end behaviors (toast appearance, GH release creation on push, install flow) require human UAT per Step 8.

### Required Artifacts

| Artifact                         | Expected                                                            | Status      | Details                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`       | Versioning + conditional package + gh-release + permissions block   | ✓ VERIFIED  | 54 lines; all 6 required strings present (softprops, contents: write, npm version, vsce package --pre-release, pull_request, npm test) |
| `src/semverCompare.ts`           | Pure helper, zero vscode/fs/network imports                          | ✓ VERIFIED  | 112 lines, zero imports, exports `parseVersion`, `compareVersions`, `ParsedVersion`                       |
| `test/compareVersions.test.ts`   | ≥7 cases + parseVersion leading-`v` case                            | ✓ VERIFIED  | 8 `it(` blocks; all pass under vitest                                                                     |
| `src/updater.ts`                 | `registerUpdater` factory + GH poll + redirect download + install   | ✓ VERIFIED  | 383 lines; compiles; 3× `https.get`, 0× `fetch(` calls; `EXTENSION_ID = 'altium.developer'`              |
| `src/extension.ts` (modified)    | Import + factory call + subscriptions spread                         | ✓ VERIFIED  | Line 30 import, line 119 factory call, line 180 `...updaterDisposables` spread                            |
| `package.json` (modified)        | Rebrand + command + setting                                          | ✓ VERIFIED  | Validated via `node -e JSON.parse` and per-field assertions                                              |

### Key Link Verification

| From                                  | To                                                                | Via                                                                | Status     | Details                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`            | `api.github.com/repos/.../releases`                                | `softprops/action-gh-release@v2` + `GITHUB_TOKEN`                  | ✓ WIRED    | Line 46 uses action, line 53 passes token from `secrets.GITHUB_TOKEN`                    |
| `.github/workflows/ci.yml`            | `package.json`                                                    | `npm version --no-git-tag-version --allow-same-version`            | ✓ WIRED    | Line 33                                                                                  |
| `test/compareVersions.test.ts`        | `src/semverCompare.ts`                                            | relative import                                                    | ✓ WIRED    | Tests pass; module exports match                                                          |
| `src/extension.ts`                    | `src/updater.ts`                                                  | `import { registerUpdater } from './updater'`                      | ✓ WIRED    | Lines 30 + 119 + 180 (import, call, subscriptions spread)                                |
| `src/updater.ts`                      | `api.github.com/repos/altium/a365-vscode-extension/releases`     | `https.get` with UA + Accept + X-GitHub-Api-Version headers        | ✓ WIRED    | `getJson()` lines 266-313, headers lines 286-288                                          |
| `src/updater.ts`                      | `workbench.extensions.installExtension`                           | `vscode.commands.executeCommand(..., vscode.Uri.file(vsixPath))`   | ✓ WIRED    | Lines 238-241                                                                            |
| `src/updater.ts`                      | `workbench.action.reloadWindow`                                   | `vscode.commands.executeCommand(...)`                              | ✓ WIRED    | Line 259                                                                                 |

### Data-Flow Trace (Level 4)

| Artifact            | Data Variable        | Source                                                  | Produces Real Data | Status     |
| ------------------- | -------------------- | ------------------------------------------------------- | ------------------ | ---------- |
| `src/updater.ts`    | `releases` (JSON)    | `getJson(RELEASES_URL)` → live GitHub Releases API      | Yes (real HTTPS GET) | ✓ FLOWING  |
| `src/updater.ts`    | `installed` version  | `vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version` | Yes (runtime VS Code API) | ✓ FLOWING  |
| `src/updater.ts`    | `latest` version     | `release.tag_name ?? release.name` from fetched payload | Yes (no static fallback) | ✓ FLOWING  |

### Behavioral Spot-Checks

| Behavior                                                          | Command                                                                 | Result                  | Status |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------- | ------ |
| TypeScript compiles (strict)                                       | `npm run compile`                                                       | exit 0, no errors       | ✓ PASS |
| Vitest suite passes (semver + dedup)                              | `npm test`                                                              | 13/13 tests passing     | ✓ PASS |
| `package.json` parses + extension ID resolves to `altium.developer` | `node -e "const pj=...; assert id==='altium.developer'"`                 | exit 0                  | ✓ PASS |
| YAML parses cleanly                                                | (per Plan 08-01 verification block — `python3 -c yaml.safe_load`)        | exit 0                  | ✓ PASS |
| GH release publish actually creates a release on push to main      | (would require triggering Actions)                                       | n/a                     | ? SKIP — routed to human UAT |
| Updater fetches real release & shows toast                          | (requires extension dev host + live GitHub)                              | n/a                     | ? SKIP — routed to human UAT |

### Probe Execution

No probes declared in PLAN/SUMMARY and no `scripts/*/tests/probe-*.sh` convention exists in this repo. Step 7c: SKIPPED (no probes).

### Requirements Coverage

Requirements from PLAN frontmatter:

| Requirement   | Source Plan | Status      | Evidence                                                                            |
| ------------- | ----------- | ----------- | ----------------------------------------------------------------------------------- |
| CI-VER-01..04 | 08-01       | ✓ SATISFIED (pending UAT) | All ci.yml deltas in place; release UI confirmation deferred to human UAT |
| UPD-01        | 08-02       | ✓ SATISFIED | Pure comparator + 8 passing tests                                                    |
| UPD-02..07    | 08-03       | ✓ SATISFIED | `src/updater.ts` implements full flow; UI flow needs human confirmation              |
| UPD-08        | 08-03       | ✓ SATISFIED | Rebrand applied (name/displayName); extension ID = `altium.developer`                |

### Anti-Patterns Found

None of severity blocker or warning. Scanned:
- No TODO/FIXME/XXX/PLACEHOLDER markers added by this phase
- No empty handlers / `return null` stubs
- No hardcoded empty render data
- The one `let` at module scope in `src/updater.ts` (`isChecking`) is explicitly justified per AGENTS.md exception (in-flight serialization guard) and called out in code comment lines 37-40
- One info note: the comment at `src/updater.ts:21-24` deliberately elides the literal `fetch(` token so grep-audits don't false-flag the rationale block — clever but acceptable

### Human Verification Required

5 items (see frontmatter `human_verification` for structured form):

1. **GitHub Release on main push** — push to main, inspect Releases tab; expect `v0.1.0-ci.{N}+{sha7}` with `.vsix` asset, prerelease flag set.
2. **PR/non-main has no release** — push a non-main commit, confirm workflow-artifact-only output.
3. **Update toast appears** — with a newer release present, launch dev host (F5); within ~10s expect "Altium 365: v{X} available" toast with Update Now / Later buttons. Click Update Now → download progress → install → reload prompt.
4. **Manual command from palette** — invoke "Altium Developer: Check for Updates"; if already on latest, expect "you're on the latest version (0.1.0)" toast.
5. **Setting toggle off** — set `altium365.checkForUpdates=false`, reload; expect log line `auto check disabled via altium365.checkForUpdates setting`; palette command still works.

### Gaps Summary

No code-level gaps. The phase delivered all required artifacts at correct quality:
- CI workflow is complete (versioning, conditional packaging, release publish, test gate, pull_request trigger, contents:write permission).
- Pure SemVer comparator is correct, pure, fully tested (8/8 cases pass).
- Updater module is complete with all locked decisions implemented: fire-and-forget activation, 24h debounce, manual command, in-flight guard, network-fail-doesn't-poison-debounce, https-only redirect chain, path-traversal-safe filename, Uri-wrapped install, reload prompt.
- Rebrand to `altium.developer` is consistent across `package.json` (name, displayName, publisher unchanged), the hardcoded `EXTENSION_ID` in `src/updater.ts`, and the new command's `category: "Altium Developer"`. All 70 pre-existing `altium365.*` command/config/view identifiers are preserved (scope fence honored).

**Status `human_needed`** rather than `passed` because the phase goal is fundamentally user-observable behavior (a release shows up on GitHub; a toast appears in VS Code; the install command actually swaps the extension). Code-level verification confirms the implementation is in place and wired correctly, but only a human running the dev host against a real GitHub release can confirm the end-to-end UX behaves as designed.

---

_Verified: 2026-05-26_
_Verifier: gsd-verifier (goal-backward)_
