---
status: partial
phase: 01-packaging
source: [01-VERIFICATION.md]
started: 2026-05-19T15:05:00Z
updated: 2026-05-19T15:05:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. GitHub Actions CI run on push to `main`
expected: Workflow `CI` succeeds; the `altium365-vsix` artifact is downloadable from the run page and contains `altium365-scripting-0.1.0.vsix`
result: passed (after fix c6a1d2e bumped Node 18 → 20 LTS; initial run failed with undici File ReferenceError on Node 18)

### 2. Install produced `.vsix` into clean VS Code 1.85+
expected: Extension installs without error; appears in Extensions sidebar with displayName "Altium 365 Developer Tools", the generated icon, and the 6 Altium 365 commands available in the Command Palette
result: [pending]

### 3. Visual icon quality at small sizes
expected: `resources/icon.png` (monochrome circuit-board motif) renders cleanly at ~32×32 Marketplace card size; reasonable contrast on both light and dark backgrounds
result: [pending]

### 4. README usability for external developer
expected: External developer with no prior project knowledge can follow install → sign-in → run-script flow and successfully execute a script. Tone is user-facing.
result: [pending]

## Summary

total: 4
passed: 1
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
