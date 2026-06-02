# Code Review — Altium 365 VS Code Extension

**Date:** 2026-06-02
**Scope:** All TypeScript source in `src/` (~7,632 LOC across 35 files)
**Reviewer:** gsd-code-reviewer
**Verdict:** Generally well-structured. 2 CRITICAL, 9 HIGH, 11 MEDIUM, 8 LOW findings.

---

## Summary

The codebase is well-structured with thoughtful documentation, explicit decision references (D-XX), and good separation of concerns. The OAuth/PKCE implementation, GraphQL layer, and FSP patterns are sound. Issues cluster around:

- **Resource lifecycle** (subprocesses, tmp files, EventEmitters not disposed)
- **One wrong command-argument shape** (FSP delete dispatching wrong args)
- **Robustness gaps** (unprotected JSON.parse on tokens, partial-failure handling, no poll backoff)
- **String-typed contracts** between modules (cancellation detection via message equality)

Counts: **CRITICAL: 2 · HIGH: 9 · MEDIUM: 11 · LOW: 8**

---

## CRITICAL

### CR-01 — `TestEventFs.delete` passes wrong argument shape to delete command

**File:** `src/testEvents/eventFs.ts:175`

When VS Code (or any caller) invokes FSP `delete()` on an `altium365-event://` URI, the handler dispatches:
```ts
await vscode.commands.executeCommand('altium365.testEvents.delete', uri);
```
But the command handler signature is `(identity?: ScriptIdentity, name?: string)` (`src/testEvents/commands.ts:97`). A `vscode.Uri` is not a `ScriptIdentity` — `resolveIdentityOrWarn` rejects it and falls back to the active editor's identity (potentially a completely unrelated script). The intended event name is never passed.

**Impact:** Silent wrong-target deletion attempt, or "no active script" warning when the user expects deletion of the URI they clicked.

**Fix:** Parse the URI and pass correct args:
```ts
const parsed = parseEventUri(uri);
if (!parsed) throw vscode.FileSystemError.FileNotFound(uri);
const identity = identityFromString(parsed.identity);
await vscode.commands.executeCommand('altium365.testEvents.delete', identity, parsed.eventName);
```

### CR-02 — Subprocesses are never tracked or killed on deactivation

**File:** `src/runner/index.ts` (entire module — `runScriptAtPath`, `debugScriptAtPath`)

Python subprocesses spawned via `spawn(python, ['-u', runnerPath, ...])` are not stored anywhere reachable from `deactivate()`. When the VS Code window closes or the extension is disabled mid-execution:
- Long-running scripts become orphaned processes consuming CPU/memory/network
- Tmp param files (see HI-02) remain on disk with potentially sensitive data
- Extension host cannot return cleanly, delaying VS Code shutdown

**Fix:** Module-level `Set<ChildProcess>` of live subprocesses + disposable in `context.subscriptions`:
```ts
const liveProcs = new Set<ChildProcess>();
liveProcs.add(proc);
proc.on('exit', () => liveProcs.delete(proc));
context.subscriptions.push({ dispose: () => liveProcs.forEach(p => p.kill('SIGTERM')) });
```

---

## HIGH

### HI-01 — `getStoredTokens` does unprotected `JSON.parse`

**File:** `src/auth/index.ts`

A corrupt secret payload throws synchronously, propagating into `isSignedIn` checks, status bar, and context keys — leaving the extension undefined until the user manually clears secrets.

**Fix:** Wrap in try/catch; on failure, delete the corrupt secret and log.

### HI-02 — Tmp param files leak sensitive data to `os.tmpdir()`

**File:** `src/runner/index.ts`

Each execution writes a JSON file containing `input_parameters` (projectId, workspace context, user-supplied values potentially including credentials/PII) into `os.tmpdir()`. Never deleted — neither on subprocess exit, error, nor deactivation.

**Fix:** Delete in `proc.on('exit', ...)` (also error path). Consider scoped session temp dir + `rm -rf` on dispose.

### HI-03 — EventEmitters not pushed into `context.subscriptions`

**Files:** `src/scripts/remoteFs.ts`, `src/testEvents/eventFs.ts`, `src/ux/panel.ts`

Created in constructors but never disposed. Violates project's documented "all disposables go into ctx.subscriptions" pattern.

**Fix:** Expose `dispose()` method or push emitters into `context.subscriptions` at registration.

### HI-04 — `pickTestEvent` leaks `onDidAccept` / `onDidHide` subscriptions

**File:** `src/testEvents/picker.ts`

`qp.onDidAccept(...)` and `qp.onDidHide(...)` return `Disposable` handles not captured/disposed. Each picker invocation accumulates listener references.

**Fix:**
```ts
const acc = qp.onDidAccept(...); const hide = qp.onDidHide(...);
try { ... } finally { acc.dispose(); hide.dispose(); qp.dispose(); }
```

### HI-05 — `realpathSync` synchronous I/O on hot editor-change path

**File:** `src/scripts/localCache.ts`

`normalizeLocalScriptKey` runs on every `onDidChangeActiveTextEditor` and performs sync filesystem stat. Switching tabs rapidly introduces UI thread latency.

**Fix:** Use `fs.promises.realpath` (async); cache resolved keys per session.

### HI-06 — Race between `selectWorkspace` dispatch and globalState re-read

**File:** `src/testEvents/commands.ts` (`pickProjectIdSafe` fallback)

```ts
await vscode.commands.executeCommand('altium365.selectWorkspace');
const ws = getSelectedWorkspace(context); // may still be undefined on user cancel
```

**Fix:** Have `altium365.selectWorkspace` return the selected `WorkspaceInfo | undefined`; use return value directly.

### HI-07 — `Promise.all` in tree expansion fails entire branch on single subquery error

**File:** `src/ux/panel.ts` (`loadWorkspaceChildren`)

If any one of projects/scripts/extension-points fails, entire workspace node renders as error, hiding the others. Bad UX during partial backend outages.

**Fix:** `Promise.allSettled` with per-category error placeholders.

### HI-08 — `doSignIn` couples error producer/consumer via string matching

**File:** `src/ux/commands.ts`

`if (msg === 'Sign-in cancelled.')` — any rewording silently breaks the cancellation path, surfacing cancellations as scary error toasts.

**Fix:** Throw typed `SignInCancelledError` from auth module; consumer uses `instanceof`.

### HI-09 — `executeRemoteScript` poll loop has no backoff

**File:** `src/scripts/execution.ts`

5xx/transient errors → loop continues every 1.5s for full 10 minutes, hammering server. No circuit breaker.

**Fix:** Track consecutive failures; exponential backoff (1.5s → 3s → 6s, cap 30s); abort with clear error after N consecutive failures.

---

## MEDIUM

| ID | File | Issue |
|----|------|-------|
| ME-01 | `scripts/remoteFs.ts`, `testEvents/identity.ts` | Duplicated `UUID_REGEX` / `GRID_PATH_REGEX` — extract to `src/shared/identity.ts` |
| ME-02 | `scripts/localCache.ts` | Unnecessary `await import('../workspace')` — use static import |
| ME-03 | `extension.ts` | Fire-and-forget `setContext` calls in `updateActiveRemoteContext` — race on tab switch |
| ME-04 | `workspace/execution.ts:202` | Hardcoded `status: 'Pending'` — document allowlist or return null |
| ME-05 | `workspace/workspaces.ts` | `pickWorkspace` retains unused `cfg` parameter |
| ME-06 | `scripts/commands.ts` | `(node as any)` casts in `extractScriptContext` — add type guard |
| ME-07 | `ux/panel.ts` | `(node as any).assignmentId` — add typed accessor on `A365Node` union |
| ME-08 | `runner/pythonAnalysis.ts:134` | Module-level `reconcileLock` mutable promise chain — use `AsyncMutex` |
| ME-09 | `ux/projectPicker.ts` | `pickProjectId` empty array indistinguishable from failure — add disabled separator |
| ME-10 | `workspace/execution.ts:144` | `getExecutionLogs` swallows malformed responses silently — log to outputChannel |
| ME-11 | `runner/pythonAnalysis.ts:62` | "Pure" function uses `vscode.Uri.file` via `normalizePath` — inject normalizer |

---

## LOW

| ID | File | Issue |
|----|------|-------|
| LO-01 | `ux/panel.ts:~284` | `paramsSummary = 'none'` placeholder TODO |
| LO-02 | ~15 files | `'[Altium 365] '` log prefix repeated — centralize as `LOG_PREFIX` |
| LO-03 | `ux/panel.ts` + `package.json` | Context-value strings duplicated — share constants |
| LO-04 | `workspace/extensionPoints.ts:84` | `(a: any)` in mapper — add internal `RawAssignment` type |
| LO-05 | `auth/index.ts` | `decodeIdTokenClaims` doesn't verify JWT — add `// NOTE:` warning |
| LO-06 | `testEvents/eventFs.ts` | `rename(newUri)` ignored — prefix `_newUri` |
| LO-07 | `runner/progress.ts` | Cooperative cancellation silent — log to output channel |
| LO-08 | `ux/statusBar.ts:47` | Silent fallback to `'(signed in)'` — log when used |

---

## Recommended Fix Order

1. **CR-01** — wrong command args, user-visible data risk
2. **CR-02 + HI-02** — process and tmp-file lifecycle (one coordinated fix)
3. **HI-01** — auth resilience
4. **HI-04 + HI-03** — disposable hygiene
5. **HI-06 + HI-08** — concurrency / typed errors
6. **HI-07 + HI-09** — partial-failure UX
7. **HI-05** — perf-correctness
8. MEDIUM batch — code quality sweep
9. LOW batch — opportunistic

---

## Out-of-Scope Observations

- **Test coverage:** 130 unit tests passing. **Add regression tests for CR-01 and HI-01** — both are easy to fixture.
- **Performance:** HI-05, ME-09, ME-10 have user-visible correctness implications.
