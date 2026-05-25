---
phase: 08-distinct-vsix-version-per-build
plan: 02
subsystem: updater
tags: [semver, comparator, vitest, pure-helper]
requires: []
provides:
  - src/semverCompare.ts (parseVersion, compareVersions, ParsedVersion)
  - test/compareVersions.test.ts (vitest coverage)
affects: []
tech_stack:
  added: []
  patterns: [pure-helper-no-vscode-imports, semver-2.0]
key_files:
  created:
    - src/semverCompare.ts
    - test/compareVersions.test.ts
  modified: []
decisions:
  - "Helper file named src/semverCompare.ts (not nested under updater.ts) — Plan 08-03 will re-export it from updater.ts"
  - "Regex accepts optional leading 'v' so release.tag_name / release.name (v$VERSION shape from 08-01) can be passed straight in"
  - "Unparseable input returns 0 — fail-safe against malformed remote release names; documented inline"
requirements: [UPD-01]
metrics:
  duration: ~2 min
  completed: 2026-05-25
---

# Phase 08 Plan 02: SemVer Comparator Pure Helper Summary

**One-liner:** Inline SemVer 2.0 §10/§11 comparator (`parseVersion` + `compareVersions`) in a vscode-free module, plus 8-case vitest spec — ready for Plan 08-03's updater to consume without any runtime deps.

## What Shipped

- **`src/semverCompare.ts`** (112 lines) — exports `ParsedVersion` interface, `parseVersion(v)` and `compareVersions(a, b)`. Implements:
  - §10: build metadata after `+` ignored in precedence.
  - §11.2: base-triple numeric compare.
  - §11.3: normal version > any pre-release of the same base.
  - §11.4.1: numeric identifiers compare numerically.
  - §11.4.2: alphanumeric identifiers compare lexically in ASCII order.
  - §11.4.3: numeric < alphanumeric at same pre-release position.
  - §11.4.4: longer pre-release array wins when all compared identifiers equal.
  - Optional leading `v?` in the regex so `release.tag_name` / `release.name` work straight in.
  - Unparseable input → `compareVersions` returns `0` (safe — never raises false update prompt).
- **`test/compareVersions.test.ts`** (47 lines, 8 `it()` blocks) — covers all 7 enumerated SemVer §11 cases from 08-RESEARCH.md:606-633 plus a `parseVersion('v0.1.0-ci.42+abc')` leading-`v` strip case.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| TS compiles strict | `npx tsc --noEmit` | exit 0 |
| Zero vscode imports | `grep -c "'vscode'" src/semverCompare.ts` | 0 |
| Zero fs imports | `grep -c "from 'fs'" src/semverCompare.ts` | 0 |
| Zero require() | `grep -c "require(" src/semverCompare.ts` | 0 |
| All exports present | `grep` for parseVersion / compareVersions / ParsedVersion | all OK |
| New spec passes | `npx vitest run test/compareVersions.test.ts` | 8/8 |
| Full suite green | `npm test` | 13/13 (8 new + 5 pre-existing) |
| Relative import (no path alias) | `grep` for `'../src/semverCompare'` | found |
| Test file location | `test/compareVersions.test.ts` matches `vitest.config.ts` glob | OK |

## Success Criteria Status

1. ✅ `src/semverCompare.ts` exports `parseVersion`, `compareVersions`, `ParsedVersion` and imports nothing.
2. ✅ Comparator implements SemVer 2.0 §10 + §11 (build metadata ignored; normal > pre-release; numeric < alphanumeric; longer pre-release tie-break).
3. ✅ Unparseable input returns 0 — no false update prompt path.
4. ✅ `test/compareVersions.test.ts` covers all 7 enumerated cases + 1 `parseVersion` leading-`v` case (8 `it()` blocks total).
5. ✅ `npm test` exits 0 (13/13).

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `41b5834` | feat | Add pure SemVer 2.0 comparator helper (src/semverCompare.ts) |
| `d4fa2fa` | test | Cover all 7 SemVer §11 cases for compareVersions |

## Deviations from Plan

**None** — both tasks executed exactly as specified.

**Process note (not a plan deviation):** The first commit attempt swept in an unrelated, concurrently-staged modification to `.github/workflows/ci.yml` (Plan 08-01's territory). I `git reset --soft HEAD~1`, unstaged the ci.yml change with `git restore --staged`, and re-committed only `src/semverCompare.ts` (`41b5834`). No work was lost; the ci.yml change remains in the worktree unstaged for Plan 08-01 to commit. Followed the protocol's per-file staging rule (`git add <file>`, never `git add .`) — the unintended sweep happened because I ran `git commit` after the per-file `git add` without re-checking that nothing else had become staged via a concurrent agent.

## Deferred Items

None.

## Threat Flags

None — pure CPU-only helper, no network, no filesystem, no auth surface added.

## Known Stubs

None — the helper is complete and consumable by Plan 08-03. Plan 08-03 will:

- `import { compareVersions } from './semverCompare';` from inside `src/updater.ts`.
- Call `compareVersions(release.tag_name, vscode.extensions.getExtension('altium.developer')?.packageJSON.version)` to decide whether to surface the "update available" toast.

## Handoff to Plan 08-03

- Public surface frozen: `parseVersion(v: string): ParsedVersion | null` and `compareVersions(a: string, b: string): number`.
- Sign convention: negative if `a < b`, 0 if equal precedence, positive if `a > b`.
- Leading `v` is accepted on both sides — Plan 08-03 can pass `release.tag_name` directly (no `replace(/^v/, '')` needed).
- Build metadata (`+abc`) is silently dropped — Plan 08-03 doesn't need to strip the SHA7 suffix before comparing.

## Self-Check: PASSED

- ✅ `src/semverCompare.ts` exists (112 lines).
- ✅ `test/compareVersions.test.ts` exists (47 lines, 8 `it()` blocks).
- ✅ Commit `41b5834` reachable in `git log` — contains only `src/semverCompare.ts` (1 file changed, 112 insertions).
- ✅ Commit `d4fa2fa` reachable in `git log` — contains only `test/compareVersions.test.ts` (1 file changed, 47 insertions).
- ✅ `npm test` green (13/13).
