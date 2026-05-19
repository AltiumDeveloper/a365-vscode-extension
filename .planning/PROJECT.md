# Altium 365 VS Code Extension

## What This Is

A VS Code extension for Altium 365 developers that streamlines the full scripting workflow: authenticate against A365, navigate workspaces and projects via a side panel tree, author and run scripts locally using a bundled Python runtime emulator, and manage server-side scripts — browse, edit in VS Code, push changes to A365, trigger remote execution, and retrieve logs. Targets both internal Altium teams (dogfooding first) and external A365 platform developers.

## Core Value

A developer can open VS Code, sign in once, and go from browsing their A365 workspace to running or deploying a script — without leaving the editor or hand-crafting API calls.

## Requirements

### Validated

- ✓ OAuth2 PKCE sign-in / sign-out — existing
- ✓ Multi-environment support (dev / UAT / prod) via configuration presets — existing
- ✓ Workspace and project selection — existing
- ✓ Local script execution via Python subprocess with runtime emulation — existing
- ✓ Local script debugging (VS Code debug adapter) — existing

### Active

- [ ] Side panel (Activity Bar view) with tree: Workspaces → Projects / Scripts
- [ ] Run / edit / publish actions accessible from the tree (context menu + inline buttons)
- [ ] Remote script listing via `gloScrScripts` GraphQL query
- [ ] Open remote script content in VS Code editor (virtual document or temp file)
- [ ] Edit remote script and push changes via `gloScrUpdateScript` mutation
- [ ] Trigger remote script execution via `gloScrExecuteScript` mutation
- [ ] Stream remote execution logs to VS Code Output Channel
- [ ] Extension packaging with `vsce` — produce distributable VSIX
- [ ] CI-ready build pipeline (compile → package → artifact)

### Out of Scope

- Real-time collaborative editing — high complexity, not part of scripting workflow
- Mobile / web UI — VS Code only
- Bundler (webpack/esbuild) — plain `tsc` output is sufficient for current size; revisit if VSIX gets large
- VS Code Marketplace publish automation — manual publish via PAT token for v1; CI pipeline TBD

## Context

- **Existing architecture:** 3-layer TypeScript extension (Command/UI → Auth → Workspace) + Python subprocess runtime. Auth uses OAuth2 PKCE with loopback redirect. Workspace tokens use RFC 8693 exchange.
- **Remote script API:** Documented GraphQL endpoints at `altiumdeveloper.github.io/platform-api-docs` — `gloScrScripts` (list), `gloScrUpdateScript` (update content), `gloScrExecuteScript` (trigger). Same GraphQL client pattern already used in `src/workspace.ts`.
- **Codebase map:** `.planning/codebase/` contains full architecture, stack, conventions, concerns analysis.
- **Known concern:** `extension.ts` is 484 lines mixing UI orchestration and subprocess management. Side panel work is a natural forcing function to extract `src/runner.ts`.
- **Tokens passed as env vars to Python subprocess** — noted architectural concern; acceptable for v1 scripting workflow but should be documented.

## Constraints

- **Tech stack:** TypeScript + VS Code Extension API. No bundler for v1. `vsce` for packaging.
- **API:** A365 GraphQL — same `graphqlRequest` helper pattern from `src/workspace.ts` is reusable for script API calls.
- **Runtime:** VS Code ≥1.85.0, Node.js ≥18. Python 3 on PATH for local execution.
- **Auth:** All A365 API calls use existing workspace-scoped OAuth tokens (no new auth mechanism needed).
- **Distribution:** VSIX for v1; Marketplace readiness (publisher, README, icons) needed before going public.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Side panel tree depth: Workspace → Projects + Scripts (two children per workspace) | Matches how A365 organizes resources; keeps tree navigable without pagination complexity | — Pending |
| Remote script editing: edit in VS Code, explicit publish action (not auto-save) | Avoids accidental overwrites; maps to a clear "push" mental model | — Pending |
| Remote execution logs: Output Channel (existing pattern) | Consistent with local run UX; no new panel needed | — Pending |
| No bundler in v1 | Current codebase is small; plain tsc output keeps build simple | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-19 after initialization*
