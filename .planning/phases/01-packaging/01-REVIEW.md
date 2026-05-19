---
phase: 01-packaging
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - package.json
  - .vscodeignore
  - scripts/generate-icon.js
  - README.md
  - .github/workflows/ci.yml
findings:
  critical: 0
  high: 1
  medium: 4
  low: 3
  info: 3
  total: 11
status: findings
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-19
**Depth:** standard
**Files Reviewed:** 5 (binary `resources/icon.png` excluded)
**Status:** findings

## Summary

Phase 01 (packaging + CI) is mechanically sound: the VSIX builds, the icon generator is a clean zero-dependency Node script with no injection surface, and the README accurately describes the user-facing flows.

The findings are concentrated in two areas:

1. **Marketplace/legal readiness** — `package.json` has no `license` field and the repo has no `LICENSE` file. The 01-01 summary already acknowledged this warning from `vsce package` and deferred it to 01-02, but 01-02 did not address it. The extension cannot legally be published to the Marketplace in this state.
2. **CI hardening** — `.github/workflows/ci.yml` ships with the default `GITHUB_TOKEN` permissions (write-all on older repos), no PR validation, no Node version on a supported track (Node 18 reached EOL on 2025-04-30; this build runs on an EOL runtime as of today's review date), and an `upload-artifact` step that will silently succeed if the VSIX is missing.

No security vulnerabilities in `scripts/generate-icon.js` — it touches a single hardcoded path with no user input. No hardcoded secrets (the `clientId` GUID in defaults is a public OAuth2 PKCE identifier, which is by-design).

## Narrative Findings (AI reviewer)

## High

### HI-01: Missing LICENSE file and `license` field in package.json — Marketplace publish will be rejected / legally unclear

**File:** `package.json` (no `license` key) and repo root (no `LICENSE` file)
**Issue:** `package.json` is missing the `"license"` field, and no `LICENSE`/`LICENSE.md`/`LICENSE.txt` exists at the repo root. `vsce package` already emits the warning `LICENSE, LICENSE.md, or LICENSE.txt not found` (acknowledged in 01-01 SUMMARY as "expected and explicitly in scope for Plan 01-02") — but 01-02 did not actually add a license. Without an SPDX license declaration:
- The VSIX will display "No License" on the Marketplace.
- Downstream redistribution is legally ambiguous (default = all rights reserved).
- `vsce publish` against the public Marketplace emits a confirmation prompt and may be blocked in stricter publisher policies.

The phase summary explicitly claims `requirements-completed: [PKG-04, PKG-05]` for Plan 01-02 but the legal-readiness item slipped through both plans.

**Fix:**
1. Add `"license": "MIT"` (or whichever SPDX identifier the project chooses) to `package.json`.
2. Add a `LICENSE` file at the repo root with the matching license text.
3. Re-run `npm run package` and confirm the `LICENSE … not found` warning is gone.

## Medium

### ME-01: CI workflow has no `permissions:` declaration — `GITHUB_TOKEN` defaults to overly broad scope

**File:** `.github/workflows/ci.yml:1-21`
**Issue:** The workflow does not declare a top-level or job-level `permissions:` block. For repositories created before Feb 2023, or with default org settings, `GITHUB_TOKEN` is granted **write** access to contents, issues, pull-requests, packages, etc. This workflow only needs to read the repo and upload an artifact (artifact upload uses the actions service, not `contents: write`). A compromised dependency in the `npm ci` step could push commits, open releases, or alter issues using the ambient token. GitHub's hardening guide explicitly recommends declaring least-privilege permissions on every workflow.

**Fix:** Add at the top of the workflow:
```yaml
permissions:
  contents: read
```
This locks the token down regardless of repo/org defaults. `actions/upload-artifact@v4` does not require additional permissions.

### ME-02: CI only runs on push to `main` — feature branches and PRs are unvalidated

**File:** `.github/workflows/ci.yml:3-5`
**Issue:** The trigger is `push: branches: [main]` only — no `pull_request` trigger. This was a documented decision in 01-02 SUMMARY ("no PR pipeline noise"), but the consequence is that **tsc errors, broken VSIX builds, and packaging regressions are only discovered after the merge to `main` lands**. Combined with the fact that protected-branch status checks cannot be required (there are no PR checks to require), this effectively disables CI as a merge gate. For a brownfield extension intended for external developers, this is a meaningful correctness risk.

**Fix:** Add a `pull_request` trigger so the same job validates PRs before merge:
```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```
The artifact upload can be gated to push-only with `if: github.event_name == 'push'` if PR-artifact noise is the concern.

### ME-03: `upload-artifact` will silently succeed when no VSIX exists

**File:** `.github/workflows/ci.yml:18-21`
**Issue:** `actions/upload-artifact@v4` defaults to `if-no-files-found: warn` — if `npm run package` somehow produces no `*.vsix` (e.g., vsce changes its output naming convention, a future packaging tweak writes to a subdirectory, glob doesn't match), the workflow logs a warning but exits 0 and uploads an empty artifact. Downstream consumers who depend on the `altium365-vsix` artifact get nothing without a clear failure signal.

**Fix:**
```yaml
- uses: actions/upload-artifact@v4
  with:
    name: altium365-vsix
    path: '*.vsix'
    if-no-files-found: error
```

### ME-04: CI runs on Node 18 — past EOL (April 2025)

**File:** `.github/workflows/ci.yml:12-14`
**Issue:** `node-version: '18'` pins the build to Node 18.x. Node 18 reached end-of-life on 2025-04-30 — as of today's review date (2026-05-19) it is over a year past EOL and no longer receives security patches. `package.json` declares `"node": ">=18"`, so bumping the CI matrix to a supported LTS (20.x or 22.x) is compatible. Running CI on an unsupported runtime is both a supply-chain risk and a signal that the project's reproducibility baseline is drifting.

**Fix:**
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
```
Or, preferably, pin to a `.nvmrc` and reference it via `node-version-file: .nvmrc` so the local dev environment and CI stay in lockstep.

## Low

### LO-01: `.vscodeignore` does not exclude `*.vsix`

**File:** `.vscodeignore:1-12`
**Issue:** If `npm run package` is run twice without cleaning, an existing `altium365-scripting-0.1.0.vsix` sits in the repo root when vsce scans for files to include. `vsce` does filter its own output by name, but the protection is fragile — a renamed VSIX (e.g., from a future `--out` flag) or any other `.vsix` in the tree would be embedded inside the new VSIX. Cheap defense in depth.

**Fix:** Append to `.vscodeignore`:
```
*.vsix
```

### LO-02: `.vscodeignore` does not exclude `.github/**` or other dev metadata

**File:** `.vscodeignore:1-12`
**Issue:** `.github/workflows/ci.yml`, `.editorconfig`, `.prettierrc`, `coverage/**`, `*.log`, and `.env*` are not excluded. `.github/**` is currently the only such directory in the repo, and it ships in the VSIX today (run `unzip -l altium365-scripting-0.1.0.vsix` to confirm). Not a security issue (CI workflow is already public on GitHub) but adds bytes and leaks the project's build conventions to anyone who unpacks the VSIX.

**Fix:** Append:
```
.github/**
.editorconfig
*.log
.env*
coverage/**
```

### LO-03: `package.json` is missing `bugs` and `homepage` fields

**File:** `package.json:14-17`
**Issue:** Only `repository` is declared. The VS Code Marketplace renders `bugs.url` as "Report Issue" and `homepage` as the extension's landing link. Without them, users have no in-Marketplace path to file bugs and the listing looks less trustworthy.

**Fix:**
```json
"bugs": { "url": "https://github.com/altium/a365-vscode-extension/issues" },
"homepage": "https://github.com/altium/a365-vscode-extension#readme",
```

## Info

### IN-01: `activationEvents: []` relies on implicit command activation — confirm minimum VS Code version covers all contributed activations

**File:** `package.json:18`
**Issue:** Implicit activation for `contributes.commands` requires VS Code ≥ 1.74 (it does — engines is `^1.85.0`), so this is fine today. But the extension also contributes `configuration` and `menus`; both are passive and don't trigger activation. If a future plan adds a `view` or `viewsContainer` (Phase 2's side panel), the empty `activationEvents` array will need an `onView:` entry or the new TreeDataProvider will never instantiate. Worth flagging now so Phase 2 doesn't silently regress.

**Fix:** No change required for Phase 1. Note in Phase 2 plan that introducing a side-panel view requires either implicit `onView:<viewId>` activation (auto-generated for declared views in modern VS Code) or an explicit `activationEvents` entry.

### IN-02: GitHub Actions pinned to major-version tags rather than commit SHAs

**File:** `.github/workflows/ci.yml:11,12,18`
**Issue:** `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` are major-version tags. A compromised first-party action (or an internal force-push to the `v4` tag) would silently affect the next CI run. This was an explicit deferred decision in 01-02 SUMMARY ("tighten later if supply-chain hardening becomes a requirement") — flagging here for traceability so the deferral isn't forgotten.

**Fix:** When supply-chain hardening becomes a requirement, replace each tag with a full 40-char commit SHA and add a comment with the resolved version, e.g.:
```yaml
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
```

### IN-03: `categories: ["Other"]` is too generic for Marketplace discoverability

**File:** `package.json:11`
**Issue:** `"Other"` is the catch-all category. For an extension that adds Python script execution against a cloud API, `"Programming Languages"` or `"Snippets"` (or a multi-entry `["Programming Languages", "Other"]`) would surface the extension to relevant Marketplace searches. Cosmetic, but free improvement on first publish.

**Fix:**
```json
"categories": ["Programming Languages", "Other"],
```

---

_Reviewed: 2026-05-19_
_Reviewer: gsd-code-reviewer (adversarial)_
_Depth: standard_
