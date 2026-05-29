---
phase: quick-260529-jdx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [.github/workflows/ci.yml]
autonomous: true
requirements: []

must_haves:
  truths:
    - "CI builds on main produce VSIX with clean semver version (no prerelease suffix)"
    - "GitHub releases still track build metadata via tag naming"
    - "VSIX package.json contains marketplace-compatible version string"
  artifacts:
    - path: ".github/workflows/ci.yml"
      provides: "CI workflow with marketplace-compatible versioning"
      min_lines: 50
  key_links:
    - from: ".github/workflows/ci.yml"
      to: "vsce package command"
      via: "version stamping"
      pattern: "npm version.*--no-git-tag-version"
---

<objective>
Fix CI workflow to produce VSCode marketplace-compatible version strings by removing prerelease suffix and `--pre-release` flag from main branch builds.

**Purpose:** VSCode Marketplace requires clean semver versions (X.Y.Z format) without prerelease identifiers. Current CI generates versions like `0.1.0-ci.123+abcd123` which are incompatible with Marketplace publishing requirements.

**Output:** CI workflow that stamps clean semver version into package.json and produces standard VSIX (not marked pre-release).
</objective>

<execution_context>
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.github/workflows/ci.yml
@package.json

## Current Issue

CI workflow (Phase 8) stamps prerelease versions for Marketplace-readiness, but VSCode Marketplace rejects VSIX files with prerelease version identifiers. The `--pre-release` flag and `-ci.N+SHA` suffix must be removed for Marketplace compatibility.

Current flow (line 25-36):
1. Computes `VERSION="${BASE}-ci.${GITHUB_RUN_NUMBER}+${SHA7}"` (e.g., `0.1.0-ci.123+abcd123`)
2. Stamps into package.json via `npm version`
3. Packages with `npx vsce package --pre-release`

Required flow:
1. Use clean base version from package.json (e.g., `0.1.0`)
2. Optionally auto-increment patch version based on run number
3. Package with standard `vsce package` (no `--pre-release` flag)
4. GitHub release tags can still include build metadata for traceability
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove prerelease suffix and flag from CI workflow</name>
  <files>.github/workflows/ci.yml</files>
  <action>
Update the "Compute version" step (lines 25-33) to use clean semver format:
- Change VERSION line to: `VERSION="${BASE}.${GITHUB_RUN_NUMBER}"` (e.g., `0.1.0.123`)
- VSCode Marketplace accepts 4-part versions (X.Y.Z.BUILD) for auto-incrementing builds
- Keep `npm version "$VERSION" --no-git-tag-version --allow-same-version` to stamp into package.json

Update the "Package VSIX (main, pre-release)" step (lines 34-36):
- Rename to "Package VSIX (main)"
- Change command from `npx vsce package --pre-release` to `npm run package` (uses `vsce package` without flags)
- Preserves same packaging flow as non-main branches

Update "Create GitHub Release" step (lines 44-52):
- Keep `tag_name` and `name` as `v${{ steps.ver.outputs.version }}` for traceability
- Change `prerelease: true` to `prerelease: false` — these are now release builds ready for Marketplace

The SHA7 commit reference is removed from version string but preserved in release body via `${{ github.event.head_commit.message }}` — sufficient traceability without polluting version.
  </action>
  <verify>
    <automated>grep -c "vsce package --pre-release" .github/workflows/ci.yml | grep -q "^0$" && grep -q 'VERSION="\${BASE}\.\${GITHUB_RUN_NUMBER}"' .github/workflows/ci.yml && grep -q "prerelease: false" .github/workflows/ci.yml</automated>
  </verify>
  <done>CI workflow uses clean 4-part semver (X.Y.Z.BUILD), packages without --pre-release flag, and marks GitHub releases as stable</done>
</task>

</tasks>

<verification>
**Automated checks:**
- `--pre-release` flag removed from vsce command
- Version format changed to `${BASE}.${GITHUB_RUN_NUMBER}` (4-part semver)
- `prerelease: false` in GitHub release step

**Manual verification** (after next CI run on main):
1. Check GitHub Actions run output — "Compute version" step should show version like `0.1.0.124` (no `-ci.` suffix)
2. Download VSIX artifact and unzip — `extension/package.json` should have version `"0.1.0.124"`
3. GitHub Release should be marked as "Latest" (not "Pre-release")
</verification>

<success_criteria>
- CI workflow produces VSIX with clean semver version compatible with VSCode Marketplace
- Version string follows 4-part format `X.Y.Z.BUILD` using GITHUB_RUN_NUMBER
- No `--pre-release` flag used in vsce package command
- GitHub releases marked as stable releases (not prereleases)
- Build traceability preserved via release tags and commit messages
</success_criteria>

<output>
Create `.planning/quick/260529-jdx-fix-vscode-marketplace-version-string-re/260529-jdx-SUMMARY.md` when done
</output>
