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

**Extension entry point:** `src/extension.ts` (991 lines — command registration + UI orchestration + subprocess management)
**Auth:** `src/auth.ts` — OAuth2 PKCE, token storage, workspace token exchange
**Workspace:** `src/workspace.ts` — GraphQL queries for workspaces/projects, `graphqlRequest` helper
**Test events:** `src/testEvents/` (1502 lines) — test event storage, resolution, FSP, status indicator
  - `identity.ts` — script identity resolution (local path vs remote workspace+scriptId)
  - `store.ts` — test event storage in `context.globalState`
  - `resolver.ts` — test event resolution with sibling `.params.json` import fallback
  - `eventFs.ts` — `altium365-event:` FileSystemProvider for test event editing
  - `statusItem.ts` — status bar indicator showing active Python editor's default test event
  - `commands.ts` — pick/create/edit/delete/setDefault test event commands
  - `picker.ts` — unified test event picker UI
  - `importSibling.ts` — one-time sibling `.params.json` import flow
**Remote scripts:** `src/remoteScriptFs.ts` (350 lines) — `altium365:` FileSystemProvider for remote scripts
**Python runtime:** `python/_runner.py` + `python/a365.py` — A365 scripting emulator

**Key constraints:** 
- All tokens stored via `context.secrets` — never plaintext on disk. Temp params files use `os.tmpdir()`.
- Test events stored in `context.globalState` under `altium365.scriptParams.<identity>` — NOT synced via Settings Sync
- Script identity = local absolute path OR `(workspaceId, scriptId)` for remote scripts
- Status bar indicator shows active Python editor's default test event

## Phase Execution Order

**Completed phases (1-13):**
1. **Phase 1 — Packaging:** `vsce` setup, CI pipeline, Marketplace metadata, README ✅
2. **Phase 2 — Side Panel:** `TreeDataProvider`, Activity Bar view, workspace/project/script tree, script context menu ✅
3. **Phase 2.1 — Side Panel UX Closure:** Collapsible categories, active workspace indicator, globe button, Open in Browser ✅
4. **Phase 2.2 — Auth Hardening:** Carry-forward code review issues (CR-01, CR-02, WR-01, WR-05) ✅
5. **Phase 3 — Remote Script Operations:** open/edit/publish/execute remote scripts via GraphQL ✅
6. **Phase 4 — UI Polish:** Tree icons, contextValue gating, workspace selection from tree ✅
7. **Phase 6 — Test Events (999.3):** Test event storage, resolution, FSP, status indicator, unified picker ✅
8. **Phase 7 — Vitest:** Unit testing infrastructure with vitest ✅
9. **Phase 8 — Versioning:** Distinct VSIX version per build, extension rebrand to "Altium Developer" ✅
10. **Phase 8.1 — Auth Refresh:** `offline_access` scope, silent token refresh, `onAuthStateChanged` listener ✅
11. **Phase 9 — IntelliSense:** Editor IntelliSense for injected PYTHONPATH libraries ✅
12. **Phase 10 — Extension Points:** Rework sidebar around extension points (vs raw scripts) ✅
13. **Phase 11-13 — Workspace App Installation:** App installation check and install flow ✅

**Key shipped features:**
- Test events (AWS-Lambda-style named parameter sets per script)
- Remote script FileSystemProvider (`altium365:` scheme)
- Script identity resolution module (`testEvents/identity.ts`)
- Status bar test event indicator with rich tooltip
- Extension points model in sidebar

## Tech Stack

- TypeScript 5.4+, VS Code Extension API (≥1.85.0), Node.js ≥18
- No bundler — plain `tsc` output to `out/`
- `vsce` for VSIX packaging
- `vitest` for unit testing
- Python 3 for local script execution (subprocess)

## Code Conventions

See `.planning/codebase/CONVENTIONS.md` for full details. Key points:
- All VS Code commands prefixed `altium365.`
- Async/await throughout; errors surfaced via `vscode.window.showErrorMessage` at command boundary
- GraphQL requests via `graphqlRequest(endpoint, token, query, variables)` in `src/workspace.ts` — reuse this pattern for script API calls
- No module-level state except `outputChannel` singleton
- FileSystemProvider pattern for virtual documents (`altium365:`, `altium365-event:` schemes)
- Script identity resolution via `buildIdentity()`/`parseIdentity()` helpers in `testEvents/identity.ts`
- Test event commands prefixed `altium365.testEvents.*`
