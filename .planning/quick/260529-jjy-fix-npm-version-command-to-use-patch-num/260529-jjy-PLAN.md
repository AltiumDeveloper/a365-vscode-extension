---
phase: quick-260529-jjy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [.github/workflows/ci.yml]
autonomous: true
requirements: []

must_haves:
  truths:
    - CI build completes without npm version errors
    - GitHub release tags use standard 3-part semver
    - VSIX filename contains run number in patch position
  artifacts:
    - path: ".github/workflows/ci.yml"
      provides: "Fixed version computation using run number as patch"
      contains: "VERSION=\"0.1.${GITHUB_RUN_NUMBER}\""
  key_links:
    - from: "Compute version step"
      to: "npm version command"
      via: "VERSION env var"
      pattern: "npm version.*VERSION"
---

<objective>
Fix CI build failure by changing version scheme from 4-part semver (0.1.0.8) to standard 3-part semver (0.1.RUN_NUMBER).

Purpose: npm version command and VSCode Marketplace only accept MAJOR.MINOR.PATCH format
Output: Working CI builds with valid semver versions
</objective>

<execution_context>
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.github/workflows/ci.yml

## Problem Context

Current CI workflow computes version as: `${BASE}.${GITHUB_RUN_NUMBER}` where BASE=0.1.0
This produces 4-part semver like "0.1.0.8" which npm rejects with "Invalid version"

VSCode Marketplace and npm only support standard 3-part semver: MAJOR.MINOR.PATCH

## Solution

Use run number AS the patch version: 0.1.${GITHUB_RUN_NUMBER}
- Example: Run 8 → version 0.1.8
- Example: Run 42 → version 0.1.42

This is the standard approach for CI versioning with incremental builds.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update CI version computation to use run number as patch</name>
  <files>.github/workflows/ci.yml</files>
  <action>
In the "Compute version" step, change the VERSION computation from:
- Current: `VERSION="${BASE}.${GITHUB_RUN_NUMBER}"` (produces 0.1.0.8)
- New: `VERSION="0.1.${GITHUB_RUN_NUMBER}"` (produces 0.1.8)

Rationale: npm version command only accepts standard 3-part semver (MAJOR.MINOR.PATCH). The BASE variable from package.json (0.1.0) is not needed — we hardcode the MAJOR.MINOR prefix and use GITHUB_RUN_NUMBER directly as PATCH.

Keep the npm version command unchanged — it will now receive valid semver.
Keep the BASE extraction line for now (defensive — might be used for future version schemes).
  </action>
  <verify>
    <automated>grep -q 'VERSION="0.1.\${GITHUB_RUN_NUMBER}"' .github/workflows/ci.yml && echo "PASS: Version format updated to 3-part semver" || echo "FAIL: Version format not found"</automated>
  </verify>
  <done>CI workflow version computation uses 0.1.${GITHUB_RUN_NUMBER} format, producing valid 3-part semver that npm accepts</done>
</task>

</tasks>

<verification>
After commit:
- CI build should succeed on next push to main
- GitHub release tag should be in format v0.1.N (where N is run number)
- npm version command should not throw "Invalid version" error
- VSIX filename should be altium-developer-0.1.N.vsix
</verification>

<success_criteria>
- [ ] .github/workflows/ci.yml uses VERSION="0.1.${GITHUB_RUN_NUMBER}"
- [ ] Version format produces valid 3-part semver (e.g., 0.1.8, 0.1.42)
- [ ] npm version command will accept the computed version
- [ ] Changes committed with descriptive message
</success_criteria>

<output>
Create `.planning/quick/260529-jjy-fix-npm-version-command-to-use-patch-num/260529-jjy-SUMMARY.md` when done
</output>
