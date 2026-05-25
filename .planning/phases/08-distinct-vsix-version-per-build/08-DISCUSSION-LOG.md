# Phase 8: distinct-vsix-version-per-build — Discussion Log

**Date:** 2026-05-25
**Mode:** default (interactive)
**Phase:** 8 — distinct-vsix-version-per-build

---

## Round 1 — Scope and CI versioning

### Q1: Phase scope
**Options presented:**
1. Part 1 only — distinct version per build
2. Part 1 + Part 2 Option B — include self-updater (~100 LOC)
3. Part 1 + document Option A in README

**Selected:** Part 1 + Part 2 Option B — include self-updater (~100 LOC)
**Note:** The versioning is unobservable without an updater to consume it, and the updater is ~100 LOC with no new runtime deps. Coherent single phase.

### Q2: Version format
**Options presented:**
1. `0.1.0-ci.${run_number}+${sha7}` (Recommended)
2. `0.1.${run_number}` (4-segment build counter)
3. `0.1.0-sha.${sha7}`

**Selected:** `0.1.0-ci.${run_number}+${sha7}`
**Note:** Preserves real semver for eventual Marketplace publish; monotonic via run_number; audit trail via build metadata.

### Q3: Release trigger
**Options presented:**
1. Every push to main auto-creates a GitHub Release (Recommended)
2. Only git tags create releases; pushes still upload workflow artifacts
3. Both — every push uploads artifact; only tags create Releases

**Selected:** Every push to main auto-creates a GitHub Release
**Note:** Friction-free for the handful of external users. No release-gating ceremony at this stage.

### Q4: Branch coverage
**Options presented:**
1. Only main builds get a unique version + release (Recommended)
2. All branches get unique versions

**Selected:** Only main builds get a unique version + release
**Note:** Non-main branches keep producing a `0.1.0` workflow artifact for local install testing.

---

## Round 2 — Self-updater specifics

### Q5: Update check timing
**Options presented:**
1. On activation, debounced to once per 24h (Recommended)
2. On activation, debounced to once per 6h
3. Manual only — no auto-check

**Selected:** On activation, debounced to once per 24h
**Note:** 60 req/hour anonymous GitHub API quota is comfortable with 24h per-user debounce.

### Q6: Auto-check default
**Options presented:**
1. Auto-check ON by default (Recommended)
2. Auto-check OFF by default — user opts in

**Selected:** Auto-check ON by default
**Note:** Setting `altium365.checkForUpdates: true` default; user can disable.

### Q7: Update flow UX
**Options presented:**
1. Toast notification → Update Now → install + reload prompt (Recommended)
2. Silent status-bar indicator only
3. Both — toast + status-bar indicator

**Selected:** Toast notification → Update Now → install + reload prompt
**Note:** Single surface, simplest implementation. Status-bar deferred.

### Q8: GitHub API endpoint
**Options presented:**
1. List releases, pick newest non-draft (Recommended)
2. Use /releases/latest endpoint
3. Include pre-releases explicitly via setting

**Selected:** List releases, pick newest non-draft
**Note:** `/releases/latest` excludes pre-releases; every CI build IS a pre-release (`-ci.N` suffix), so `/latest` would return stale or nothing. LIST endpoint + filter is correct.

---

## Deferred Ideas Captured

- Signed VSIX builds
- Marketplace publish from CI
- Channel-based updates (stable / insiders)
- Update rollback / install previous version
- Hand-curated release notes / changelog
- Pre-release-test before install (checksum verification)
- Status-bar update indicator

## Claude's Discretion

- File layout: `src/updater.ts` vs inline in `src/extension.ts` (size-threshold decision at plan time)
- Exact release-creation action: `softprops/action-gh-release@v2` vs `gh release create`
- Manual command "no update available" toast behavior
- Output channel log prefix for updater
