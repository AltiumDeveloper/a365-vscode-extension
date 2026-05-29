---
phase: quick-260529-jjy
plan: 01
subsystem: ci
tags: [ci, versioning, semver, npm, github-actions]
dependency_graph:
  requires: []
  provides: [valid-semver-versions]
  affects: [.github/workflows/ci.yml]
tech_stack:
  added: []
  patterns: [3-part-semver-with-run-number]
key_files:
  created: []
  modified: [.github/workflows/ci.yml]
decisions:
  - Use GITHUB_RUN_NUMBER directly as patch version (0.1.N) instead of appending to base version (0.1.0.N)
  - Keep BASE variable extraction for defensive future-proofing, even though hardcoded prefix is used
metrics:
  duration_minutes: 1
  completed_date: "2026-05-29"
---

# Quick Task 260529-jjy: Fix npm version command to use patch number

**One-liner:** Changed CI version scheme from invalid 4-part semver (0.1.0.8) to standard 3-part semver (0.1.RUN_NUMBER) for npm/Marketplace compatibility

## Context

The CI workflow was producing invalid semver versions by appending the run number to the base version from package.json, resulting in 4-part versions like `0.1.0.8`. Both npm's `npm version` command and the VSCode Marketplace only accept standard 3-part semver format: `MAJOR.MINOR.PATCH`.

This quick task fixes the version computation to use the GitHub run number directly as the patch version, producing valid semver like `0.1.8`, `0.1.42`, etc.

## Implementation Summary

### Task 1: Update CI version computation to use run number as patch

**Status:** ✅ Complete  
**Commit:** e18113c

Changed `.github/workflows/ci.yml` line 30 from:
```yaml
VERSION="${BASE}.${GITHUB_RUN_NUMBER}"  # Produces 0.1.0.8
```

To:
```yaml
VERSION="0.1.${GITHUB_RUN_NUMBER}"      # Produces 0.1.8
```

**Rationale:** The npm version command only accepts standard 3-part semver (MAJOR.MINOR.PATCH). Hardcoding the `0.1` prefix and using `GITHUB_RUN_NUMBER` directly as the patch version produces valid semver that npm accepts.

**Defensive decision:** Kept the `BASE` variable extraction line even though it's no longer used in the VERSION computation. This maintains the option to switch to a different versioning scheme in the future without having to re-add infrastructure.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

### Automated Verification

✅ `grep -q 'VERSION="0.1.\${GITHUB_RUN_NUMBER}"' .github/workflows/ci.yml` — PASS

### Expected Outcomes (will verify on next CI run)

- CI build will succeed on next push to main
- GitHub release tag will be in format `v0.1.N` (where N is run number)
- npm version command will not throw "Invalid version" error
- VSIX filename will be `altium-developer-0.1.N.vsix`

## Files Changed

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `.github/workflows/ci.yml` | 1 | Fixed version computation to use 3-part semver |

## Commits

| Hash | Type | Message |
|------|------|---------|
| e18113c | fix | use 3-part semver for CI builds |

## Success Criteria

- [x] `.github/workflows/ci.yml` uses `VERSION="0.1.${GITHUB_RUN_NUMBER}"`
- [x] Version format produces valid 3-part semver (e.g., 0.1.8, 0.1.42)
- [x] npm version command will accept the computed version
- [x] Changes committed with descriptive message

## Self-Check: PASSED

**Verification:**
```bash
✅ FOUND: .github/workflows/ci.yml (file exists)
✅ FOUND: e18113c (commit exists in git log)
```

All created/modified files exist and all commits are present in git history.
