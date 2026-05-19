# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-19)

**Core value:** A developer can open VS Code, sign in once, and go from browsing their A365 workspace to running or deploying a script — without leaving the editor or hand-crafting API calls.
**Current focus:** Phase 1 — Packaging

## Current Position

Phase: 1 of 3 (Packaging)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-05-19 — Roadmap created; 3 phases, 16 v1 requirements mapped

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Pre-roadmap: Side panel tree depth: Workspace → Projects + Scripts (two children per workspace)
- Pre-roadmap: Remote script editing: edit in VS Code, explicit publish action (not auto-save)
- Pre-roadmap: Remote execution logs: Output Channel (existing pattern)
- Pre-roadmap: No bundler in v1 — plain tsc output, `vsce` for packaging

### Pending Todos

None yet.

### Blockers/Concerns

- `extension.ts` is 484 lines mixing UI orchestration and subprocess management — Phase 2 side panel work is the natural forcing function to extract `src/runner.ts`
- Tokens passed as env vars to Python subprocess (known concern; acceptable for v1, document it)

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-05-19
Stopped at: Roadmap created — ready to plan Phase 1
Resume file: None
