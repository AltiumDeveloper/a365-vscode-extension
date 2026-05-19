# Testing Patterns

**Analysis Date:** 2026-05-19

## Test Framework

**Runner:** None configured.

No testing framework is present in the project:
- No `jest`, `mocha`, `vitest`, `@vscode/test-electron`, or any other test runner in `package.json` (neither `dependencies` nor `devDependencies`)
- No test configuration files (`jest.config.*`, `vitest.config.*`, `.mocharc.*`)
- No test scripts in `package.json` `"scripts"` section
- No test files (`*.test.ts`, `*.spec.ts`) anywhere in the repository

**Run Commands:**
```bash
npm run compile    # Only available script — compiles TypeScript to out/
npm run watch      # Watch mode compilation
```

No test run command exists.

## Test File Organization

**Location:** Not applicable — no test files exist.

**Naming:** No convention established.

**Structure:** No convention established.

## Test Types

**Unit Tests:** Not implemented.

**Integration Tests:** Not implemented.

**E2E Tests:** Not implemented.

## Coverage

**Requirements:** None enforced.

**Coverage tool:** Not configured.

## What Should Be Tested (Guidance for Adding Tests)

Given the codebase structure, the following areas have the highest value for future test coverage:

**`src/auth.ts` — High Priority**
- `pkcePair()`: Verify verifier/challenge are URL-safe base64, challenge is SHA-256 of verifier
- `withExpiry()`: Verify `expires_at` computed correctly from `expires_in`, and not overwritten if already set
- `isExpired()`: Verify expired/not-expired/no-expiry cases
- `readOAuthConfig()`: Verify defaults applied when VS Code config values are absent
- `postForm()`: Verify correct headers, body encoding, error on non-OK status, error on non-JSON response
- `getActiveAccessToken()`: Verify workspace token takes priority, base token refresh on expiry, undefined when no tokens

**`src/workspace.ts` — Medium Priority**
- `graphqlRequest()`: Verify Authorization header, error on HTTP failure, error on GraphQL `errors` array
- `listWorkspaces()`: Verify correct GraphQL query sent, empty array on missing data
- `listProjects()`: Verify correct GraphQL query sent, empty array on non-array nodes
- `getSelectedWorkspace()`: Verify returns undefined when no workspace stored

**`src/extension.ts` — Low Priority (VS Code API mocking burden is high)**
- `resolvePythonPath()`: Verify configured path returned first, Python extension API queried as fallback, platform default as last resort
- `prepareRun()`: Verify early returns on missing script, missing endpoint, missing token

## Recommended Test Setup

The standard approach for VS Code extensions is `@vscode/test-cli` + `@vscode/test-electron` (replacement for the deprecated `vscode-test`). For unit-testing logic independent of the VS Code host, `vitest` or `jest` with a manual `vscode` mock is a lighter alternative.

**Suggested `devDependencies` additions:**
```json
"@vscode/test-cli": "^0.0.x",
"@vscode/test-electron": "^2.x",
"@types/mocha": "^10.x"
```
Or for pure unit tests with mocked vscode:
```json
"vitest": "^1.x",
"@vitest/coverage-v8": "^1.x"
```

**Suggested test file locations:**
- `src/test/auth.test.ts` — unit tests for `src/auth.ts`
- `src/test/workspace.test.ts` — unit tests for `src/workspace.ts`
- `src/test/extension.test.ts` — integration tests via VS Code test host

**Suggested test script additions to `package.json`:**
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

## Mocking Requirements

The following external dependencies require mocking in unit tests:

**`vscode` module:**
- `vscode.workspace.getConfiguration` — return stub config objects
- `vscode.window.showErrorMessage` / `showInformationMessage` / `showWarningMessage` — spy/stub
- `vscode.env.openExternal` — stub (no browser should open in tests)
- `context.secrets.store` / `get` / `delete` — in-memory mock
- `context.globalState.get` / `update` — in-memory mock

**`fetch` (global):**
- Mock for `postForm` and `graphqlRequest` — return controlled JSON responses and error status codes

**`http` module:**
- Mock for `awaitCallback` — simulate successful OAuth redirect callback with code/state

**`crypto` module:**
- Optionally stub `randomBytes` for deterministic PKCE pair generation in tests

---

*Testing analysis: 2026-05-19*
