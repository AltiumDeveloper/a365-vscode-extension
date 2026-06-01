# Phase 11: Unit tests and code organisation - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 11 delivers a well-structured unit test suite that validates the main contracts of each module, paired with code organisation improvements that emerge organically as writing tests reveals structural gaps. The test suite is readable and supports long-term evolution — it is not aiming for 100% coverage.

The seven planned test modules cover: auth (token lifecycle, refresh, sign-out, onAuthStateChanged), UI/UX (treeProvider, treeCommands, picker helpers), test events (identity, store, resolver, picker, importSibling), file management (remoteScriptFs, eventFs URI helpers), Python-specific (runner subprocess wiring, param file lifecycle), Altium runtime/dependency (workspace token exchange, GraphQL helper, extension-point queries), and Entity/Platform API (script identity round-trip, app installation check).

Code reorganisation is included where tests reveal structural issues — no upfront planned refactoring agenda, but refactoring as a prerequisite to testability is in scope.

Out of scope: adding end-to-end tests, VS Code extension host integration tests, performance tests, adding new user-facing features, breaking changes to existing command IDs or config keys.

</domain>

<decisions>
## Implementation Decisions

### VS Code mock strategy
- **D-01:** A single shared comprehensive mock lives at `test/__mocks__/vscode.ts` (the path already aliased in `vitest.config.ts`). The mock is extended incrementally as each plan adds coverage — no plan invents a separate mock file.
- **D-02:** Mock state (SecretStorage contents, GlobalState entries, etc.) is reset before each test using `beforeEach`. Tests must be fully isolated — no state bleeding between test cases.
- **D-03:** The mock provides factory functions that return fresh instances per test (e.g. `makeSecretStorage()`, `makeGlobalState()`, `makeExtensionContext()`). Tests compose the context they need from these factories. No global mock instances shared across tests.

### What 'unit' means for VS Code modules
- **D-04:** The primary unit of test is **pure sub-functions extracted from command handlers** — not the whole command handler. Functions that mix VS Code API calls with business logic should have their pure core extracted and tested in isolation. This matches the existing test pattern (`dedupLogPage.test.ts`, `pythonAnalysisSync.test.ts`).
- **D-05:** If a function needs to be extracted to be testable, that extraction is included in the plan as a prerequisite step. No separate refactoring phase — extraction happens in the same plan that adds the tests.
- **D-06:** All new test files live in `test/` mirroring the `src/` structure (e.g. `test/auth.test.ts`, `test/testEvents/store.test.ts`). Consistent with existing test placement. `vitest.config.ts` already includes `test/**/*.test.ts`.

### Coverage target and test depth
- **D-07:** No numeric threshold. Coverage goal is: **happy path + the most important error/edge cases per module**. Coverage is a signal, not a gate. A test file is "good enough" when it tells the story of the module — someone reading the tests understands what the module does and what can go wrong.
- **D-08:** For VS Code-heavy functions (QuickPick flows, showErrorMessage, progress notifications): **skip with a note** rather than invest in complex UI mocking. Each plan should document skipped functions in a comment block or a brief `SKIPPED.md` note so they can be revisited. High-value functions (state mutations, business logic, token lifecycle) are always tested.

### Code organisation
- **D-09:** Code reorganisation is **agent-decided, module-by-module**, as tests reveal structure issues. No upfront mandate to split `extension.ts` or reorganise modules. However: if a test plan finds a module untestable without reorganisation, the plan includes the reorganisation. The agent chooses what to reorganise based on what each plan needs to deliver its tests.
- **D-10:** The refactoring prerequisite in D-05 and D-09 must not break existing functionality. Each plan that includes a refactoring step must verify that the existing `npm run compile` passes and that any existing tests still pass.

### Agent's Discretion
- Exact mock surface coverage for each VS Code API (e.g. how deeply to mock `window.showQuickPick` vs a thin stub) — agent decides per plan based on what the tests need.
- Whether to use `vi.spyOn` vs factory functions for specific VS Code APIs.
- Ordering of plans (the 7 plans may be reordered during planning if dependencies require it).
- Whether to add `vitest --coverage` reporting to CI as an informational step (no threshold enforcement — D-07).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Test infrastructure
- `vitest.config.ts` — Vitest configuration: `include: ['test/**/*.test.ts']`, `environment: 'node'`, vscode alias pointing to `test/__mocks__/vscode.ts`
- `test/__mocks__/vscode.ts` — Current shared vscode mock (currently empty `export {}`); Phase 11 builds this out comprehensively
- `test/dedupLogPage.test.ts` — Example of existing pure-function test pattern (no VS Code mock needed)
- `test/pythonAnalysisSync.test.ts` — Example of test with mock dependencies; established pattern for Phase 11 tests

### Modules under test
- `src/auth.ts` — Auth module: token lifecycle, refresh, sign-out, onAuthStateChanged
- `src/sidePanel.ts` — TreeDataProvider: workspace/project/script/extension-point tree building
- `src/treeCommands.ts` — Tree-generic command handlers
- `src/testEvents/identity.ts` — Script identity resolution (local path vs remote workspaceId+scriptId)
- `src/testEvents/store.ts` — Test event storage in context.globalState
- `src/testEvents/resolver.ts` — Test event resolution with sibling .params.json fallback
- `src/testEvents/eventFs.ts` — altium365-event: FileSystemProvider
- `src/testEvents/statusItem.ts` — Status bar indicator
- `src/remoteScriptFs.ts` — altium365: FileSystemProvider for remote scripts
- `src/workspace.ts` — GraphQL helper (graphqlRequest), workspace/project/extension-point queries
- `src/extension.ts` — Extension activate/deactivate and command handlers (~484 lines)

### Conventions to preserve
- `.planning/codebase/CONVENTIONS.md` — Naming, code style, error handling, module design conventions
- `AGENTS.md` — Extension-specific guidelines including command naming, storage key conventions

### Project context
- `.planning/ROADMAP.md` — Phase 11 entry with 7-plan breakdown
- `.planning/STATE.md` — Current decisions including patterns established across all prior phases

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/__mocks__/vscode.ts` — Currently empty; Phase 11 builds the comprehensive shared mock here following the factory-function pattern (D-03)
- `vitest.config.ts` — Already configured with vscode alias and `test/**/*.test.ts` glob; no changes needed unless test structure changes
- `test/__mocks__/` directory — Mock pattern directory already established; any additional mock files (e.g. for `fetch`, `child_process`) can live alongside the vscode mock

### Established Patterns
- **Pure function extraction pattern** — Existing tests (`dedupLogPage.test.ts`, `pythonAnalysisSync.test.ts`) test pure functions extracted from larger modules. Phase 11 follows this: extract → test the extraction.
- **Vitest without coverage gate** — Coverage is not enforced in CI today; Phase 11 does not add a gate (D-07). Optional `--coverage` flag is available for local runs.
- **Test file naming** — Existing tests: `dedupLogPage.test.ts`, `pythonAnalysisSync.test.ts`, `pythonAnalysisSyncLifecycle.test.ts`, `sandboxDeps.test.ts`. Pattern: `<moduleName>.test.ts` or `<feature>.test.ts`.

### Integration Points
- `test/` directory — All new test files land here, mirroring `src/` structure
- `package.json` `scripts.test` — Should verify `vitest run` command is wired; check if it exists and update if needed
- `src/testEvents/` — 7-file module that Phase 11 covers in plan 11-03; these modules already have clean function exports suitable for unit testing

</code_context>

<specifics>
## Specific Ideas

- The `test/__mocks__/vscode.ts` mock should expose: `SecretStorage` (with in-memory store), `GlobalState` (with in-memory store), `ExtensionContext` (composed from factories), `window.showErrorMessage` / `showInformationMessage` / `showWarningMessage` (vi.fn stubs), `window.showQuickPick` (vi.fn stub, optionally spyable), `workspace.getConfiguration` (returns stub config), `commands.executeCommand` (vi.fn stub), `EventEmitter` (real or stub).
- Script identity round-trip (`buildIdentity` / `parseIdentity` in `testEvents/identity.ts`) is a prime candidate for pure-function testing with no VS Code mock needed — start here for plan 11-07.
- The `graphqlRequest` helper in `src/workspace.ts` can be tested by mocking `fetch` — no VS Code API required. Good candidate for early plans.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-unit-tests-and-code-organisation*
*Context gathered: 2026-06-01*
