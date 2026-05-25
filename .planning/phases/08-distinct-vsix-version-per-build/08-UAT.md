---
status: complete
phase: 08-distinct-vsix-version-per-build
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md]
started: 2026-05-26T00:00:00Z
updated: 2026-05-26T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Launch Extension Development Host (F5). Extension activates without errors. Output channel "Altium 365" shows a line like `[Altium 365] updater: ...` within ~10s. No red error toasts on activation.
result: pass
note: "User saw `[Altium 365] updater: auto check failed: HTTP 404` in output — graceful failure path worked (output-only, no toast). Separate gap logged for hardcoded repo URL mismatch (altium/a365-vscode-extension vs actual AltiumDeveloper/a365-vscode-extension)."

### 2. Rebrand Visible in Extensions Panel
expected: In the Extension Development Host, open the Extensions view. The extension appears as "Altium Developer" (displayName). Open Command Palette — commands appear under category "Altium Developer" (e.g. "Altium Developer: Check for Updates").
result: issue
reported: "I still see Altium 365 in command palette and do NOT see the extension in the Extensions view. The panel is there though and runs as I expect. When I search for settings, I can see Altium Developer there"
severity: major

### 3. Manual "Check for Updates" — Up-to-Date Path
expected: Run command "Altium Developer: Check for Updates" from palette while on the latest installed version. An info toast appears stating you are on the latest version (or equivalent explicit "no update available" feedback). Output channel logs the check.
result: pass
note: "User saw error toast `Altium 365: update check failed — see Output panel for details` (manual-failure UX worked as designed: explicit toast + Output pointer, vs silent log on auto check). Cannot exercise true up-to-date path until URL gap from Test 1 is fixed. Brand string `Altium 365` in toast folded into Test 2 rebrand gap."

### 4. Manual "Check for Updates" — Update Available Path
expected: With an older version installed (or by temporarily bumping installed version backward), run "Altium Developer: Check for Updates" from the palette. A toast appears offering to download and install the newer release. Clicking the action downloads the VSIX, installs it, and prompts to Reload Window.
result: skipped
reason: "Blocked by Test 1 URL gap (404 prevents reaching the update-available path). Also requires at least one published release in the target repo. Re-run after URL fix lands AND first CI release is published."

### 5. Setting Toggle Disables Auto-Check
expected: Set `altium365.checkForUpdates: false` in Settings. Reload the window. On activation, no auto-update check runs (no `[Altium 365] updater: ...` activation log line beyond a skip/disabled notice). Manual palette command still works.
result: pass
note: "User confirmed: output showed `[Altium 365] updater: auto check disabled via altium365.checkForUpdates setting`; manual palette command still attempted (fails with known URL 404, expected per Test 1)."

### 6. Push to Main Publishes GitHub Release with VSIX
expected: Push a commit to `main` branch. The CI workflow runs. A new GitHub Release named `v0.1.0-ci.{N}+{sha7}` is created on the repo's Releases page, marked as pre-release, with the matching `.vsix` file attached as a release asset.
result: skipped
reason: "User skipped — not exercising push-to-main during UAT session. Re-run after first main-branch CI run completes (verifier-flagged UAT item)."

### 7. Non-Main Push Produces Artifact-Only, No Release
expected: Push a commit to a feature branch (or open a PR). The CI workflow runs. A workflow artifact contains the `.vsix`, but NO new GitHub Release is created.
result: skipped
reason: "User skipped — not exercising feature-branch push during UAT session. Re-run after first non-main CI run completes (verifier-flagged UAT item)."

## Summary

total: 7
passed: 3
issues: 2
pending: 0
skipped: 3
blocked: 0

## Gaps

- truth: "Updater queries the correct GitHub repo for releases"
  status: failed
  reason: "Hardcoded RELEASES_URL in src/updater.ts:31 points to `altium/a365-vscode-extension`, but actual repo is `AltiumDeveloper/a365-vscode-extension`. Returns HTTP 404 even when repo is public. Same wrong owner string appears in the module header doc comment (src/updater.ts:11)."
  severity: major
  test: 1
  artifacts:
    - path: "src/updater.ts"
      issue: "RELEASES_URL hardcoded to wrong GitHub owner (`altium` instead of `AltiumDeveloper`)"
  missing:
    - "Correct the owner segment of RELEASES_URL from `altium` to `AltiumDeveloper` (or extract to a constant / read from package.json `repository.url`)"
    - "Update the matching reference in the module header doc comment"
  debug_session: ""

- truth: "All user-visible brand surfaces (command palette categories, Activity Bar view title, sidebar label) display as 'Altium Developer'"
  status: failed
  reason: "User reported: I still see Altium 365 in command palette and do NOT see the extension in the Extensions view. The panel is there though and runs as I expect. When I search for settings, I can see Altium Developer there. Code confirms: 21 of 22 command `category` fields in package.json still say 'Altium 365' (only the new checkForUpdates command at line 162 was rebranded). View title at line 25 and sidebar label at line 289 also still say 'Altium 365'. CONTEXT.md Part 3 scope only covered displayName + extension ID; the user-visible category/view strings were not in scope but should have been."
  severity: major
  test: 2
  artifacts:
    - path: "package.json"
      issue: "21 command `category` fields + 1 view `title` + 1 sidebar `label` still display 'Altium 365' instead of 'Altium Developer'"
  missing:
    - "Bulk-replace `\"category\": \"Altium 365\"` → `\"category\": \"Altium Developer\"` for all 21 affected command contributions in package.json"
    - "Update `\"title\": \"Altium 365\"` at package.json:25 (view container title) → `\"Altium Developer\"`"
    - "Update `\"label\": \"Altium 365\"` at package.json:289 → `\"Altium Developer\"`"
    - "Confirm scope: keep command IDs (`altium365.*`) and config keys (`altium365.*`) unchanged per CONTEXT.md Part 3 — only display-string fields change"
  debug_session: ""
