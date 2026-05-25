---
created: "2026-05-25T23:00:00.000Z"
title: Distinct VSIX version per GitHub build + optional self-update
area: tooling
files:
  - .github/workflows/ci.yml
  - package.json:5
---

## Problem

Every CI build of the extension currently produces a VSIX stamped with `package.json` version `0.1.0`. Without a distinct version per build, installed copies can't tell whether a newer artifact is available, VS Code won't trigger an "update" (same version = same install), and there's no audit trail back to the commit that produced a given install.

Constraints:
- Pre-Marketplace. GitHub Releases (or raw VSIX artifacts) is the distribution channel for the foreseeable future.
- A few external users need to keep extensions current without manual download/install.
- We don't want to manually bump `package.json` on every push.

## Solution

**Two-part. Part 1 is a must, Part 2 is the "bonus" the user asked for.**

### Part 1 — Distinct version per build (required)

In `.github/workflows/ci.yml`, before `vsce package`:

1. Compute a build version. Options:
   - `0.1.0-ci.${{ github.run_number }}` — monotonic, human-readable, ties to Actions run.
   - `0.1.0-sha.${GITHUB_SHA::7}` — ties to commit; not monotonic.
   - **Recommended:** `${BASE}-ci.${RUN}+${SHA7}` — e.g. `0.1.0-ci.42+a1b2c3d`. Monotonic for VS Code's semver comparator, audit trail in build metadata.
2. `npm version "$VERSION" --no-git-tag-version --allow-same-version` to write it in `package.json` (in-CI only, never committed).
3. `npx vsce package` produces the VSIX with that version.
4. Upload as a workflow artifact AND attach to a GitHub Release on `main` (auto-release per push, or only on tags — decide).

**Gotcha:** `vsce` rejects pre-release versions unless `--pre-release` is passed. Either accept that, or use a 4-segment scheme like `0.1.<run_number>` (no pre-release suffix, fully accepted by Marketplace later).

### Part 2 — Self-update from GitHub Releases (bonus)

Three viable paths, easiest first:

**A. Existing extension (zero code).** Recommend users install [`fabiospampinato.vscode-update-extensions`](https://marketplace.visualstudio.com/items?itemName=fabiospampinato.vscode-update-extensions) or similar VSIX-from-URL tools. Document in README. Zero maintenance.

**B. Built-in updater command + status-bar nudge (~100 LOC).**
   1. On activate (debounced to once per N hours), GET `https://api.github.com/repos/altium/a365-vscode-extension/releases/latest`.
   2. Compare `tag_name` (or `assets[0].name` version segment) vs `context.extension.packageJSON.version` via a semver compare (write a tiny one — no new deps needed).
   3. If newer: show information message "Altium 365: v{X} available" with button "Update Now" → downloads the `.vsix` asset to `os.tmpdir()`, then runs `vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath))`. Prompt reload.
   4. Optional setting `altium365.checkForUpdates: boolean` (default true).

**C. Update channel via private extension gallery.** Overkill for current scale.

**Recommendation: Part 1 now (blocking), Part 2 Option B as a small dedicated phase** (one plan, ~100 LOC, no new runtime deps — `https.get` is enough). Document Option A as the manual fallback in README until B ships.

## Open questions

- Versioning scheme: pre-release suffix (`0.1.0-ci.N`) vs 4-segment build-number (`0.1.N`)? Trade-off: suffix preserves the "real" semver for eventual Marketplace publish; 4-segment is more compatible with vsce defaults.
- Auto-release per push to main, or only on git tags? Per-push is friction-free for users; tags give intentional release control.
- Should the self-updater pre-release-test (e.g. download → verify checksum) before installing?
