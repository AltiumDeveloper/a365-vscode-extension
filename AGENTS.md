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

**Extension entry point:** `src/extension.ts` — activation, wiring and the palette-level command registrations; tree context-menu commands are registered in `src/ux/treeCommands.ts`
**Config:** `src/config.ts` — merges the active named environment over the top-level settings into a `ResolvedConfig`
**Auth:** `src/auth/index.ts` — OAuth2 PKCE via `@altium-developer/altium-auth`, token storage, workspace token exchange
**UX:** `src/ux/` — command registration, tree view and its context-menu commands, side panel, status bar
**Runner:** `src/runner/` — Python interpreter resolution, subprocess launch, sandbox, script analysis
**Scripts:** `src/scripts/` — remote script operations (edit/publish/execute), local cache, `altium365:` FileSystemProvider in `remoteFs.ts`
**Workspace:** `src/workspace/` — GraphQL queries for workspaces/projects/extension points, `graphqlRequest` helper in `graphql.ts`
**Shared:** `src/shared/` — `asyncMutex`, `logDedup`
**Test events:** `src/testEvents/` — test event storage, resolution, FSP, status indicator
  - `identity.ts` — script identity resolution (local path vs remote workspace+scriptId)
  - `store.ts` — test event storage in `context.globalState`
  - `resolver.ts` — test event resolution with sibling `.params.json` import fallback
  - `eventFs.ts` — `altium365-event:` FileSystemProvider for test event editing
  - `statusItem.ts` — status bar indicator showing active Python editor's default test event
  - `commands.ts` — pick/create/edit/delete/setDefault test event commands
  - `picker.ts` — unified test event picker UI
  - `importSibling.ts` — one-time sibling `.params.json` import flow
**Python runtime:** `python/_runner.py` + `python/a365.py` — A365 scripting emulator

**Key constraints:** 
- All tokens stored via `context.secrets` — never plaintext on disk. Temp params files use `os.tmpdir()`.
- Test events stored in `context.globalState` under `altium365.scriptParams.<identity>` — NOT synced via Settings Sync
- Script identity = local absolute path OR `(workspaceId, scriptId)` for remote scripts
- Status bar indicator shows active Python editor's default test event

## Key shipped features

- Test events (AWS-Lambda-style named parameter sets per script)
- Remote script FileSystemProvider (`altium365:` scheme)
- Script identity resolution module (`testEvents/identity.ts`)
- Status bar test event indicator with rich tooltip
- Extension points model in sidebar

## Tech Stack

- TypeScript 5.4+, VS Code Extension API (≥1.85.0), Node.js ≥20
- `esbuild` bundles `src/extension.ts` to a single CJS `out/extension.js`; `tsc --noEmit` typechecks. Required because `@altium-developer/altium-auth` is ESM-only and the extension host loads CommonJS
- `vsce` for VSIX packaging
- `vitest` for unit testing
- Python 3 for local script execution (subprocess)

## Code Conventions

See `.planning/codebase/CONVENTIONS.md` for full details. Key points:
- All VS Code commands prefixed `altium365.`
- Async/await throughout; errors surfaced via `vscode.window.showErrorMessage` at command boundary
- GraphQL requests via `graphqlRequest<T = unknown>(endpoint, accessToken, query, variables?): Promise<T | undefined>` in `src/workspace/graphql.ts` — pass the selection-set shape, and keep runtime-guarded fields as `unknown`. `undefined` because a response can carry no `data` without carrying `errors`
- No module-level state except `outputChannel` singleton
- FileSystemProvider pattern for virtual documents (`altium365:`, `altium365-event:` schemes)
- Script identity resolution via `buildIdentity()`/`parseIdentity()` helpers in `testEvents/identity.ts`
- Test event commands prefixed `altium365.testEvents.*`

## Documentation Maintenance

**README.md** is the user-facing documentation and MUST be kept in sync with the codebase. When making changes that affect user-visible behavior:

1. **New commands:** Update the Commands Reference section in README.md — group by category (Auth, Script Execution, Test Events, etc.)
2. **Changed OAuth scopes:** Update the OAuth Scopes section
3. **New configuration settings:** Add to the Configuration section with descriptions
4. **Deprecated settings:** Mark as deprecated in README.md and document replacement
5. **Architecture changes:** Update AGENTS.md (this file) if new modules or patterns are introduced
6. **New features:** Update the feature list at the top of README.md

**When in doubt:** If a user would see or interact with the change (commands, UI, settings, behavior), document it in README.md. If only agents/developers need to know (architecture, patterns, constraints), document it in AGENTS.md.

**Verification checklist after any change:**
- [ ] Do all command palette entries in README.md match `package.json` contributions?
- [ ] Are deprecated commands/settings marked clearly?
- [ ] Does the Commands Reference section accurately describe what each command does?
- [ ] Are OAuth scopes, token architecture, and storage locations documented correctly?
