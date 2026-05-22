# Phase 05: Progress Feedback for Async Operations - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Wrap every user-triggered network/IO action in a consistent `vscode.window.withProgress` UI so the user never wonders "is anything happening?". Scope is bounded to the four mandatory sites called out by ROADMAP §Phase 5 + the UAT-6 download helper that consolidates three of them:

1. **`downloadScriptToTmp`** (`src/scriptCommands.ts:339`) — single helper covers Edit Script, Run Script (Local), and Debug Script (Local). One `withProgress` wrap here covers three user-facing commands.
2. **Publish path** — save bridge in `src/localScriptCache.ts` that intercepts `onDidSaveTextDocument` and calls `remoteFs.writeFile`. Wrapping here (not in `publishScript` handler) ensures Cmd+S saves also get the progress UI, not just explicit "Publish" menu invocations.
3. **`executeRemoteScript` Block A setup** (`src/remoteExecution.ts:88-141`) — workspace lookup + token exchange + parameter resolution that today runs silently before the existing poll-loop `withProgress` mounts. Closes the "frozen UI before kickoff" gap explicitly called out by backlog 999.3 item 2.

Plus one piece of new shared infrastructure:

4. **`src/progress.ts`** — new tiny helper module exporting `withScriptProgress<T>(label, op, opts?)` that enforces location/title/AbortController wiring. All three sites above call it; future async sites adopt it for free.

**Not in this phase (deferred):**
- Tree expansion loading spinners (different UX class — Notification on chevron click is intrusive; needs separate `ProgressLocation.Window` discussion).
- Workspace token exchange progress in `selectWorkspace`.
- `getActiveAccessToken` refresh-token round-trip progress.
- 200ms threshold / delay-show implementation (always-show chosen for v1 consistency with existing sites).
- Telemetry / timing hooks for slow ops.
- Tree expansion error-toast unification (separate concern).

</domain>

<decisions>
## Implementation Decisions

### Coverage scope
- **D-01:** Phase 05 wraps exactly four call sites: (a) `downloadScriptToTmp` in `src/scriptCommands.ts:339` — covers Edit/Run/Debug Local in a single shot; (b) the publish save bridge in `src/localScriptCache.ts` (NOT the `publishScript` command handler — the bridge intercepts Cmd+S too); (c) `executeRemoteScript` Block A setup in `src/remoteExecution.ts:88-141`, before the existing poll-loop `withProgress` at `:187`; (d) `src/progress.ts` shared helper used by all three. Tree expansion, workspace selection token exchange, and env switching are explicitly out of scope.
- **D-02:** The existing `executeRemoteScript` poll-loop `withProgress` at `remoteExecution.ts:187` is NOT modified. Phase 05 only adds a second `withProgress` for Block A setup; the two run sequentially (setup → kickoff → poll loop). Two progress notifications appear back-to-back; that's acceptable because the kickoff mutation between them is a real transition the user should see.

### Cancellation policy
- **D-03:** Cancellable: download (covers Edit/Run/Debug Local) and `executeRemoteScript` Block A setup. Both are pre-action work — aborting them leaves no server-side state behind. NOT cancellable: publish save bridge — mid-mutation cancel leaves the remote in an unknown state (D-02 in Phase 3 already declared last-write-wins, but a half-completed `gloScrUpdateScript` is still worse than a completed one), and Cmd+S has no natural cancel UX anyway.
- **D-04:** Cancel UX is **silent return + cleanup**. On cancel: abort the in-flight fetch via `AbortController.abort()`, return `undefined` from the helper, and for download specifically delete any partially-written tmp file. No "Cancelled" toast — the user clicked the cancel button, they know what happened. Command callers detect cancel via the helper returning `undefined` and exit silently (same pattern as `prepareRun` per CONVENTIONS.md "Early return with `undefined` for user-facing optional flows").

### Helper module
- **D-05:** New module `src/progress.ts` exports a single function:
  ```ts
  export async function withScriptProgress<T>(
      label: string,
      op: (signal: AbortSignal, progress: vscode.Progress<{ message?: string }>) => Promise<T>,
      opts?: { cancellable?: boolean }
  ): Promise<T | undefined>
  ```
  Enforces: `location: ProgressLocation.Notification`, `title: "Altium 365: ${label}..."` (matches existing convention at `extension.ts:198` and `:785`), `cancellable: opts?.cancellable ?? false`, AbortController wired such that `token.onCancellationRequested` calls `controller.abort()`. Returns `undefined` when cancelled (callers `if (!result) return`), the operation's value otherwise. Re-throws non-cancel errors (same as raw `withProgress`).
- **D-06:** The helper does NOT swallow non-cancel errors. Callers retain their existing try/catch + OutputChannel logging + `showErrorMessage` pattern (CONVENTIONS.md error handling). The helper exists purely to enforce the UI convention, not to centralize error handling.
- **D-07:** Existing `withProgress` sites (`extension.ts:194` sign-in, `extension.ts:782` project picker, `remoteExecution.ts:187` poll loop, `sandboxDeps.ts:124` deps install) are **NOT migrated** to the helper in this phase. Migration is a chore for a future cleanup phase; Phase 05 just lands the helper and uses it at the four new sites. Rationale: those sites work fine, and rewriting them risks regressions in signed-out / cancellation paths.

### Location convention
- **D-08:** `ProgressLocation.Notification` for all Phase 05 sites. Matches the existing convention used by sign-in, project picker, remote-execute poll loop, and sandbox deps install. Notification surfaces the cancel button prominently, which matters for the two cancellable ops. The "split for ambient ops" question (Notification vs Window) is moot for Phase 05 because no ambient ops are in scope.

### Threshold / timing
- **D-09:** **Always show, no delay.** VS Code has no built-in delay-show for `withProgress`; implementing one would require a `setTimeout` race + manual disposal if the op resolves first, which adds non-trivial complexity to the helper. Always-show matches every existing `withProgress` site in the codebase (sign-in, project picker, exec poll, deps install — all show instantly). Trade-off acknowledged: a sub-200ms op flashes briefly. Acceptable for v1; revisit only if dogfooding shows real annoyance.

### Helper title conventions
- **D-10:** Title strings passed to `withScriptProgress(label, ...)` for the four sites:
  - Download (action-specific): `"Loading script..."` (Edit), `"Loading script for run..."` (runLocal), `"Loading script for debug..."` (debugLocal). The action label is already passed into `downloadScriptToTmp` as `actionLabel` — reuse it: title becomes `"${actionLabel}: loading..."` (e.g., `"Altium 365: Open Script: loading..."`). Concrete final format settled at planning.
  - Publish save bridge: `"Publishing script..."`.
  - executeRemoteScript Block A: `"Preparing to execute ${scriptName}..."` (keeps it distinct from the poll loop's `"Executing ${scriptName}..."` so the user can tell the two phases apart).

### Out-of-scope clarifications
- **D-11:** No new GraphQL operations, no auth changes, no FSP changes, no new commands, no new package.json contributions. Pure TS surface change in three existing files + one new file.
- **D-12:** No automated tests (consistent with `.planning/codebase/TESTING.md` and Phase 3 D-13). Manual UAT covers: edit happy path shows spinner, edit cancel mid-fetch leaves no tmp file, publish save shows spinner (Cmd+S triggered), executeRemote setup shows spinner before kickoff toast, executeRemote setup cancel aborts before kickoff mutation fires.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & history
- `.planning/ROADMAP.md` §"Phase 5: Progress Feedback for Async Operations" — phase goal, 4 success criteria
- `.planning/ROADMAP.md` §"Phase 999.3: Progress feedback for async operations (BACKLOG)" (now archived in git at commit `11fe956`) — original captured items with code references and open questions

### Codebase intelligence
- `.planning/codebase/CONVENTIONS.md` — error handling (try/catch with `(e as Error)`), `Promise<T | undefined>` for user-cancellable ops, `outputChannel.appendLine` pattern, no module-level state except `outputChannel`
- `.planning/codebase/STRUCTURE.md` — where new modules live (`src/`), no barrel files
- `.planning/codebase/INTEGRATIONS.md` — Python runtime contract (unchanged in this phase)

### Prior-phase decisions still binding
- `.planning/phases/03-remote-script-ops/03-CONTEXT.md` D-09 — single shared `outputChannel`; progress UI must NOT duplicate detail that goes to the OutputChannel
- `.planning/phases/03-remote-script-ops/03-CONTEXT.md` D-10 — existing `executeRemoteScript` poll loop is cancellable; Phase 05 adds a SECOND progress phase for Block A setup, not a replacement
- `.planning/phases/03-remote-script-ops/03-CONTEXT.md` D-02 — last-write-wins for publish; reinforces D-03/D-04 here (publish is non-cancellable because mid-mutation cancel is worse than completed write)
- `.planning/phases/04-ui-polish/04-CONTEXT.md` D-04 — context-only commands removed from `contributes.commands[]`; Phase 05 adds no new commands so no churn here

### Code locations referenced in decisions
- `src/scriptCommands.ts:339-391` — `downloadScriptToTmp` helper (D-01a) — wrap the entire body in `withScriptProgress`
- `src/scriptCommands.ts:172-194` — `editScript` — caller of downloadScriptToTmp; handle `undefined` return from cancel
- `src/scriptCommands.ts:287-298` — `runLocalFromScriptNode` — caller of downloadScriptToTmp
- `src/scriptCommands.ts:307-330` — `debugLocalFromScriptNode` — caller of downloadScriptToTmp
- `src/localScriptCache.ts` — save bridge (D-01b) — wrap the FSP.writeFile call. Researcher should locate the exact bridge handler (registerLocalScriptSaveBridge per UAT-6).
- `src/remoteExecution.ts:88-141` — `executeRemoteScript` Block A setup (D-01c) — wrap workspace lookup + token exchange in `withScriptProgress(..., {cancellable: true})`. Block B (parameters) is fast/synchronous — include in the wrap for simplicity. Blocks D and E stay as-is.
- `src/remoteExecution.ts:187` — existing poll-loop `withProgress` — DO NOT modify (D-02)
- `src/extension.ts:194` — existing sign-in `withProgress` — reference for AbortController + cancellation pattern (D-05)
- `src/extension.ts:782` — existing project-picker `withProgress` — reference for title format (D-10)
- `src/sandboxDeps.ts:124` — existing deps-install `withProgress` — reference
- `src/progress.ts` — NEW file (D-05) — exports `withScriptProgress<T>`

### VS Code API references
- `vscode.window.withProgress` — `ProgressLocation.Notification`, `cancellable: true`, the cancellation token's `onCancellationRequested` event
- `AbortController` (Node built-in via `globalThis`) — wire `controller.abort()` from `token.onCancellationRequested`; pass `controller.signal` to fetch/GraphQL calls. Existing pattern at `extension.ts:192-208`.
- `vscode.CancellationToken` — `token.isCancellationRequested` for cooperative checks between blocks

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **AbortController wiring pattern** (`src/extension.ts:192-208` sign-in): `new AbortController()` → `token.onCancellationRequested(() => controller.abort())` → pass `controller.signal` to the long-running op → `cancelSubscription.dispose()` in `finally`. The new `withScriptProgress` helper should encapsulate this exact pattern.
- **Title format convention** (`src/extension.ts:198, :785`): `"Altium 365: <action>..."` — trailing ellipsis, no period, "Altium 365" prefix. Helper must enforce.
- **`downloadScriptToTmp`** (`src/scriptCommands.ts:339`): single chokepoint for three commands. Wrapping it here gives 3-for-1 coverage and matches the UAT-6 design intent (shared helper).
- **Save bridge** (`src/localScriptCache.ts` `registerLocalScriptSaveBridge`): single chokepoint for both Cmd+S and explicit "Publish" menu — wrapping it ensures both flows get progress UI, not just one.
- **`outputChannel` singleton** (`src/extension.ts`): all diagnostic logging goes here; progress UI is purely visual signal — don't duplicate.

### Established Patterns
- **`Promise<T | undefined>` for cancellable ops** (CONVENTIONS.md): `withScriptProgress` returns `T | undefined` to match. Callers `if (!result) return;`.
- **Try/catch with `(e as Error)`** (CONVENTIONS.md): callers keep their existing error handling; helper re-throws non-cancel errors.
- **No barrel files, named imports** (CONVENTIONS.md): callers import `{ withScriptProgress }` from `'./progress'`.
- **All disposables in `context.subscriptions`** (CONVENTIONS.md): the helper's `cancelSubscription.dispose()` is local to the call — not pushed onto `context.subscriptions`.

### Integration Points
- **`src/scriptCommands.ts`** — three call sites updated to handle the helper's `undefined` return for cancel. `downloadScriptToTmp` body wrapped in helper invocation. Existing tmp-file cleanup logic (currently nonexistent on cancel — `fs.writeFile` finishes or throws) needs a new `finally`/`catch` branch that unlinks partial files when cancel fires after `fs.writeFile` starts.
- **`src/localScriptCache.ts`** — save bridge handler wrapped in helper with `{cancellable: false}`. Errors continue to propagate as `FileSystemError` so VS Code's save-failure indicator still works (Phase 3 D-03 invariant).
- **`src/remoteExecution.ts`** — Block A (lines 88-141) wrapped in helper with `{cancellable: true}`. Block B parameter resolution moves inside the wrap (fast, no reason to split). Block C OutputChannel header runs after the helper resolves successfully — keeps the "Execution started" line ordered AFTER the progress notification disappears.
- **`src/progress.ts`** — new file, ~40 LoC. No dependencies on other extension modules — pure `vscode` import. Easy to test mentally and unit-test later if test infra arrives.

</code_context>

<specifics>
## Specific Ideas

- **Single helper, no overloads.** Resist the urge to add a `withScriptProgressSilent(...)` variant or a `progressIfSlow(...)` threshold variant. One helper, one convention — D-09's always-show is deliberate.
- **Cancel-cleanup unlink is best-effort.** If the tmp-file unlink itself throws (file already gone, permissions weirdness), swallow with `outputChannel.appendLine` — never surface to user.
- **Block A wrap boundary is Blocks A+B together.** Don't try to be clever and split parameter resolution out of the wrap. The visual signal "we're getting ready to execute" subsumes both.
- **Two notifications back-to-back for executeRemote is fine.** "Preparing to execute..." disappears, kickoff mutation fires (sub-second), "Executing..." (poll loop) appears. This is honest UX — the user sees the actual phase transition.
- **Helper title is mandatory, not optional.** No `withScriptProgress(undefined, ...)` overload. Forces every caller to name what's happening.

</specifics>

<deferred>
## Deferred Ideas

- **Tree expansion progress** (listProjects/listScripts on workspace expand) — different UX class; Notification on chevron click is intrusive. Needs a separate `ProgressLocation.Window` decision and likely a different helper (e.g., `withTreeProgress`). Capture as a future polish phase.
- **Workspace token exchange progress** in `selectWorkspace` — already runs after the project picker's `withProgress` resolves; user sees the picker close → brief silent gap → tree refresh. Minor enough to defer.
- **Migration of existing `withProgress` sites** to the new helper (sign-in, project picker, exec poll, deps install) — chore for a future cleanup phase. Phase 05 just lands the helper alongside them.
- **200ms delay-show threshold** — rejected for v1 per D-09. Revisit only if dogfooding shows real annoyance from sub-200ms flicker. Implementation sketch lives in 999.3 capture (setTimeout race).
- **Telemetry / timing hooks** for slow ops — captured idea, no plan to implement until there's a telemetry pipeline at all.
- **Progress UI for the test-events feature** captured in `.planning/todos/pending/2026-05-22-phase-05-candidates.md` (which is actually next-phase scope, not Phase 05) — when that phase lands, its execution paths will reuse `withScriptProgress` automatically.
- **Coordinating progress UI with OutputChannel auto-reveal** — currently `outputChannel.show(true)` and `withProgress` coexist independently; could imagine a future "quiet mode" config that suppresses one or the other. Out of scope.
- **`withScriptProgress` test infrastructure** — no unit tests in this phase (D-12). Helper is small enough to verify by inspection.

### Reviewed Todos (not folded)
- `.planning/todos/pending/2026-05-22-phase-05-candidates.md` (titled "Phase 05 candidates" but actually a candidate for a LATER phase) — script-execution UX polish: workspace-context awareness, save-back after debug, unified params, double-click open, GRID-named tmp, Altium 365 title-bar dropdown, test-events feature. Reviewed during Phase 05 discussion; NOT folded because the roadmap's actual Phase 05 is progress feedback. Todo retained for promotion to a future phase. **Recommend renaming the file** to remove the "phase-05" prefix to avoid confusion (e.g., `2026-05-22-script-execution-ux-polish.md`).

</deferred>

---

*Phase: 05-progress-feedback-async-ops*
*Context gathered: 2026-05-22*
