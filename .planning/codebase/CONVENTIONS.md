# Coding Conventions

**Analysis Date:** 2026-05-19

## Naming Patterns

**Files:**
- `camelCase.ts` for all source modules: `auth.ts`, `workspace.ts`, `extension.ts`
- Output compiled to `out/` directory mirroring `src/` structure

**Functions:**
- `camelCase` for all functions, both exported and internal
- Internal (non-exported) command handlers prefixed with `do`: `doSignIn`, `doSignOut`, `doSelectWorkspace`, `doSelectEnvironment`
- Internal helpers are plain `camelCase` verbs: `prepareRun`, `resolvePythonPath`, `pickProjectId`, `graphqlRequest`

**Variables:**
- `camelCase` throughout; short names for locals (`tok`, `res`, `cfg`, `e`, `ws`)
- Configuration variables consistently named `cfg` when representing VS Code settings or OAuthConfig
- Environment variable names in `SCREAMING_SNAKE_CASE` (e.g., `ALTIUM365_GRAPHQL_ENDPOINT`, `ALTIUM365_TOKEN`)

**Types/Interfaces:**
- `PascalCase` for all interfaces: `OAuthConfig`, `TokenSet`, `WorkspaceInfo`, `ProjectInfo`, `RunPrep`, `EnvironmentSpec`
- Interfaces defined at the top of the file that primarily uses them (`auth.ts` owns `OAuthConfig`, `TokenSet`; `workspace.ts` owns `WorkspaceInfo`, `ProjectInfo`; `extension.ts` owns `RunPrep`, `EnvironmentSpec`)
- No `type` aliases used — all shapes are `interface`

**Constants:**
- Module-level secret key constants in `SCREAMING_SNAKE_CASE` strings: `SECRET_TOKENS`, `SECRET_WORKSPACE_TOKENS` in `src/auth.ts`

## Code Style

**Formatting:**
- No formatter configured (no `.prettierrc`, `.editorconfig`, or `biome.json` detected)
- Observed style: 4-space indentation, single quotes for strings, trailing commas in multi-line arrays/objects
- Template literals used for string interpolation throughout

**Linting:**
- No ESLint or Biome configuration detected
- TypeScript compiler enforces correctness via `strict: true` in `tsconfig.json`

**TypeScript Compiler Settings (`tsconfig.json`):**
- `"strict": true` — all strict checks enabled (no implicit any, strict null checks, etc.)
- `"target": "ES2020"` — modern JS output
- `"module": "commonjs"` — CommonJS modules for VS Code extension host compatibility
- `"lib": ["ES2020"]` — standard library

## Import Organization

**Order (observed pattern):**
1. Node.js built-in modules (`path`, `fs`, `os`, `crypto`, `http`, `url`, `child_process`)
2. External packages (`vscode`)
3. Local modules (relative imports from `./auth`, `./workspace`)

**Style:**
- Namespace imports (`import * as vscode from 'vscode'`) for `vscode` and Node built-ins
- Named imports (`import { fn1, fn2 } from './module'`) for local modules
- No default imports used anywhere

**Example from `src/extension.ts`:**
```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { clearAllTokens, getActiveAccessToken, readOAuthConfig, signIn } from './auth';
import { pickAndExchangeWorkspace, getSelectedWorkspace, listProjects } from './workspace';
```

**Path Aliases:**
- None configured; all local imports are relative (`./auth`, `./workspace`)

## Error Handling

**Pattern: try/catch with cast to `Error`**
All catch blocks cast the unknown error as `Error` to access `.message`:
```typescript
} catch (e) {
    vscode.window.showErrorMessage(`Sign-in failed: ${(e as Error).message}`);
}
```

**Pattern: Silent fall-through for non-critical errors**
When an operation failing should not block the caller, catch silently and continue:
```typescript
} catch {
    // fall through; user will be asked to sign in again
}
```
Used in `getActiveAccessToken` (`src/auth.ts`) and `resolvePythonPath` (`src/extension.ts`).

**Pattern: Early return with `undefined` for user-facing optional flows**
Functions that can be cancelled by the user return `undefined` and callers guard with `if (!result) return`:
```typescript
async function prepareRun(...): Promise<RunPrep | undefined> {
    if (!target) {
        vscode.window.showErrorMessage('No Python script selected.');
        return undefined;
    }
    ...
}
```
Used consistently in `src/extension.ts` command handlers.

**Pattern: Wrap fetch responses with status + body**
HTTP calls always check `res.ok` and throw descriptive errors including the status code and truncated body:
```typescript
if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 500)}`);
}
```
Applied in `postForm` (`src/auth.ts`) and `graphqlRequest` (`src/workspace.ts`).

## Logging

**Framework:** VS Code `OutputChannel` named `'Altium 365'`

**Pattern:**
- All output goes to `outputChannel` (module-level singleton in `src/extension.ts`)
- Log lines prefixed with `[Altium 365]` to namespace in the output panel
- `outputChannel.show(true)` called before a long-running process to reveal the panel

```typescript
outputChannel.appendLine(`[Altium 365] Running ${scriptPath}`);
outputChannel.appendLine(`[Altium 365] Endpoint: ${endpoint}`);
```

**User-facing messages:** `vscode.window.showInformationMessage` / `showWarningMessage` / `showErrorMessage` for user-visible notifications — separate from diagnostic logging.

## Comments

**When to Comment:**
- JSDoc used for exported functions when behavior is non-obvious — sparse but present
- Inline comments for non-obvious intent (e.g., `// Start loopback listener BEFORE opening the browser.`)
- Short `// fall through` or `// user cancelled` comments explain empty catch blocks and early returns

**JSDoc Example (`src/extension.ts`):**
```typescript
/**
 * Prompts the user to pick a projectId. Returns:
 *   - the picked id (string, possibly empty if user chose "no parameters")
 *   - undefined if the user cancelled
 */
async function pickProjectId(...): Promise<string | undefined>
```

**JSDoc Example (`src/auth.ts`):**
```typescript
/** Returns the best available access token for use by scripts. */
export async function getActiveAccessToken(...)
```

## Function Design

**Size:** Functions are kept short and focused. Longer functions (`prepareRun`, `doSelectEnvironment`) are acceptable where they represent a complete workflow step.

**Parameters:** Prefer named parameters via interfaces (`OAuthConfig`, `RunPrep`) over long parameter lists. Functions with ≥4 parameters always use an interface for grouped parameters.

**Return Values:**
- `Promise<T | undefined>` for operations that may be cancelled by the user
- `Promise<T>` for operations that throw on failure
- Synchronous functions are only used for simple data transformation (e.g., `b64url`, `pkcePair`, `isExpired`, `readOAuthConfig`, `getSelectedWorkspace`)

**Async:**
- All functions that perform I/O are `async` and `await`ed — no callback-style or `.then()` chaining in new code
- Exception: `spawn`-based process I/O uses event handlers (`.on('data', ...)`) — the only callback pattern in the codebase

## Module Design

**Exports (`src/auth.ts`):** All public functions and interfaces explicitly exported. Private helpers (`b64url`, `pkcePair`, `postForm`, `withExpiry`, `awaitCallback`, `isExpired`) are module-private (no `export`).

**Exports (`src/workspace.ts`):** Same pattern — public API exported, internal helpers unexported.

**Exports (`src/extension.ts`):** Only `activate` and `deactivate` exported (required by VS Code extension API). All command implementations are unexported module-scope async functions.

**No barrel files:** Each module is imported directly by name; no `index.ts` re-exporter.

## VS Code API Conventions

**Configuration access:** Always via `vscode.workspace.getConfiguration('altium365')` with `.get<T>(key, default)`. Default values are explicit. Never cache configuration objects across async boundaries.

**Secrets storage:** `context.secrets.store` / `context.secrets.get` / `context.secrets.delete` — never plain `globalState` for tokens.

**Global state:** `context.globalState` used only for non-sensitive workspace selection (`altium365.selectedWorkspace`) and last-used project IDs (`altium365.lastProjectId.*`).

**Subscriptions:** All disposables registered via `context.subscriptions.push(...)` in `activate`.

---

*Convention analysis: 2026-05-19*
