---
phase: quick-260601-dv8
plan: 01
subsystem: documentation
tags: [docs, readme, agents-md, branding, architecture-sync]
dependency_graph:
  requires: []
  provides: [user-facing-docs, agent-context-docs]
  affects: [README.md, AGENTS.md]
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - path: README.md
      purpose: User-facing documentation with current extension state
      lines_changed: +55/-19
    - path: AGENTS.md
      purpose: Agent-facing project context
      lines_changed: +42/-6
decisions:
  - "Remove all internal environment URLs from README.md (usw2.dev-365.altium.com, etc) to prevent leaking internal infrastructure details"
  - "Remove appId GRID references from README.md — internal implementation detail, not user-facing"
  - "Document OAuth scopes and token architecture in README.md for user understanding of permissions"
  - "Mark checkForUpdates setting as deprecated in README.md (GitHub Releases disabled while preparing for Marketplace)"
  - "Document removed settings (inputParametersPath, promptForProjectId) in README.md for migration clarity"
  - "Update AGENTS.md architecture summary with testEvents/ module breakdown (1502 lines across 8 files)"
  - "Update AGENTS.md with all 13 completed phases to give agents accurate project timeline context"
metrics:
  duration: 2min
  completed: 2026-06-01
---

# Quick Task 260601-dv8: Refresh README.md and AGENTS.md

**One-liner:** Updated user-facing README.md with current branding ("Altium Developer"), OAuth scopes, token architecture, complete command list, and removed internal URLs; updated agent-facing AGENTS.md with 13 completed phases and current architecture (testEvents module, FSP patterns, vitest).

## Overview

Refreshed both documentation files to reflect the current state of the extension after 13 completed phases. README.md was outdated (still referenced "Altium 365 Developer Tools", missing test events documentation, contained internal environment details). AGENTS.md needed updates to reflect current architecture (test events module, remote script FSP, identity resolution, extension points).

## Tasks Completed

### Task 1: Update README.md to current extension state

**Status:** ✅ Complete  
**Commit:** 2eaaada

Updated README.md with:
1. **Branding:** Changed title from "Altium 365 Developer Tools" to "Altium Developer" (matches package.json displayName)
2. **Authentication & Scopes section:** Documented all OAuth scopes:
   - `openid profile` — basic user identity
   - `offline_access` — enables refresh_token for silent sign-in
   - `workspace:scripts.manage` — required for editing/publishing
   - `workspace:scripts.execute` — required for remote execution
3. **Global vs Workspace Tokens section:** Explained token architecture:
   - Global token from browser OAuth flow
   - Workspace tokens obtained via automatic exchange
   - `context.auth_token` behavior (global vs workspace-scoped)
   - Sign out clears all tokens
4. **Commands Reference:** Updated table with all 17 current commands including test event commands
5. **Configuration:** Marked `checkForUpdates` as deprecated, documented removed settings
6. **Removed internal details:**
   - Removed specific Dev/Uat/Prod URLs (usw2.dev-365.altium.com, etc)
   - Removed appId GRID references
   - Replaced with generic "Multiple environments can be configured" language

**Files modified:** README.md (+55/-19 lines)

**Verification:** ✅ Passed
```bash
grep -q "Altium Developer" README.md && \
grep -q "Global vs Workspace Tokens" README.md && \
grep -q "offline_access" README.md && \
! grep -q "usw2.dev-365.altium.com" README.md && \
! grep -q "appId" README.md
```

### Task 2: Update AGENTS.md to current architecture

**Status:** ✅ Complete  
**Commit:** 99ac002

Updated AGENTS.md with:
1. **Architecture Summary:** 
   - Updated extension.ts line count (484 → 991)
   - Added testEvents/ module breakdown (1502 lines total):
     - identity.ts — script identity resolution
     - store.ts — test event storage in globalState
     - resolver.ts — resolution with sibling .params.json fallback
     - eventFs.ts — altium365-event: FileSystemProvider
     - statusItem.ts — status bar indicator
     - commands.ts — test event commands
     - picker.ts — unified picker UI
     - importSibling.ts — sibling import flow
   - Added remoteScriptFs.ts (350 lines) — altium365: FileSystemProvider
2. **Phase Execution Order:**
   - Listed all 13 completed phases (1–13)
   - Added key shipped features summary
3. **Tech Stack:** Added vitest for unit testing
4. **Code Conventions:**
   - FileSystemProvider pattern (altium365:, altium365-event: schemes)
   - Script identity resolution helpers (buildIdentity/parseIdentity)
   - Test event command prefix (altium365.testEvents.*)
5. **Key constraints:**
   - Test events stored in context.globalState (NOT synced via Settings Sync)
   - Script identity = local absolute path OR (workspaceId, scriptId)
   - Status bar indicator shows active Python editor's default test event

**Files modified:** AGENTS.md (+42/-6 lines)

**Verification:** ✅ Passed
```bash
grep -q "identity.ts" AGENTS.md && \
grep -q "testEvents" AGENTS.md && \
grep -q "context.globalState" AGENTS.md && \
grep -q "altium365-event:" AGENTS.md
```

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message | Files |
|------|---------|-------|
| 2eaaada | docs(quick-260601-dv8-01): update README.md to current extension state | README.md |
| 99ac002 | docs(quick-260601-dv8-01): update AGENTS.md to current architecture | AGENTS.md |

## Self-Check

**Verification results:**

1. **Created files exist:**
   - N/A — no new files created

2. **Modified files exist:**
   ```bash
   [ -f "README.md" ] && echo "FOUND: README.md" || echo "MISSING: README.md"
   # FOUND: README.md
   [ -f "AGENTS.md" ] && echo "FOUND: AGENTS.md" || echo "MISSING: AGENTS.md"
   # FOUND: AGENTS.md
   ```

3. **Commits exist:**
   ```bash
   git log --oneline --all | grep -q "2eaaada" && echo "FOUND: 2eaaada" || echo "MISSING: 2eaaada"
   # FOUND: 2eaaada
   git log --oneline --all | grep -q "99ac002" && echo "FOUND: 99ac002" || echo "MISSING: 99ac002"
   # FOUND: 99ac002
   ```

## Self-Check: PASSED

All files modified, all commits present, all automated verifications passed.
