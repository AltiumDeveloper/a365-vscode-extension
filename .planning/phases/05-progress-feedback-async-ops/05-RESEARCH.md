# Phase 5: Progress Feedback for Async Operations — Research

**Researched:** 2026-05-22
**Domain:** VS Code `withProgress` UX wrapping for network/IO calls
**Confidence:** HIGH

## Summary

CONTEXT.md is exhaustive and the decisions are sound. This research's job is purely to **validate code-level facts** so the planner can produce mechanical task lists. All four CONTEXT line-number references **verified against live source**. Two findings warrant attention before planning:

1. **Critical landmine — AbortSignal is not plumbed through the network layer.** Neither `graphqlRequest` (workspace.ts:114) nor the Files Service `fetch` calls (filesService.ts:87, :147) nor `ensureWorkspaceToken` (auth.ts:425) accept an `AbortSignal`. `vscode.workspace.fs.readFile` (used by `downloadScriptToTmp`) likewise has no signal parameter — it's the VS Code FS contract. **Consequence:** D-04's "abort the in-flight fetch via `AbortController.abort()`" is **not literally achievable** in v1 without first threading `signal` through 4–6 functions. Planner must choose between (a) cooperative cancel only (helper returns `undefined` immediately, background op completes silently + tmp-file cleanup), or (b) one extra task to thread `AbortSignal` through `graphqlRequest` + filesService helpers. Recommend (a) for scope discipline — see "Implementation Landmines" below.

2. **Good news — all three `downloadScriptToTmp` callers already handle `undefined` return.** `editScript` (scriptCommands.ts:182), `runLocalFromScriptNode` (:294), `debugLocalFromScriptNode` (:313) each have `if (!tmpPath) return;`. No caller-side edits needed for the cancel path — only the helper-internal change matters.

**Primary recommendation:** Build `withScriptProgress<T>` per D-05 spec exactly as written. Accept that for v1, `signal` exposed to callers is **cooperative** (callers may check `signal.aborted` between awaits to short-circuit), not propagated to fetch. Document this clearly in the helper's JSDoc. Add a single `finally`-branch unlink in `downloadScriptToTmp` for cancel-after-writeFile cleanup (D-04). All four sites + helper land in ~80 LoC total.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Progress UI orchestration | Extension host (UI) | — | `vscode.window.withProgress` is host-side only |
| Cancellation token plumbing | Extension host | — | `CancellationToken` is host-side; cooperative |
| Network abort | Network layer (workspace.ts/auth.ts/filesService.ts) | — | **Not implemented today; out of v1 scope** |
| Tmp-file cleanup on cancel | Caller (`downloadScriptToTmp`) | — | Only the caller knows the tmp path it wrote |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Four wrap sites only — `downloadScriptToTmp`, save bridge in `localScriptCache.ts`, `executeRemoteScript` Block A (+B), `src/progress.ts` helper. Nothing else.
- **D-02:** Existing poll-loop `withProgress` at `remoteExecution.ts:187` is NOT modified. Two notifications back-to-back is acceptable.
- **D-03:** Cancellable = download + Block A. Non-cancellable = publish save bridge.
- **D-04:** Cancel UX = silent return + cleanup (no "Cancelled" toast). Helper returns `undefined`; download specifically unlinks any partial tmp file.
- **D-05:** Helper signature is fixed:
  ```ts
  export async function withScriptProgress<T>(
      label: string,
      op: (signal: AbortSignal, progress: vscode.Progress<{ message?: string }>) => Promise<T>,
      opts?: { cancellable?: boolean }
  ): Promise<T | undefined>
  ```
  Enforces `ProgressLocation.Notification`, title `"Altium 365: ${label}..."`, `cancellable: opts?.cancellable ?? false`.
- **D-06:** Helper does NOT swallow non-cancel errors. Callers keep their try/catch + OutputChannel + showErrorMessage.
- **D-07:** Existing `withProgress` sites NOT migrated. Phase 5 lands the helper alongside them.
- **D-08:** `ProgressLocation.Notification` for all four sites.
- **D-09:** Always-show, no delay/threshold.
- **D-10:** Titles — download: `"${actionLabel}: loading..."` (final form settled at planning); publish: `"Publishing script..."`; Block A: `"Preparing to execute ${scriptName}..."`.
- **D-11:** No new GraphQL, no auth changes, no FSP changes, no new commands, no `package.json` contributions.
- **D-12:** No automated tests.

### Claude's Discretion
- Final wording of the download title (per D-10: format settled at planning).
- Exact placement of cooperative `signal.aborted` checks inside `downloadScriptToTmp` body.
- Whether to publish-bridge `output.appendLine` a "save in progress" diagnostic line (style preference).

### Deferred Ideas (OUT OF SCOPE)
- Tree expansion spinners, workspace token exchange progress, `getActiveAccessToken` refresh progress.
- 200ms delay-show, telemetry/timing hooks.
- Migration of existing `withProgress` sites.
- Threading `AbortSignal` through `graphqlRequest` / filesService / `ensureWorkspaceToken` (**see Implementation Landmines — this affects what "cancel" actually does**).
- Unit tests for the helper.
- Renaming `2026-05-22-phase-05-candidates.md` todo file.

## Phase Requirements

This phase has no formal REQ-IDs in REQUIREMENTS.md; derive from ROADMAP §Phase 5 Success Criteria:

| ID (derived) | Description | Research Support |
|---|---|---|
| SC-1 | `altium365.script.edit` wraps openDoc/setLang/showDoc sequence in `withProgress` | Wrapping `downloadScriptToTmp` covers the GraphQL fetch — the openDoc trio in `editScript:186-188` is post-download and stays as-is per D-01 scope (the heavy network is the FSP `readFile` inside the helper). |
| SC-2 | `script.publish` and `remoteExecution.ts` Block A show progress before network | Save-bridge wrap (localScriptCache.ts:79) covers Cmd+S and explicit Publish (both flow through `doc.save()`). Block A wrap covers workspace lookup + token exchange. |
| SC-3 | Single `ProgressLocation` convention applied | D-08: `Notification` everywhere. |
| SC-4 | Cancel for Edit aborts in-flight GraphQL | **Partially satisfiable in v1** — see Landmines. Cooperative cancel works (helper returns `undefined`, no editor opens, no tmp file kept); the GraphQL request itself runs to completion in the background until the network layer accepts `AbortSignal`. |

## Verified Code Locations (vs. CONTEXT.md)

All line numbers in CONTEXT.md were checked against live source on 2026-05-22:

| CONTEXT.md reference | Verified | Notes |
|---|---|---|
| `src/scriptCommands.ts:339` `downloadScriptToTmp` | ✓ | Body spans lines 339-391. `fs.writeFile(tmpPath, bytes)` at **line 363** — this is the tmp-write site for D-04 cleanup. |
| `src/scriptCommands.ts:172-194` `editScript` | ✓ | Caller already handles `undefined`: `if (!tmpPath) return;` at line 182. No change needed for cancel path. |
| `src/scriptCommands.ts:287-298` `runLocalFromScriptNode` | ≈ | Actual range 288-298. `if (!tmpPath) return;` at line 294. |
| `src/scriptCommands.ts:307-330` `debugLocalFromScriptNode` | ✓ | `if (!tmpPath) return;` at line 313. |
| `src/localScriptCache.ts` `registerLocalScriptSaveBridge` | ✓ | **Defined at line 79**, signature `(output: OutputChannel, remoteFs: AltiumRemoteScriptFs): vscode.Disposable`. The network-write call is `await remoteFs.writeFile(remoteUri, bytes, {create:true, overwrite:true})` at **line 98**. Inside an `onDidSaveTextDocument` async listener (fire-and-forget). |
| `src/remoteExecution.ts:88-141` Block A | ✓ | Block A = lines 88-141 exactly. Block B (parameter resolution) is line 144 (single sync call `resolveScriptParameters`). Block C OutputChannel header starts line 147. Block D kickoff mutation lines 154-184. Block E poll loop wrap at line 187. |
| `src/remoteExecution.ts:187` poll-loop `withProgress` | ✓ | NOT to be modified per D-02. |
| `src/extension.ts:194` sign-in `withProgress` | ✓ | Lines 192-208 are the canonical AbortController pattern (see "Code Examples" below). |
| `src/extension.ts:782` project picker `withProgress` | ✓ | Line 782; title format at line 785: ``Loading projects from "${wsName}"...`` — **note: no "Altium 365:" prefix here**. D-10's title convention is enforced by the new helper, but this existing site is not prefixed. (Sign-in IS prefixed at :198.) The helper hard-codes the prefix; non-issue. |
| `src/sandboxDeps.ts:124` deps-install `withProgress` | ✓ | Title `'Altium 365: installing Python dependencies'` (no trailing ellipsis here — inconsistent with sign-in). Reference only; helper will impose its own format. |

**No drift found.** CONTEXT.md is accurate.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `vscode` (Extension API) | ≥1.85.0 (per `package.json` engines) | `window.withProgress`, `ProgressLocation.Notification`, `CancellationToken` | Native — only progress UI available to extensions. [VERIFIED: project package.json + existing 4 usages] |
| `AbortController` (Node built-in via `globalThis`) | Node ≥18 | Cooperative cancel signal | Already used in `extension.ts:192-208` and `auth.ts:241,327`. [VERIFIED: live grep] |

No new dependencies. Phase 5 is pure-TS, zero `npm install`.

## Package Legitimacy Audit

**N/A** — no packages installed in this phase.

## Architecture Patterns

### System Diagram

```
User action (Edit/Run/Debug/Publish/ExecuteRemote)
        │
        ▼
Command handler (scriptCommands.ts / save-bridge listener / remoteExecution.ts)
        │
        ▼
withScriptProgress(label, op, {cancellable?}) ─── shows Notification
        │                                          ↑
        │                                          │ token.onCancellationRequested
        ▼                                          │       → controller.abort()
op(signal, progress)                               │
        │                                          │
        ├─ vscode.workspace.fs.readFile (FSP) ─────┤  ⚠ signal NOT propagated to fetch
        ├─ remoteFs.writeFile / graphqlRequest ────┤  ⚠ same — runs to completion
        └─ cooperative `if (signal.aborted) ...` ──┘
        │
        ▼
returns T | undefined  (undefined = cancelled OR explicit error-return)
```

### File Layout (additive)
```
src/
├── progress.ts          # NEW — ~40 LoC, exports withScriptProgress
├── scriptCommands.ts    # MODIFIED — wrap downloadScriptToTmp body + cleanup unlink
├── localScriptCache.ts  # MODIFIED — wrap remoteFs.writeFile call inside listener
└── remoteExecution.ts   # MODIFIED — wrap Block A+B
```

### Helper Implementation Sketch (for planner reference, not prescriptive)

```ts
// src/progress.ts
import * as vscode from 'vscode';

export async function withScriptProgress<T>(
    label: string,
    op: (signal: AbortSignal, progress: vscode.Progress<{ message?: string }>) => Promise<T>,
    opts?: { cancellable?: boolean }
): Promise<T | undefined> {
    const cancellable = opts?.cancellable ?? false;
    const controller = new AbortController();
    return vscode.window.withProgress<T | undefined>(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Altium 365: ${label}`,
            cancellable,
        },
        async (progress, token) => {
            const sub = cancellable
                ? token.onCancellationRequested(() => controller.abort())
                : undefined;
            try {
                const result = await op(controller.signal, progress);
                if (controller.signal.aborted) return undefined;
                return result;
            } catch (e) {
                if (controller.signal.aborted) return undefined;
                throw e;  // D-06: re-throw non-cancel errors
            } finally {
                sub?.dispose();
            }
        }
    );
}
```

**Note on title:** D-10 says title is `"Altium 365: ${label}..."` (trailing ellipsis). Decide at planning whether the helper appends `...` or whether callers include it in `label`. Recommend **callers include trailing punctuation** so `"Loading script..."` and `"Publishing script..."` both read naturally and avoid double-ellipsis if a caller accidentally adds one.

### Caller wrap patterns (mechanical for planner)

**`downloadScriptToTmp` (scriptCommands.ts:339-391)** — wrap body lines 352-390 inside `withScriptProgress("...", async (signal) => { ... })`. The `sc` resolution at lines 345-351 stays OUTSIDE the wrap (cheap, sync-ish, shows its own error message). The tmp-file cleanup goes in a `try/finally` inside the op:

```ts
let tmpPath: string | undefined;
try {
    // existing body 352-374, capturing tmpPath
    return tmpPath;
} finally {
    if (signal.aborted && tmpPath) {
        try { await fs.unlink(tmpPath); } catch (e) {
            output.appendLine(`[Altium 365] cancel cleanup: unlink failed: ${(e as Error).message}`);
        }
    }
}
```
Per specifics §"Cancel-cleanup unlink is best-effort": never surface unlink failures to user.

**Save bridge (localScriptCache.ts:79-118)** — wrap the `try { ... bytes/writeFile/log/statusBar ... } catch { ... }` body at lines 96-117 in `withScriptProgress("Publishing script...", async () => { ... }, { cancellable: false })`. Errors are still caught by the existing `catch` (D-06 — helper re-throws); the status-bar success message and "Publish failed" toast keep their current behavior. Save bridge runs inside an `onDidSaveTextDocument` async callback — wrapping is safe (VS Code awaits the listener; multiple saves serialize at the doc level).

**`executeRemoteScript` Block A+B (remoteExecution.ts:88-144)** — wrap lines 89-144 in `withScriptProgress("Preparing to execute ${scriptName}...", async (signal) => { ... return {ws, wsToken, apiUrl, parameters}; }, { cancellable: true })`. After wrap resolves, check `if (!result) return;` (cancel), then proceed with Block C onwards using the destructured result. The existing `vscode.window.showErrorMessage` calls inside Block A's catch arms (lines 99-101, 111-114, 118-122, 136-138) stay — they fire BEFORE the helper sees the throw, then helper re-throws, then caller... wait — actually those return-early-with-toast paths inside the wrap will return `undefined` from the op without throwing. Helper returns `undefined`. Caller checks and returns. Works cleanly. The existing `return;` statements inside Block A become `return undefined;` from inside the op closure.

### Anti-Patterns to Avoid
- **Wrapping `editScript`'s openDoc/setLang/showDoc trio in a SECOND progress.** D-01 says the wrap is on `downloadScriptToTmp`. The editor-open sequence is fast and synchronous-ish; don't add a second notification.
- **Wrapping the `publishScript` command handler instead of the save bridge.** D-01b is explicit: wrap the bridge so Cmd+S gets coverage too.
- **Adding a `withScriptProgressSilent` overload or delay-show variant.** Forbidden by D-09 + specifics §"Single helper, no overloads".
- **Pushing the helper's `cancelSubscription` onto `context.subscriptions`.** It's call-scoped; dispose in `finally`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Progress notification UI | Custom status bar widget | `vscode.window.withProgress` + `ProgressLocation.Notification` | Native; consistent with the 4 existing sites; cancel button comes free. |
| Cancellation token wiring | Manual flag polling | `CancellationToken.onCancellationRequested` + `AbortController` | Already proven at `extension.ts:192-208`. |
| Delay-before-show | `setTimeout` race against op | Nothing — always-show | D-09 rejected delay-show. Forbidden. |

## Common Pitfalls

### Pitfall 1: Assuming `signal.abort()` cancels the network request
**What goes wrong:** Helper calls `controller.abort()` on cancel. Developer assumes the in-flight GraphQL `fetch` aborts. It does not — `graphqlRequest` doesn't accept a signal.
**Why it happens:** `AbortController` is part of the Node fetch API contract, but the project's network helpers never accepted `signal` arguments.
**How to avoid:** Document in `withScriptProgress` JSDoc that `signal` is **cooperative for v1** — callers must check `signal.aborted` between awaits if they want to short-circuit. The notification will disappear on cancel either way (helper returns `undefined`).
**Warning signs:** Cancel button appears to work (notification vanishes), but server-side logs show the request completed and a tmp file appears on disk after the user "cancelled".

### Pitfall 2: Cancel-cleanup unlink fires before writeFile completed
**What goes wrong:** User cancels DURING `vscode.workspace.fs.readFile` (before line 363). `tmpPath` is undefined. Unlink crashes.
**How to avoid:** Guard `if (signal.aborted && tmpPath)`. Only unlink if the path was actually computed. See sketch above.

### Pitfall 3: Double notification when Block A succeeds
**What goes wrong:** Block A wrap notification dismisses, kickoff fires, poll-loop notification appears. User sees flash → toast → flash. Looks like two errors.
**Why it happens:** Two `withProgress` sites in sequence (D-02 acknowledges this).
**How to avoid:** Title disambiguation per D-10: `"Preparing to execute ..."` vs `"Executing ..."`. Verify visually during UAT-3.

### Pitfall 4: Save-bridge wrap swallows the FileSystemError that VS Code expects
**What goes wrong:** Helper catches → re-throws → listener's `catch (e)` handles it → VS Code never sees a `FileSystemError`, so the editor doesn't show a save-failure indicator.
**Why it happens:** The current `catch` block at localScriptCache.ts:109-117 converts errors to `showErrorMessage` and **does not re-throw**. Phase 3 D-03 invariant says errors should propagate as `FileSystemError`.
**How to avoid:** Verify the current behavior — at line 109 the catch swallows. **CONTEXT.md §code_context says errors "continue to propagate as `FileSystemError`" but live code suggests they're caught and converted to a toast.** Planner should reconcile this with reviewer/user before wrapping. If wrap keeps the existing catch position (inside the op), behavior is unchanged. Recommended: keep helper around the whole try/catch.

### Pitfall 5: `withProgress` callback returning `Promise<T | undefined>` typing
**What goes wrong:** TS strict mode complains because `withProgress<R>` infers `R` from the callback. Returning `undefined` from one branch and `T` from another widens to `T | undefined`, which matches the helper return type — but the inner check `if (controller.signal.aborted) return undefined` requires `R = T | undefined` not `R = T`. Use explicit type parameter: `vscode.window.withProgress<T | undefined>({...}, ...)`.
**Why it happens:** TS infers narrowest type; explicit annotation prevents `withProgress<T>` inference.
**How to avoid:** Annotate as shown in the sketch above.

## Implementation Landmines

### Landmine 1 (severity: HIGH): `AbortSignal` is not plumbed through the network layer

**Confirmed by code inspection:**

| Function | File:Line | Accepts `signal`? |
|---|---|---|
| `graphqlRequest` | workspace.ts:114 | ✗ |
| `listWorkspaces` | workspace.ts:164 | ✗ |
| `getScript` | (called via FSP `readFile`) | ✗ |
| `executeScript` | workspace.ts:446 | ✗ |
| `updateScript` | (called via FSP `writeFile`) | ✗ |
| `downloadByToken` (filesService) | filesService.ts:87 | ✗ |
| `uploadAndGetToken` (filesService) | filesService.ts:147 | ✗ |
| `ensureWorkspaceToken` | auth.ts:425 | ✗ |
| `getBaseAccessToken` | auth.ts | ✗ |
| `vscode.workspace.fs.readFile` | VS Code FS API contract | ✗ (no signal param in FSP) |
| `signIn` / `postForm` / `awaitCallback` | auth.ts:241, :327, etc. | ✓ (only sign-in flow) |

**Impact on each cancellable site:**
- **Download cancel:** Helper returns `undefined`, no editor opens, no `runScriptAtPath`/`debugScriptAtPath` runs. BUT: the FSP `readFile` continues in background; if it completes after cancel, the body writes the tmp file before the helper's finally runs — the cleanup unlink fires correctly. So functionally the user sees the cancel work. Trade-off: bandwidth wasted on a download the user no longer wants.
- **Block A cancel:** Helper returns `undefined`, kickoff mutation does NOT fire (D-02 invariant preserved). But `listWorkspaces` / `ensureWorkspaceToken` continue silently. No user-visible bad effect; tokens cached.

**Recommendation for planner:** Accept v1 cooperative-only cancel. Document in helper JSDoc. Capture "thread AbortSignal through network layer" as a deferred backlog item (NOT a Phase 5 task). This honors D-11's "no auth changes, no FSP changes" and keeps Phase 5 scoped.

### Landmine 2 (severity: MEDIUM): Save-bridge error propagation contract is ambiguous

CONTEXT.md §code_context claims save-bridge errors "continue to propagate as `FileSystemError` so VS Code's save-failure indicator still works (Phase 3 D-03 invariant)". **Live code at localScriptCache.ts:109-117 catches and shows a toast — it does NOT re-throw.** The wrap must preserve current behavior exactly (don't break Phase 3 working code). Confirm with a quick `git log` on localScriptCache.ts during planning if this discrepancy matters; otherwise leave the catch where it is and let the helper see no error.

### Landmine 3 (severity: LOW): `vscode.workspace.fs.readFile` vs FSP cancellation

The FSP `readFile(uri)` at remoteScriptFs.ts:190 has no `CancellationToken` parameter in this codebase's implementation (VS Code's `FileSystemProvider.readFile` signature actually allows a 2nd `token` arg in newer API versions, but the project's implementation ignores it). Even if you wanted to thread cancellation here, it's a FSP change — D-11 forbids.

### Landmine 4 (severity: LOW): TypeScript strict mode + generic helper

Project uses `"strict": true`, no `exactOptionalPropertyTypes`. The helper's signature with `Promise<T | undefined>` and a generic op compiles cleanly **if** `vscode.window.withProgress<T | undefined>` is explicitly parameterized (see Pitfall 5). No ESLint config; no formatter; 4-space indent, single quotes, trailing commas per CONVENTIONS.md.

## Runtime State Inventory

N/A — pure UX wrapping change. No stored data, no live service config, no OS-registered state, no secrets, no build artifacts affected.

## Code Examples

### Canonical AbortController + onCancellationRequested pattern (from sign-in)

Verbatim from `src/extension.ts:192-208`:

```ts
const controller = new AbortController();
try {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
            title: 'Altium 365: waiting for sign-in...',
        },
        async (_progress, token) => {
            const cancelSubscription = token.onCancellationRequested(() => controller.abort());
            try {
                await signIn(context, cfg, 180_000, controller.signal);
            } finally {
                cancelSubscription.dispose();
            }
        }
    );
    // ...
} catch (e) {
    // ...
}
```

This is the **reference pattern** for D-05. The helper encapsulates everything from `new AbortController()` through the `finally { cancelSubscription.dispose(); }`. Sign-in works because `signIn` accepts a `controller.signal` argument. Phase 5 sites do not have that luxury — see Landmine 1.

### Existing `Promise<T | undefined>` cancel pattern (caller side)

From `src/scriptCommands.ts:181-184` (`editScript`):
```ts
const tmpPath = await downloadScriptToTmp(context, output, node, 'Open Script');
if (!tmpPath) {
    return;
}
```
Identical pattern at scriptCommands.ts:294 and :313. **All three callers are cancel-ready without modification.**

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Per-call `withProgress` boilerplate | Centralized helper enforcing convention | Phase 5 | DRY, consistent title format, single place to evolve cancel semantics later. |

**Deprecated/outdated:** None.

## Project Constraints (from AGENTS.md)

- All VS Code commands prefixed `altium365.` — N/A (no new commands per D-11).
- Async/await throughout; errors surfaced via `vscode.window.showErrorMessage` at command boundary — Helper re-throws (D-06); callers retain showErrorMessage.
- GraphQL via `graphqlRequest(...)` — unchanged.
- No module-level state except `outputChannel` singleton — `src/progress.ts` has none (pure function module).
- All tokens via `context.secrets` — unaffected.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `vscode.window.withProgress<R>` accepts explicit type parameter for `R` | Pitfall 5 | Compilation error; trivial fix (omit annotation, let inference work). [VERIFIED: VS Code API .d.ts ships with `withProgress<R>(...)`] |
| A2 | The save bridge's `onDidSaveTextDocument` listener serializes per-document such that wrapping the body in `withProgress` won't cause overlapping notifications | Caller wrap patterns | If false, user sees stacked "Publishing script..." notifications on rapid Cmd+S. Low impact. [ASSUMED] |
| A3 | Background `fetch` that completes AFTER user-cancel does not produce a visible error toast in the FSP code path | Landmine 1 | If false, user sees an error after cancelling, which contradicts D-04 "silent cancel". Mitigation: review FSP error paths during planning. [ASSUMED] |

## Open Questions

1. **Should helper append `...` to title, or should callers include it?**
   - Recommendation: callers include it. Avoids double-ellipsis and matches existing site at `extension.ts:198` (`'Altium 365: waiting for sign-in...'`).
2. **For Block A wrap, where exactly do the `showErrorMessage` calls go?**
   - Current Block A has 4 error-toast-and-return arms (lines 99-102, 111-114, 118-122, 136-139). Keeping them inside the op means the user sees both the wrapped notification AND the error toast — which is correct UX. Helper re-throws nothing because each arm uses `return;` not `throw`. Planner: confirm pattern during plan write.
3. **Does wrapping the save-bridge body affect the `setStatusBarMessage('published ...', 3000)` call?**
   - No — that's a successful-path side effect inside the existing try block. Wrap is transparent to it.

## Environment Availability

N/A — no external tools/services needed beyond the existing VS Code + Node runtime.

## Validation Architecture

Skipped — `.planning/config.json` is not inspected here, but D-12 explicitly rejects automated tests for this phase, consistent with Phase 3 D-13 and `TESTING.md`. Manual UAT enumerated in D-12 covers:
- Edit happy path shows spinner
- Edit cancel mid-fetch leaves no tmp file
- Publish save shows spinner (triggered via Cmd+S)
- ExecuteRemote setup shows spinner before kickoff toast
- ExecuteRemote setup cancel aborts before kickoff mutation fires

## Security Domain

N/A for this phase — pure UX wrapper, no auth/credential/input-validation surface change. Tokens stay in `context.secrets`, no new endpoints, no new commands, no new package.json contributions (D-11).

## Sources

### Primary (HIGH confidence)
- Live source inspection 2026-05-22: `src/scriptCommands.ts`, `src/localScriptCache.ts`, `src/remoteExecution.ts`, `src/extension.ts`, `src/sandboxDeps.ts`, `src/workspace.ts`, `src/auth.ts`, `src/remoteScriptFs.ts`, `src/filesService.ts`
- `.planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md` (binding decisions)
- `.planning/phases/03-remote-script-ops/03-CONTEXT.md` (D-02, D-09, D-10 prior bindings)
- `.planning/codebase/CONVENTIONS.md`, `STRUCTURE.md`
- `./AGENTS.md`

### Secondary (MEDIUM confidence)
- VS Code Extension API `withProgress` / `ProgressLocation` / `CancellationToken` — well-known surface, behavior verified by existing 4 in-repo usages.

### Tertiary (LOW confidence)
- None — all claims grounded in either live code or repo decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — vscode API + Node built-ins, both already in use.
- Architecture: HIGH — four sites + one helper, all locations verified.
- Pitfalls: HIGH — Landmine 1 (AbortSignal not threaded) confirmed by grep + manual inspection of every relevant function signature.

**Research date:** 2026-05-22
**Valid until:** 2026-06-21 (30 days — codebase is stable; only invalidator would be someone threading AbortSignal through the network layer, which would relax Landmine 1)
