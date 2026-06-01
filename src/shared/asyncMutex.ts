/**
 * AsyncMutex — per-key async serialization helper.
 *
 * Calls to `runExclusive(key, fn)` with the SAME key are queued in FIFO order:
 * the next `fn` starts only after the previous one settles (resolve OR reject).
 * Calls with DIFFERENT keys run independently in parallel.
 *
 * Used by `src/auth.ts` (per D-07 / D-08) to:
 *   1. Serialize read-modify-write of `GLOBAL_WS_TOKEN_INDEX_KEY`.
 *   2. Deduplicate concurrent `exchangeWorkspaceToken` calls for the same
 *      workspaceId, so a cold-start expansion across N workspaces performs
 *      exactly N exchanges, not N×concurrent-callers exchanges.
 *
 * CONVENTIONS exception: this module holds an internal `locks` Map as
 * module-class state. This is allowed because the file is a single-purpose
 * helper analogous to the `outputChannel` / `authStateEmitter` exceptions
 * documented in `.planning/codebase/CONVENTIONS.md`. Workspace count is
 * bounded, so we intentionally do not garbage-collect drained keys.
 */
export class AsyncMutex {
  private locks = new Map<string, Promise<unknown>>();

  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(() => fn(), () => fn());
    // Tail must never reject — otherwise the next waiter's `.then` would short-circuit.
    this.locks.set(key, run.catch(() => undefined));
    return run;
  }
}
