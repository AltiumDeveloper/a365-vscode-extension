---
phase: 08-distinct-vsix-version-per-build
plan: 01
subsystem: infra
tags: [github-actions, vsce, ci, semver, release-automation]

# Dependency graph
requires:
  - phase: 01-packaging
    provides: Initial CI workflow (.github/workflows/ci.yml) with vsce package + artifact upload
provides:
  - "Unique pre-release version stamped per main-branch CI run (BASE-ci.RUN+SHA7)"
  - "Auto-created GitHub Release per main commit with .vsix attached as asset"
  - "vitest gating before package step (releases blocked on red tests)"
  - "PR build path that still produces an installable artifact-only VSIX"
affects: [08-02, 08-03, 08-04]  # SemVer comparator + in-extension updater consume the release feed this plan publishes

# Tech tracking
tech-stack:
  added:
    - softprops/action-gh-release@v2 (GitHub Release creation from CI)
  patterns:
    - "Single-job CI with main-gated steps via `if: github.ref == 'refs/heads/main'`"
    - "Runner-only `npm version --no-git-tag-version --allow-same-version` (never committed back)"
    - "Conditional package step (vsce --pre-release on main, plain npm run package elsewhere)"

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Pin softprops/action-gh-release@v2 (major-version pin matches existing actions/*@v4 convention)"
  - "Shipped the locked ${BASE}-ci.N+SHA7 form; fallback to ${BASE}-ci.N.SHA7 deferred per PLAN Pitfall #2 mitigation"
  - "Used `softprops/action-gh-release@v2` rather than `gh release create` for the simpler YAML and built-in asset attachment"
  - "Workflow-level permissions block (not job-level) — single job, equally scoped"

patterns-established:
  - "Pattern: main-only steps use literal `if: github.ref == 'refs/heads/main'` (no env indirection)"
  - "Pattern: version computation emits to $GITHUB_OUTPUT with id `ver`, consumed downstream as steps.ver.outputs.version"
  - "Pattern: pre-release VSIX flag is required whenever the stamped version carries a `-tag` suffix"

requirements-completed:
  - CI-VER-01
  - CI-VER-02
  - CI-VER-03
  - CI-VER-04

# Metrics
duration: ~5min
completed: 2026-05-25
---

# Phase 08 Plan 01: Distinct VSIX Version per Build — CI Versioning + Release Publishing Summary

**Per-commit unique pre-release VSIX versions (`0.1.0-ci.N+SHA7`) published as GitHub Releases via softprops/action-gh-release@v2; vitest gating added before package step.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-25T22:55:33Z
- **Completed:** 2026-05-25T23:00:00Z
- **Tasks:** 1 / 1
- **Files modified:** 1

## Accomplishments

- CI workflow now stamps `package.json` with `${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}` on every main push (runner-only; never committed).
- Every main commit auto-creates a GitHub Release named `v${version}` with the matching `.vsix` attached as a release asset (using `softprops/action-gh-release@v2`).
- PRs targeting `main` now also run the workflow and produce an artifact-only VSIX (reviewer-install testing path); they do NOT create a release.
- `npm test` (vitest) now runs between `npm run compile` and the package step — releases are gated on green tests.
- Workflow declares `permissions: { contents: write }` so the built-in `GITHUB_TOKEN` can create releases.

## Task Commits

1. **Task 1: Extend ci.yml with version stamping, conditional packaging, and GitHub Release publishing** — `01189aa` (feat)

## Files Created/Modified

- `.github/workflows/ci.yml` — extended from 21 → 54 lines: added `pull_request` trigger, workflow-level `permissions: contents: write`, `fetch-depth: 1` on checkout, `npm test` step, main-gated `Compute version` step (id `ver`), split package step (main → `npx vsce package --pre-release`, non-main → `npm run package`), main-gated `softprops/action-gh-release@v2` step with `tag_name: v${{ steps.ver.outputs.version }}`, `prerelease: true`, `files: '*.vsix'`, body from head commit message.

## Decisions Made

- **Workflow-level permissions:** Placed `permissions: contents: write` at workflow scope rather than job scope. Single-job workflow → no difference operationally; workflow-scope is one fewer level of indentation and matches the GitHub Actions docs example for action-gh-release.
- **`pull_request` trigger added:** PLAN's CI-VER-03 implies pull-request flow already exists; the original 21-line workflow had no `pull_request` trigger so PRs never ran CI at all. Added `pull_request.branches: [main]` per PLAN Task 1 step 1.
- **No fallback version scheme implemented:** Shipped the locked `${BASE}-ci.N+SHA7` form. Per PLAN Pitfall #2, the documented fallback (`${BASE}-ci.N.SHA7`) is deferred until/unless `vsce package --pre-release` rejects the version on first CI run.

## Deviations from Plan

### Meta-deviation (process, not code)

**1. Parallel-agent commit interleaving (no rule — process observation)**
- **Found during:** First `git commit` attempt for Task 1.
- **Observation:** A parallel agent (running Phase 08-02) committed `src/semverCompare.ts` and `test/semverCompare.test.ts` (commits `41b5834` + `d4fa2fa`) while this executor was running. The interleaving wiped this executor's staged change to `.github/workflows/ci.yml` — first `git commit` returned "no changes added to commit" despite a prior successful `git add`.
- **Resolution:** Re-staged `.github/workflows/ci.yml` and committed cleanly as `01189aa`. No code impact; final state is correct.
- **Files modified:** None (process note only).
- **Verification:** `git diff HEAD~1 HEAD -- .github/workflows/ci.yml` shows exactly the intended 34-insertion / 1-deletion delta from the prior 21-line file.

### Auto-fixed Issues

None — plan executed exactly as written. All 6 plan-defined automated checks pass and all 6 success criteria are satisfied.

---

**Total deviations:** 0 code deviations; 1 process observation (parallel agent interleaving).
**Impact on plan:** None — final commit state matches PLAN acceptance criteria byte-for-byte.

## Verification Results

All Task 1 `<automated>` checks pass against the committed file:

| Check | Result |
|-------|--------|
| YAML parses (js-yaml) | ✅ OK, keys: `name`, `on`, `permissions`, `jobs` |
| `grep -q "softprops/action-gh-release@v2"` | ✅ FOUND |
| `grep -q "contents: write"` | ✅ FOUND |
| `grep -q "npm version"` | ✅ FOUND |
| `grep -q "vsce package --pre-release"` | ✅ FOUND |
| `grep -q "pull_request"` | ✅ FOUND |
| `grep -q "npm test"` | ✅ FOUND |
| Main-gating count `github.ref == 'refs/heads/main'` ≥ 3 | ✅ exactly 3 (Compute version, package main variant, Create GitHub Release) |

All 6 success criteria satisfied:

1. ✅ `contents: write` permission declared.
2. ✅ Main builds stamp `package.json` via `npm version --no-git-tag-version --allow-same-version` (runner-only).
3. ✅ Main builds invoke `vsce package --pre-release`.
4. ✅ Main builds publish a GitHub Release with the VSIX attached via `softprops/action-gh-release@v2`.
5. ✅ Non-main builds continue to upload a plain artifact (`npm run package` + `actions/upload-artifact@v4`, no release).
6. ✅ `npm test` runs before either package step.

## Issues Encountered

- See "Meta-deviation" above (parallel-agent commit interleaving). Resolved by re-staging; no functional impact.

## User Setup Required

None — workflow uses the built-in `GITHUB_TOKEN`. No repository secrets, branch-protection changes, or org settings required for the new release-publishing step to function.

## Manual UAT (out of scope — owned by /gsd:verify-work)

Per PLAN `<done>`:
- Push a commit to a feature branch → expect workflow-artifact VSIX, no GitHub Release.
- Merge to `main` → expect a GitHub Release named `v0.1.0-ci.{N}+{SHA7}` with the matching `.vsix` attached.

## Self-Check: PASSED

- File exists: `.github/workflows/ci.yml` → FOUND (54 lines).
- Commit exists: `01189aa` → FOUND in `git log --oneline -1`.
- All `<automated>` grep assertions: PASS.
- YAML validity: PASS (js-yaml load).

## Next Phase Readiness

- **08-02 (SemVer comparator):** already merged in parallel by sibling executor — provides `compareVersions` for the updater to consume.
- **08-03 (in-extension updater):** unblocked. Release feed at `https://api.github.com/repos/altium/a365-vscode-extension/releases` will populate on the next main push and the updater can begin polling it.
- **No blockers** for 08-03/08-04.

---
*Phase: 08-distinct-vsix-version-per-build*
*Completed: 2026-05-25*
