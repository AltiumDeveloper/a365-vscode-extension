# Phase 11: Unit tests and code organisation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 11-unit-tests-and-code-organisation
**Areas discussed:** VS Code mock strategy, What 'unit' means for VS Code modules, Coverage target and test depth, Code organisation scope

---

## VS Code mock strategy

### Q1: How should the shared mock be built?

| Option | Description | Selected |
|--------|-------------|----------|
| Shared comprehensive mock | Single `test/__mocks__/vscode.ts` covering all VS Code surfaces; all plans share one mock | ✓ |
| Per-test minimal mocks | Each test file builds only the mock surface it needs via vi.mock | |
| Real VS Code API (integration) | Use @vscode/test-electron; requires headless VS Code host | |

**User's choice:** Shared comprehensive mock

### Q2: Should mock state be reset between test cases?

| Option | Description | Selected |
|--------|-------------|----------|
| Reset before each test | vi.clearAllMocks or beforeEach reset; fully isolated tests | ✓ |
| Shared state within test file | State persists within a test file; tests manage own reset | |
| Agent decides per plan | Agent decides reset strategy based on plan needs | |

**User's choice:** Reset before each test

### Q3: How should the mock provide state containers?

| Option | Description | Selected |
|--------|-------------|----------|
| Factory functions per test | Mock exports makeSecretStorage(), makeGlobalState() etc.; tests compose what they need | ✓ |
| Global mock instances + beforeEach reset | Single exported mock instances, reset in beforeEach | |
| Agent decides | Agent decides structure when writing the mock | |

**User's choice:** Factory functions per test

---

## What 'unit' means for VS Code modules

### Q1: Primary unit of test

| Option | Description | Selected |
|--------|-------------|----------|
| Full command handler as unit | Test whole handlers with full mock context | |
| Pure helpers extracted and tested | Extract pure sub-functions, test in isolation; matches existing pattern | ✓ |
| Mix: pure units + selected handler tests | Pure helpers strict; selected handlers get integration-style tests | |

**User's choice:** Pure helpers extracted and tested

### Q2: Where should new test files live?

| Option | Description | Selected |
|--------|-------------|----------|
| Co-located in src/ | Peer test file next to source (src/auth.test.ts) | |
| All in test/ mirroring src/ | All tests in test/; matches existing pattern | ✓ |
| Agent decides | Agent decides per plan | |

**User's choice:** All in test/ mirroring src/

---

## Coverage target and test depth

### Q1: How to define 'good enough' coverage?

| Option | Description | Selected |
|--------|-------------|----------|
| Happy path + key error paths (narrative) | No numeric threshold; test tells the story of the module | ✓ |
| Numeric floor enforced in CI | e.g. 70% line coverage via vitest --coverage | |
| Tracked but not enforced | Coverage reported but doesn't fail CI | |

**User's choice:** Happy path + key error paths (narrative)

### Q2: How to handle VS Code-heavy functions?

| Option | Description | Selected |
|--------|-------------|----------|
| Full coverage of claimed modules | Every function tested; refactor if needed | |
| High-value functions; skip UI-heavy ones with note | Skip QuickPick flows etc. with a documented note | ✓ |
| Planner decides scope per plan | Planner defines what to skip | |

**User's choice:** High-value functions; skip UI-heavy ones with note

---

## Code organisation scope

### Q1: Should Phase 11 include code reorganisation?

| Option | Description | Selected |
|--------|-------------|----------|
| Tests only + extraction where testability requires it | Extraction in plan as prerequisite; no architectural refactoring for its own sake | |
| Tests + planned refactoring | Phase explicitly includes planned refactoring | ✓ |
| Pure test addition only | No source changes except what is strictly required to compile | |

**User's choice:** Tests + planned refactoring

### Q2: What is the target code organisation outcome?

| Option | Description | Selected |
|--------|-------------|----------|
| Split extension.ts into runner + commands + activate | Specific split prescribed | |
| Broader module cleanup + dead code removal | Group testEvents, explicit exports, remove dead code | |
| Agent decides per plan as tests reveal gaps | Reorganisation scope determined module-by-module | ✓ |

**User's choice:** Agent decides per plan as tests reveal gaps

---

## Agent's Discretion

- Exact mock surface coverage for each VS Code API — agent decides per plan
- Whether to use vi.spyOn vs factory functions for specific APIs
- Ordering of the 7 plans
- Whether to add vitest --coverage reporting to CI as informational step

## Deferred Ideas

None — discussion stayed within phase scope.
