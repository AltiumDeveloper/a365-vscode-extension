---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 999.3 Plan 02 complete + UAT approved; ready for Plan 03 (FSP)
last_updated: "2026-05-23T23:30:00.000Z"
last_activity: 2026-05-23
progress:
  total_phases: 12
  completed_phases: 8
  total_plans: 42
  completed_plans: 42
  percent: 70
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-19)

**Core value:** A developer can open VS Code, sign in once, and go from browsing their A365 workspace to running or deploying a script — without leaving the editor or hand-crafting API calls.
**Current focus:** Phase 999.3 — script test events (planning complete; ready to execute)

## Current Position

Phase: 999.3
Plan: 999.3-03 (FSP on altium365-event:// + jsonValidation registration)
Status: Ready to execute (Wave 3 of 6)
Last activity: 2026-05-23

Progress: [█████████░] 96%

Phase 999.3 wave structure (sequential, all touch extension.ts):

- Wave 1 ✅ Plan 01 (Foundation — schema + store + identity)
- Wave 2 ✅ Plan 02 (ATOMIC resolver migration — UAT approved)
- Wave 3 ▶ Plan 03 (FSP on altium365-event://)
- Wave 4   Plan 04 (Picker + 5 commands + first-run UI)
- Wave 5   Plan 05 (Menu wiring A + B)
- Wave 6   Plan 06 (Polish + A/B UAT + README)

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | - | - |
| 06 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-packaging P01 | 2 min | 2 tasks | 4 files |
| Phase 01-packaging P02 | 1 min | 2 tasks | 2 files |
| Phase 02-side-panel P01 | 1 min | 1 tasks | 1 files |
| Phase 02 P02-02 | 4 min | 2 tasks | 1 files |
| Phase 02 P03 | 2 min | 2 tasks | 1 files |
| Phase 02 P04 | 2 min | 2 tasks | 2 files |
| Phase 02 P05 | 3 min | 2 tasks | 2 files |
| Phase 02 P06 | 4 min | 2 tasks | 2 files |
| Phase 02.1 P01 | 4 min | 2 tasks | 1 files |
| Phase 02.1 P02 | 1 min | 1 tasks | 1 files |
| Phase 02.1 P03 | 3 min | 4 tasks | 3 files |
| Phase 02.1 P04 | 3 min | 2 tasks | 2 files |
| Phase 02.1 P05 | 2 min | 4 tasks | 4 files |
| Phase 04 P01 | 6 min | 2 tasks | 1 files |
| Phase 04-ui-polish P02 | 3 min | 2 tasks | 2 files |
| Phase 04-ui-polish P03 | 1 min | 1 tasks | 1 files |
| Phase 04-ui-polish P04 | 6 min | 4 tasks | 5 files |

## Accumulated Context

### Roadmap Evolution

- Phase 02.1 inserted after Phase 02: Side-panel UX closure (G-01..G-05 from human UAT) (URGENT)
- Phase 02.2 inserted after Phase 02.1: Auth hardening — close carry-forward CR-01/CR-02/WR-01 (02-REVIEW.md) and WR-05 (02.1-REVIEW.md) before Phase 3 remote script mutations (URGENT)

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Pre-roadmap: Side panel tree depth: Workspace → Projects + Scripts (two children per workspace)
- Pre-roadmap: Remote script editing: edit in VS Code, explicit publish action (not auto-save)
- Pre-roadmap: Remote execution logs: Output Channel (existing pattern)
- Pre-roadmap: No bundler in v1 — plain tsc output, `vsce` for packaging
- [Phase 01-packaging]: Generate the 128x128 extension icon programmatically via scripts/generate-icon.js (zero-dependency Node script) rather than committing a hand-drawn asset
- [Phase 01-packaging]: Bumped extension version 0.0.2 to 0.1.0 to mark the first packaged build
- [Phase ?]: [Phase 01-packaging]: Use main-only CI trigger with explicit npm run compile before npm run package for fail-fast tsc errors — Per D-08/D-09; redundant compile is acceptable for clearer failure step
- [Phase 02-side-panel P06]: D-09 / SCRIPT-01 (run-local from tree) deferred to Phase 3 — Task 1 blocking human-verify of the A365 file-download endpoint (Assumption A1) and package format (A2) returned BLOCKED because no live A365 workspace was available for verification. All four altium365.script.* commands registered as Phase 3 placeholders so the right-click menu surfaces consistent UX. The runScriptAtPath refactor shipped anyway and is ready for Phase 3 to consume.
- [Phase 02.1-01]: Workspace expand performs single Promise.all([listProjects, listScripts]) and hydrates both projectsCache + scriptsCache; category expansion is a pure synchronous cache read — preserves Phase 02's "one round-trip per workspace expand" performance contract while enabling collapsible Projects/Scripts groups
- [Phase 02.1-01]: Missing category cache treated as empty array rather than triggering a fresh fetch — keeps category resolution side-effect-free; refresh() handles repopulation
- [Phase 02.1-02]: Bound view/title globe icon to existing altium365.selectEnvironment command (D-08 named it altium365.switchEnvironment which is a typo) — Reuse existing handler — zero new code; D-08 behaviour preserved with the actual command id that compiles
- [Phase 02.1-03]: New shared module src/treeCommands.ts hosts tree-generic command handlers per D-11 — registerTreeCommands(ctx, output) factory mirrors registerScriptCommands shape; future plans (Open in Browser) append disposables to the returned array
- [Phase 02.1-04]: Active workspace = the workspace whose token was most recently exchanged via ensureWorkspaceToken; tracked in globalState 'altium365.activeWorkspaceId', written exchange-path-only, cleared on sign-out
- [Phase 02.1-04]: Inactive workspace icon uses ThemeIcon('cloud') + ThemeColor('descriptionForeground') because 'cloud-outline' is not in the standard VS Code codicon set
- [Phase 02.1]: Open in Browser handlers appended to existing registerTreeCommands factory — D-11 keeps tree-generic handlers co-located; Plan 02.1-03 wiring already spreads disposables — no extension.ts changes needed
- [Phase 04-04]: Renamed pickAndExchangeWorkspace → pickWorkspace (pure picker, returns WorkspaceInfo | undefined); side effects (ensureWorkspaceToken + globalState write) factored into new exported applyWorkspaceSelection(context, workspace) helper in extension.ts shared by palette QuickPick and tree context menu
- [Phase 04-04]: contextValue-suffix pattern (workspaceNode-active / workspaceNode-inactive) gates per-state menu visibility; state-agnostic entries use VS Code when-clause regex viewItem =~ /^workspaceNode/
- [Phase 04-04]: extension.ts ↔ treeCommands.ts circular import resolves cleanly under tsc because applyWorkspaceSelection is accessed lazily inside a registerCommand handler body, not at module init — planner's fallback (relocate to workspace.ts) not adopted
- [Phase 999.3-01]: Identity regex duplicated in identity.ts instead of imported from remoteScriptFs.ts — keeps the resolver module pure (no FSP machinery pull-in)
- [Phase 999.3-01]: TestEventStore.events typed Record<string, Record<string, unknown>> (stricter than plan's Record<string, object>) — better consumer type-safety with no contract change
- [Phase 999.3-02]: Stale D-05 doc-comments in remoteExecution.ts updated rather than deleted — preserves the D-05 → D-20..D-22 migration trail for future readers; verification gate intent ("no code references") satisfied
- [Phase 999.3-02]: Defensive escape-hatch — missing file / non-object JSON logs warning and falls through to next branch rather than throwing
- [Phase 999.3-02]: UAT approved 2026-05-23 for all 7 scenarios (silent default, sibling import, decline marker, escape hatch, no-op setting in both run paths)

### Pending Todos

_None — `2026-05-22-phase-05-candidates` promoted to Phase 6 on 2026-05-22._

### Blockers/Concerns

- `extension.ts` is 484 lines mixing UI orchestration and subprocess management — Phase 2 side panel work is the natural forcing function to extract `src/runner.ts`
- Tokens passed as env vars to Python subprocess (known concern; acceptable for v1, document it)

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Phase 3 | SCRIPT-01 (run A365 script body locally from tree) | Pending Phase 3 — needs live-workspace endpoint verification | Phase 02 P06 (2026-05-19) |
| Phase 3 | D-09 (fetch → tmpdir 0o600 → runScriptAtPath → finally unlink) | Pending Phase 3 — same blocker as SCRIPT-01 | Phase 02 P06 (2026-05-19) |
| Phase 3 | RESEARCH.md Assumption A1 (file-download URL template + auth header) | Unverified — re-run Plan 02-06 Task 1 protocol against a live workspace | Phase 02 P06 (2026-05-19) |
| Phase 3 | RESEARCH.md Assumption A2 (single .py vs zip archive) | Unverified — `file -b` downloaded body; if archive, add unzip + entry-point rule | Phase 02 P06 (2026-05-19) |

## Session Continuity

Last session: 2026-05-23T18:26:24.233Z
Stopped at: Phase 999.3 planned (6 plans + PLAN-CHECK PASS-with-fixes)
Resume file: .planning/phases/999.3-script-test-events-backlog/999.3-CONTEXT.md
