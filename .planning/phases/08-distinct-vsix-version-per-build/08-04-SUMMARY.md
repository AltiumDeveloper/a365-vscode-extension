---
phase: 08
plan: 04
subsystem: packaging
tags: [rebrand, hotfix, gap-closure]
dependency_graph:
  requires: ["08-03"]
  provides: ["functional auto-update check", "complete Altium Developer rebrand in package.json"]
  affects: ["src/updater.ts", "package.json"]
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - src/updater.ts
    - package.json
decisions:
  - "Preserved description field at package.json:4 and viewsWelcome link at :41 — they reference the Altium 365 platform/product (not the extension brand)"
  - "Preserved altium365.graphqlEndpoint description at :171 — it documents the A365 API endpoint, not the extension's display name"
  - "Updated 4 sibling description references to 'Altium 365: Select Environment' palette command (lines 191/196/226/259) so descriptions match the live palette grouping after the category rename"
metrics:
  duration: "~5 min"
  completed_at: "2026-05-25T23:32:30Z"
  tasks: 2
  files_modified: 2
---

# Phase 8 Plan 4: Close Phase 8 UAT Gaps (Updater Owner + package.json Rebrand) Summary

One-liner: Hotfixes two mechanical gaps left by Phase 08 — the auto-updater pointed at a nonexistent GitHub repo (`altium/...` → 404 on every check) and 27 user-visible "Altium 365" display strings in `package.json` were missed in the Part 3 rebrand to "Altium Developer".

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Fix GitHub owner in `src/updater.ts` RELEASES_URL + doc comment | `3324023` | src/updater.ts |
| 2 | Replace "Altium 365" display strings in package.json | `62f84d2` | package.json |

## What Changed

### Gap 1 — `src/updater.ts`
- `RELEASES_URL` (line 31): `api.github.com/repos/altium/a365-vscode-extension/releases` → `api.github.com/repos/AltiumDeveloper/a365-vscode-extension/releases`
- Doc comment (line 11): `altium/a365-vscode-extension` → `AltiumDeveloper/a365-vscode-extension`
- **Preserved:** `EXTENSION_ID = 'altium.developer'` (this is the publisher.name VS Code identifier — correct, must not change), `GLOBAL_LAST_CHECK_KEY`, `LOG_PREFIX`, `USER_AGENT`, `DEBOUNCE_MS`.

### Gap 2 — `package.json`
- **22 command category fields:** `"category": "Altium 365"` → `"category": "Altium Developer"` (single `replaceAll`)
- **1 view container title** (line 25): `"title": "Altium 365"` → `"title": "Altium Developer"`
- **1 submenu label** (line 289, `altium365.editorTitle`): `"label": "Altium 365"` → `"label": "Altium Developer"`
- **4 sibling palette references** (lines 191, 196, 226, 259): `'Altium 365: Select Environment'` → `'Altium Developer: Select Environment'` inside `description` strings, so the descriptions match the live command palette name after the category rename. *(This was the plan-checker's non-blocking warning — flagged and handled explicitly.)*
- **Preserved (per CONTEXT.md Part 3 scope fence):**
  - All `altium365.*` command IDs, config keys, view container `id` (`altium365`), submenu `id` (`altium365.editorTitle`)
  - `description` field at line 4 (refers to the Altium 365 platform/product)
  - `viewsWelcome` content at line 41 (marketing copy + link to altium.com/altium-365)
  - `altium365.graphqlEndpoint` description at line 171 (refers to A365 API, including the ALTIUM365_GRAPHQL_ENDPOINT env var name)

## Verification Results

Plan's `<automated>` verification gate (both tasks):
- `node -e "JSON.parse(...)"` → OK
- `grep -c '"category": "Altium 365"' package.json` → **0** ✓
- `grep -c '"category": "Altium Developer"' package.json` → **23** ✓ (22 rebranded + 1 already-correct `altium365.checkForUpdates` at line 162)
- `grep -c '"title": "Altium 365"' package.json` → **0** ✓
- `grep -c '"label": "Altium 365"' package.json` → **0** ✓
- `grep -c 'altium/a365-vscode-extension' src/updater.ts` → **0** ✓
- `grep -c 'AltiumDeveloper/a365-vscode-extension' src/updater.ts` → **2** ✓ (RELEASES_URL + doc comment)
- `npm run compile` → clean (no TypeScript errors)
- All `altium365.*` identifiers intact: `"id": "altium365"`, `"altium365.signIn"`, `"altium365.graphqlEndpoint"`, `"id": "altium365.editorTitle"` — all present ✓
- `EXTENSION_ID = 'altium.developer'` preserved in updater.ts ✓

## Deviations from Plan

None — plan executed exactly as written. Plan-checker's non-blocking warning about the 4 sibling `'Altium 365: Select Environment'` description references (lines 191/196/226/259) was incorporated into Task 2 via a `replaceAll` on the literal string and is reflected in the verification counts above.

## Manual Verification (UAT.md UAT-008-04-01 / UAT-008-04-02)

Cannot be automated — requires installing the VSIX in VS Code:

1. **UAT-008-04-01 (Gap 1, updater):** Install the VSIX → run **Altium Developer: Check for Updates** from the palette → expect either "You're on the latest version" or a real update prompt (NO HTTP 404, NO "Failed to check for updates" error referencing the URL).
2. **UAT-008-04-02 (Gap 2, rebrand):** Open VS Code with the extension installed → open the command palette → confirm every Altium command is grouped under "Altium Developer" (no "Altium 365" grouping remains) → open the Activity Bar → confirm the side panel tooltip reads "Altium Developer" → right-click in an editor → confirm the submenu reads "Altium Developer".

Both UAT cases are now unblocked by the code changes shipped here.

## Threat Flags

None — this plan only renames display strings and corrects a typo in a constant. No new network endpoints, auth paths, file access, or trust boundaries.

## Known Stubs

None.

## Self-Check: PASSED

- `src/updater.ts` — FOUND, contains `AltiumDeveloper/a365-vscode-extension` ✓
- `package.json` — FOUND, 0 `"category": "Altium 365"` ✓
- commit `3324023` — FOUND in `git log` ✓
- commit `62f84d2` — FOUND in `git log` ✓
- SUMMARY.md — this file ✓
