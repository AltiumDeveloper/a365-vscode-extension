---
phase: quick-260529-jdx
plan: 01
subsystem: cicd
tags: [packaging, versioning, marketplace]
dependency_graph:
  requires: []
  provides: [marketplace-compatible-vsix]
  affects: [ci-pipeline, github-releases]
tech_stack:
  added: []
  patterns: [4-part-semver, github-actions-versioning]
key_files:
  created: []
  modified: [.github/workflows/ci.yml]
decisions:
  - Use 4-part semver (X.Y.Z.BUILD) for Marketplace compatibility instead of prerelease identifiers
  - Remove --pre-release flag from vsce package command
  - Mark GitHub releases as stable releases (not prereleases)
  - Preserve build traceability via release tags and commit messages
metrics:
  duration_minutes: 0.67
  completed_date: "2026-05-29"
---

# Quick Task 260529-jdx: Fix VSCode Marketplace Version String

**One-liner:** CI now produces Marketplace-compatible VSIX with clean 4-part semver (e.g., 0.1.0.124) instead of prerelease identifiers

## Tasks Completed

### Task 1: Remove prerelease suffix and flag from CI workflow ✅

**Status:** Complete  
**Files modified:** `.github/workflows/ci.yml`  
**Commit:** ebb0850

**Changes:**
1. Updated "Compute version" step to use clean 4-part semver format:
   - Changed from: `VERSION="${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}"`
   - Changed to: `VERSION="${BASE}.${GITHUB_RUN_NUMBER}"`
   - Removed SHA7 commit hash from version string
   - Produces versions like `0.1.0.124` instead of `0.1.0-ci.124+abcd123`

2. Updated "Package VSIX (main, pre-release)" step:
   - Renamed to "Package VSIX (main)"
   - Changed from: `npx vsce package --pre-release`
   - Changed to: `npm run package`
   - Aligns main branch packaging with non-main branches

3. Updated "Create GitHub Release" step:
   - Changed `prerelease: true` to `prerelease: false`
   - Marks GitHub releases as stable releases ready for Marketplace

**Verification:** Automated checks passed:
- ✅ `--pre-release` flag removed from vsce command (0 occurrences)
- ✅ Version format changed to `${BASE}.${GITHUB_RUN_NUMBER}`
- ✅ `prerelease: false` in GitHub release step

## Deviations from Plan

None - plan executed exactly as written.

## Summary

Successfully updated CI workflow to produce VSCode Marketplace-compatible VSIX packages. The workflow now:
- Stamps clean 4-part semver versions (X.Y.Z.BUILD) into package.json
- Packages VSIX without the `--pre-release` flag
- Marks GitHub releases as stable releases

Build traceability is preserved via:
- Release tags (e.g., `v0.1.0.124`)
- Commit messages in release body
- GitHub Actions run metadata

Next CI run on main will produce a VSIX with version `0.1.0.<run_number>` that is fully compatible with VSCode Marketplace publishing requirements.

## Self-Check: PASSED

**Files modified:**
- ✅ FOUND: .github/workflows/ci.yml

**Commits:**
- ✅ FOUND: ebb0850 (fix(quick-260529-jdx-01): remove prerelease suffix and flag for Marketplace compatibility)

**Verification:**
- ✅ All automated checks passed
- ✅ Version format correctly updated to 4-part semver
- ✅ No prerelease flags remaining in workflow
- ✅ GitHub releases marked as stable
