# AGENTS.md — Altium 365 VS Code Extension

## Project Context

This is a brownfield VS Code extension for Altium 365 developers. The existing foundation (OAuth2 PKCE auth, local script run/debug, workspace/environment switching) is working. New work builds on top of it.

Planning artifacts: `.planning/`
- `PROJECT.md` — project context, requirements, decisions
- `REQUIREMENTS.md` — scoped v1 requirements with REQ-IDs
- `ROADMAP.md` — 3-phase execution plan
- `STATE.md` — current state and focus
- `config.json` — workflow preferences (YOLO mode, parallel execution, balanced models)
- `codebase/` — architecture, stack, conventions, concerns maps

## Workflow (GSD)

This project uses the GSD workflow. Always:
1. Read `STATE.md` before starting any task to understand current phase and focus
2. Read `PLAN.md` in the active phase directory before executing
3. Commit atomically per plan — one commit per completed plan
4. Update `STATE.md` after each phase transition

## Architecture Summary

**Extension entry point:** `src/extension.ts` (484 lines — command registration + UI orchestration + subprocess management)
**Auth:** `src/auth.ts` — OAuth2 PKCE, token storage, workspace token exchange
**Workspace:** `src/workspace.ts` — GraphQL queries for workspaces/projects, `graphqlRequest` helper
**Python runtime:** `python/_runner.py` + `python/a365.py` — A365 scripting emulator

**Key constraint:** All tokens stored via `context.secrets` — never plaintext on disk. Temp params files use `os.tmpdir()`.

## Phase Execution Order

1. **Phase 1 — Packaging:** `vsce` setup, CI pipeline, Marketplace metadata, README
2. **Phase 2 — Side Panel:** `TreeDataProvider`, Activity Bar view, workspace/project/script tree, script context menu
3. **Phase 3 — Remote Script Operations:** open/edit/publish/execute remote scripts via `gloScrScripts`, `gloScrUpdateScript`, `gloScrExecuteScript` GraphQL operations

## Tech Stack

- TypeScript 5.4+, VS Code Extension API (≥1.85.0), Node.js ≥18
- No bundler — plain `tsc` output to `out/`
- `vsce` for VSIX packaging (to be added in Phase 1)
- Python 3 for local script execution (subprocess)

## Code Conventions

See `.planning/codebase/CONVENTIONS.md` for full details. Key points:
- All VS Code commands prefixed `altium365.`
- Async/await throughout; errors surfaced via `vscode.window.showErrorMessage` at command boundary
- GraphQL requests via `graphqlRequest(endpoint, token, query, variables)` in `src/workspace.ts` — reuse this pattern for script API calls
- No module-level state except `outputChannel` singleton
