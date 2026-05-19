---
phase: 01-packaging
plan: 02
subsystem: infra
tags: [readme, ci, github-actions, vsix, documentation]

requires:
  - phase: 01-packaging
    provides: "npm run package script + Marketplace metadata that CI invokes; package.json command list referenced in README"
provides:
  - External-developer-facing README.md covering prerequisites, install, sign-in, run/debug, environment switching, commands reference
  - GitHub Actions CI workflow at .github/workflows/ci.yml that compiles, packages, and uploads the VSIX on every push to main
affects:
  - All future phases (CI now produces a downloadable VSIX artifact per main-branch push; README is the canonical user-facing doc that will be extended as features land)

tech-stack:
  added:
    - "GitHub Actions (actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4)"
  patterns:
    - "Main-only CI trigger — no PR pipeline noise; artifacts produced once per merged commit"
    - "Explicit `npm run compile` step before `npm run package` so tsc errors fail fast even though vsce would also invoke vscode:prepublish"

key-files:
  created:
    - .github/workflows/ci.yml
  modified:
    - README.md

key-decisions:
  - "Kept the explicit `npm run compile` step in CI alongside `npm run package` (per D-09) — small redundancy is acceptable for the fail-fast tsc signal"
  - "Used `@v4` major-version tags for all three actions rather than pinning to SHA — Phase 1 scope; tighten later if supply-chain hardening becomes a requirement"

patterns-established:
  - "External-developer docs live in README.md; internal/developer notes (build, contribute) belong in separate docs added later, not in README"
  - "CI runs only on push to main — feature branches and PRs do not produce VSIX artifacts in v1"

requirements-completed: [PKG-04, PKG-05]

duration: 1 min
completed: 2026-05-19
---

# Phase 01 Plan 02: README rewrite + CI pipeline Summary

**README.md is now an external-developer install guide (prerequisites → install → sign-in → run/debug → environments → commands), and `.github/workflows/ci.yml` publishes the VSIX as an `altium365-vsix` artifact on every push to main.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-05-19T14:08:00Z
- **Completed:** 2026-05-19T14:09:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- README.md rewritten end-to-end for external developers, covering all six required topics (prerequisites, install, sign-in, workspace selection, run/debug, environment switching) plus a Commands Reference table and a Configuration section
- All internal OAuth/PKCE/loopback implementation details removed from README per D-06
- `.github/workflows/ci.yml` created with the exact 4-step pipeline (npm ci → npm run compile → npm run package → upload-artifact@v4), triggered only on push to `main`
- Uploaded artifact name standardized as `altium365-vsix` for downstream automation

## Task Commits

1. **Task 1: Rewrite README.md for external developers** — `4418cf8` (feat)
2. **Task 2: Create .github/workflows/ci.yml** — `74eee91` (feat)

## Files Created/Modified

- `README.md` — Replaced developer-internal docs with external-user-facing guide (71 lines, 7 `##` sections). Now documents commands by their VS Code titles, not their internal command IDs.
- `.github/workflows/ci.yml` — Single `build` job on `ubuntu-latest`, Node 18, runs the 4-step pipeline and uploads `*.vsix` as the `altium365-vsix` artifact.

## Decisions Made

- **Kept the explicit `npm run compile` step in CI** alongside `npm run package`, per D-09. `vsce package` also runs `vscode:prepublish` (which compiles), so the explicit compile is technically redundant — but it makes tsc errors fail the job at a clearly-named step before vsce starts.
- **Used `@v4` major-version tags** for `actions/checkout`, `actions/setup-node`, and `actions/upload-artifact` rather than SHA pins. All three are first-party `actions/*` actions; tightening to SHA pins is a future supply-chain hardening task, not Phase 1 scope.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria passed on the first run:

- Task 1: All 5 required `##` sections present (`Prerequisites`, `Installation`, `Getting Started`, `Switching Environments`, `Commands Reference`); H1 `# Altium 365 Developer Tools` on line 1; zero `![` image tags; no PKCE/loopback strings; 71 lines (> 50 threshold).
- Task 2: `python3` content check returned `ci.yml OK` (all 7 required substrings present); `pull_request:` not found as a trigger; `branches: [main]` and `upload-artifact@v4` confirmed via grep.

**Total deviations:** 0
**Impact on plan:** None.

## Issues Encountered

- `python3 -c "import yaml; ..."` failed because `PyYAML` is not installed in this environment. Per the plan's own acceptance criterion (which explicitly allows this fallback), YAML validity was confirmed manually instead — the file is short, syntactically simple, and was inspected visually after the Write.

## Self-Check: PASSED

- `[ -f README.md ]` ✓
- `[ -f .github/workflows/ci.yml ]` ✓
- `git log --oneline --grep="01-02"` returns 2 commits (`4418cf8`, `74eee91`) ✓
- Plan-level verification:
  - `grep "# Altium 365 Developer Tools" README.md` returns the H1 ✓
  - `grep -c "^## " README.md` returns 7 (≥ 5) ✓
  - `grep "branches: \[main\]" .github/workflows/ci.yml` matches ✓
  - `grep "upload-artifact@v4" .github/workflows/ci.yml` matches ✓

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 1 (packaging) complete: VSIX build pipeline (Plan 01) + external-facing docs and CI (Plan 02) are in place. The next push to `main` will produce a downloadable `altium365-vsix` artifact.
- Ready for Phase 2 — Side Panel (TreeDataProvider, Activity Bar view, workspace/project/script tree).
- No blockers carried forward.

---
*Phase: 01-packaging*
*Completed: 2026-05-19*
