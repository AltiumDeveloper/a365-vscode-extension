---
phase: 05-progress-feedback-async-ops
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/progress.ts
  - src/scriptCommands.ts
autonomous: true
requirements: [SC-1, SC-3, SC-4]
tags: [vscode-extension, progress, withProgress, abortcontroller]

must_haves:
  truths:
    - "SC-1: When the user clicks Edit Script on a tree node, a notification 'Altium 365: Open Script: loading...' appears during the FSP readFile and dismisses before the editor opens."
    - "SC-3: The notification uses ProgressLocation.Notification, with title format 'Altium 365: ${label}' (caller supplies trailing ellipsis), enforced by withScriptProgress."
    - "SC-4 (cooperative): Cancelling the Edit/Run/Debug download notification dismisses the spinner, the helper returns undefined, no editor opens, and any tmp file written before cancel is unlinked. In-flight FSP readFile completes silently in the background (AbortSignal is NOT propagated to graphqlRequest / vscode.workspace.fs.readFile — RESEARCH.md Landmine 1; documented in helper JSDoc)."
    - "Run Script (Local) and Debug Script (Local) tree commands also show the spinner via the same helper (3-for-1 site)."
    - "D-01: This plan implements wrap sites (a) downloadScriptToTmp and (d) src/progress.ts helper from the four-site scope; sites (b) save bridge and (c) executeRemoteScript Block A land in Plans 02 and 03."
    - "D-04: Cancel UX is silent return + cleanup — helper returns undefined on token cancel, downloadScriptToTmp unlinks any partially-written tmp file in finally, no 'Cancelled' toast surfaced. (Cooperative-only per RESEARCH Landmine 1: in-flight FSP readFile completes silently because AbortSignal is not threaded through the network layer.)"
    - "D-06: withScriptProgress does NOT swallow non-cancel errors — re-throws so callers' existing try/catch + output.appendLine + showErrorMessage at command boundary keeps working unchanged."
    - "D-07: No migration of existing withProgress sites (extension.ts:194 sign-in, extension.ts:782 project picker, remoteExecution.ts:187 poll loop, sandboxDeps.ts:124 deps install) — Plan 01 only adds the helper and integrates it at downloadScriptToTmp."
    - "D-09: Always-show, no delay-show threshold logic — withScriptProgress invokes vscode.window.withProgress immediately with no setTimeout race."
    - "D-11: No new GraphQL ops, no auth changes, no FSP changes, no new commands, no package.json contributions — files_modified is exactly src/progress.ts (new) + src/scriptCommands.ts (edit)."
    - "D-12: No automated tests — verification is the manual UAT checkpoint task at the end of this plan."
  artifacts:
    - path: "src/progress.ts"
      provides: "withScriptProgress<T> helper (D-05 signature)"
      contains: "export async function withScriptProgress"
    - path: "src/scriptCommands.ts"
      provides: "downloadScriptToTmp wrapped in withScriptProgress + cancel-cleanup unlink"
      contains: "withScriptProgress"
  key_links:
    - from: "src/scriptCommands.ts downloadScriptToTmp"
      to: "src/progress.ts withScriptProgress"
      via: "named import"
      pattern: "import .*withScriptProgress.* from '\\./progress'"
    - from: "withScriptProgress cancellation token"
      to: "AbortController.abort()"
      via: "token.onCancellationRequested(() => controller.abort())"
      pattern: "onCancellationRequested"
---

<objective>
Land the `withScriptProgress<T>` helper (D-05) and integrate it at `downloadScriptToTmp` — the 3-for-1 chokepoint that covers Edit Script, Run Script (Local), and Debug Script (Local). After this plan, a user clicking Edit/Run/Debug on a script tree node sees a notification spinner during the FSP fetch where today the UI freezes silently.

Purpose: Establish the helper module and prove it end-to-end against the highest-leverage site. MVP vertical slice — one helper plus one consumer ships visible UI behavior.

Output: `src/progress.ts` (new, ~40 LoC) and modified `src/scriptCommands.ts` with `downloadScriptToTmp` body wrapped + cancel cleanup.
</objective>

<execution_context>
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/STRUCTURE.md
@.planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md
@.planning/phases/05-progress-feedback-async-ops/05-RESEARCH.md
@./AGENTS.md
@src/scriptCommands.ts
@src/extension.ts

<interfaces>
<!-- The canonical AbortController + onCancellationRequested pattern lives at src/extension.ts:192-208 (sign-in withProgress). The new helper encapsulates that exact pattern. -->

Helper signature (D-05, fixed):
```
export async function withScriptProgress<T>(
    label: string,
    op: (signal: AbortSignal, progress: vscode.Progress<{ message?: string }>) => Promise<T>,
    opts?: { cancellable?: boolean }
): Promise<T | undefined>;
```

Existing caller pattern (already cancel-ready, no change required at call sites):
- src/scriptCommands.ts editScript line ~182: `if (!tmpPath) return;`
- src/scriptCommands.ts runLocalFromScriptNode line ~294: `if (!tmpPath) return;`
- src/scriptCommands.ts debugLocalFromScriptNode line ~313: `if (!tmpPath) return;`

downloadScriptToTmp current signature (unchanged):
```
async function downloadScriptToTmp(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    node: A365Node | undefined,
    actionLabel: string
): Promise<string | undefined>
```

Tmp write site (where cleanup unlink must fire): `await fs.writeFile(tmpPath, bytes);` at src/scriptCommands.ts line 363.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create src/progress.ts with withScriptProgress helper</name>
  <files>src/progress.ts</files>
  <read_first>
    - .planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md (D-05, D-06, D-08, D-09)
    - .planning/phases/05-progress-feedback-async-ops/05-RESEARCH.md (§"Helper Implementation Sketch", Pitfall 5, Landmine 1)
    - src/extension.ts lines 192-208 (canonical AbortController + onCancellationRequested pattern)
    - .planning/codebase/CONVENTIONS.md (4-space indent, single quotes, trailing commas, named imports, no barrel files)
  </read_first>
  <action>
    Create new file `src/progress.ts` exporting one function `withScriptProgress<T>` matching D-05 signature exactly. Implementation MUST:
    - Import only `vscode` (no other extension modules; D-01/D-11 keep the module dependency-free).
    - Default `cancellable` to `false` (per D-05 `opts?.cancellable ?? false`).
    - Construct `new AbortController()` per call.
    - Call `vscode.window.withProgress<T | undefined>({ location: vscode.ProgressLocation.Notification, title: `Altium 365: ${label}`, cancellable }, async (progress, token) => { ... })` — explicit type parameter `<T | undefined>` per RESEARCH Pitfall 5 to avoid TS strict-mode inference issues.
    - Inside the withProgress callback: when `cancellable` is true, subscribe `token.onCancellationRequested(() => controller.abort())`. When false, do not subscribe (no cancel button is rendered anyway).
    - Wrap `await op(controller.signal, progress)` in try/catch. On `controller.signal.aborted`, return `undefined` (silent cancel, D-04). On non-cancel errors, re-throw (D-06; helper does NOT swallow errors).
    - `finally { sub?.dispose(); }` to release the cancellation subscription.
    - Title MUST NOT auto-append `...` — callers include trailing punctuation (RESEARCH Open Question 1, planner decision: caller-controlled).
    - Add a JSDoc block on the export that documents the cooperative-cancel limitation explicitly: "AbortSignal passed to `op` is cooperative for v1 — the project's network helpers (graphqlRequest, ensureWorkspaceToken, FSP readFile/writeFile) do not accept AbortSignal as of Phase 5. Helper returns undefined immediately on cancel, but the in-flight network request runs to completion silently. Callers may inspect `signal.aborted` between awaits to short-circuit further work. See .planning/phases/05-progress-feedback-async-ops/05-RESEARCH.md Landmine 1."
    - No module-level state (per AGENTS.md and CONVENTIONS.md — only `outputChannel` singleton is allowed elsewhere; this module has none).
    - 4-space indent, single quotes, trailing commas.
  </action>
  <verify>
    <automated>test -f src/progress.ts &amp;&amp; grep -q "export async function withScriptProgress" src/progress.ts &amp;&amp; grep -q "ProgressLocation.Notification" src/progress.ts &amp;&amp; grep -q "AbortController" src/progress.ts &amp;&amp; grep -q "onCancellationRequested" src/progress.ts &amp;&amp; grep -q "controller.signal.aborted" src/progress.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `src/progress.ts` exists.
    - Contains `export async function withScriptProgress` matching D-05 signature (generic `<T>`, `label: string`, `op: (signal: AbortSignal, progress: vscode.Progress<{ message?: string }>) => Promise<T>`, `opts?: { cancellable?: boolean }`, returns `Promise<T | undefined>`).
    - Uses `vscode.ProgressLocation.Notification` (not `Window`).
    - Title is constructed as `` `Altium 365: ${label}` `` with NO auto-appended ellipsis.
    - Uses `new AbortController()`; calls `controller.abort()` from `token.onCancellationRequested` when cancellable.
    - Catches op errors: returns `undefined` if `controller.signal.aborted`, otherwise re-throws (no swallowing per D-06).
    - JSDoc explicitly documents the cooperative-cancel limitation referencing Landmine 1.
    - No imports other than `vscode`.
    - `npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <done>The helper module compiles, has the D-05 signature, enforces Notification + title convention, wires AbortController from the cancellation token, and documents the cooperative-cancel trade-off in JSDoc.</done>
</task>

<task type="auto">
  <name>Task 2: Wrap downloadScriptToTmp body in withScriptProgress with cancel-cleanup unlink</name>
  <files>src/scriptCommands.ts</files>
  <read_first>
    - src/scriptCommands.ts lines 330-391 (current `downloadScriptToTmp` body)
    - src/scriptCommands.ts lines 172-194 (editScript caller, already returns on undefined)
    - src/scriptCommands.ts lines 287-298 (runLocalFromScriptNode caller)
    - src/scriptCommands.ts lines 307-330 (debugLocalFromScriptNode caller)
    - .planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md (D-01, D-04, D-10 download title)
    - .planning/phases/05-progress-feedback-async-ops/05-RESEARCH.md (§"Caller wrap patterns", Pitfall 2, Landmine 1)
  </read_first>
  <action>
    Add `import { withScriptProgress } from './progress';` to the top of `src/scriptCommands.ts` (named import per CONVENTIONS.md, no barrel).

    Refactor `downloadScriptToTmp` (lines 339-391) as follows:
    - The `resolveScriptContext` + no-selection error message (lines 345-351) stays OUTSIDE the wrap (cheap, synchronous, has its own showErrorMessage; per RESEARCH §"Caller wrap patterns").
    - The remaining body (the try block at lines 352-390 that runs `vscode.workspace.fs.readFile`, computes `tmpPath`, writes the file, registers it, and the catch arm that logs + shows error) MUST be wrapped in `withScriptProgress(label, async (signal) => { ... }, { cancellable: true })`.
    - Title (D-10): pass `label = \`${actionLabel}: loading...\``. The helper prepends "Altium 365: " so the final notification reads e.g. `Altium 365: Open Script: loading...`. Trailing ellipsis is caller-supplied per planner decision (Task 1 JSDoc says callers include trailing punctuation).
    - Inside the wrapped op:
      - Declare `let tmpPath: string | undefined;` at the start so the cleanup `finally` can see it.
      - Move the existing try/catch INSIDE the op closure. The catch arm keeps its existing behavior: `output.appendLine` the error, `vscode.window.showErrorMessage` the user-friendly message, then `return undefined` from the op (so the helper resolves to undefined and the caller's existing `if (!tmpPath) return;` handles it). DO NOT re-throw from the op's catch — D-06 says the helper re-throws non-cancel errors, but the existing behavior was to show a toast and return undefined; preserve that by catching inside the op.
      - Add an inner `try { ... return tmpPath; } finally { if (signal.aborted && tmpPath) { try { await fs.unlink(tmpPath); } catch (e) { output.appendLine(\`[Altium 365] cancel cleanup: unlink failed: ${(e as Error).message}\`); } } }` around the success path so a tmp file written just before cancel gets removed (RESEARCH §"Caller wrap patterns" + Pitfall 2 — unlink is best-effort, must NOT surface to user).
      - DO NOT call `signal.aborted` checks between every line — cooperative-cancel is documented as not aborting the network (Landmine 1). The single `finally`-branch cleanup is sufficient for v1.
    - The helper returns `string | undefined`. Return it directly from `downloadScriptToTmp`. The three existing callers (editScript, runLocalFromScriptNode, debugLocalFromScriptNode) already check `if (!tmpPath) return;` — no caller-side edits required (RESEARCH §"Existing Promise<T | undefined> cancel pattern").
    - Maintain 4-space indent, single quotes, trailing commas.
  </action>
  <verify>
    <automated>grep -q "import .*withScriptProgress.* from './progress'" src/scriptCommands.ts &amp;&amp; grep -q "withScriptProgress" src/scriptCommands.ts &amp;&amp; grep -q "actionLabel.*loading" src/scriptCommands.ts &amp;&amp; grep -q "signal.aborted" src/scriptCommands.ts &amp;&amp; grep -q "unlink" src/scriptCommands.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `src/scriptCommands.ts` imports `withScriptProgress` from `'./progress'` via named import.
    - `downloadScriptToTmp` body is wrapped in `withScriptProgress(...)` with `{ cancellable: true }`.
    - Title label is `` `${actionLabel}: loading...` `` (so notification reads e.g. `Altium 365: Open Script: loading...`).
    - Cancel-path cleanup: if `signal.aborted && tmpPath`, `fs.unlink(tmpPath)` is attempted inside a `try/catch` that logs failures to `output` but never surfaces to user (D-04, RESEARCH Pitfall 2).
    - `resolveScriptContext` + no-selection error message remain OUTSIDE the wrap.
    - Existing error-toast behavior preserved: on non-cancel errors inside the op, log to `output.appendLine`, call `vscode.window.showErrorMessage` with the mapped user message, and return `undefined` from the op (no behavioral change for the error path).
    - The three existing callers (editScript, runLocalFromScriptNode, debugLocalFromScriptNode) are NOT modified (their `if (!tmpPath) return;` already handles undefined).
    - `npx tsc --noEmit` exits 0.
    - `npm run compile` succeeds.
  </acceptance_criteria>
  <done>downloadScriptToTmp shows a cancellable Notification spinner for Edit, Run (Local), and Debug (Local) flows. Cancel returns undefined silently and cleans up any partial tmp file. Existing error-toast paths unchanged.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human UAT — Edit/Run/Debug spinner and cancel</name>
  <what-built>
    - `src/progress.ts` shared helper `withScriptProgress<T>`.
    - `src/scriptCommands.ts` `downloadScriptToTmp` wrapped in helper with cancellable Notification + cancel-cleanup unlink.
  </what-built>
  <how-to-verify>
    Build and launch the extension:
    1. Run `npm run compile` — must exit 0.
    2. Press F5 in VS Code to launch the Extension Development Host.
    3. In the dev host, sign in (`Altium 365: Sign In`) and select a workspace if not already active.
    4. Expand a workspace -> Scripts in the side panel.

    Test A — Edit happy path (SC-1):
    5. Right-click a script and pick `Edit Script`.
    6. EXPECT: A notification spinner appears reading `Altium 365: Open Script: loading...` for the duration of the FSP fetch, then dismisses and the script editor opens.

    Test B — Run/Debug happy path (3-for-1 coverage):
    7. Right-click a script and pick `Run Script (Local)`.
    8. EXPECT: Notification reads `Altium 365: Run Script Locally: loading...` (or the exact `actionLabel` passed by the Run handler) and dismisses before the script runs.
    9. Repeat with `Debug Script (Local)`. EXPECT: equivalent spinner with the debug actionLabel.

    Test C — Edit cancel mid-fetch (SC-4 cooperative):
    10. Right-click a script and pick `Edit Script`.
    11. While the spinner is visible, click the X cancel button on the notification.
    12. EXPECT: Notification dismisses immediately. NO editor opens. NO error toast appears.
    13. Check `os.tmpdir()` (macOS: `$TMPDIR`; print via `echo $TMPDIR` in a terminal): no file named `altium365-<scriptId>-*.py` from this cancel attempt should remain (if the fetch completed before cancel, the cleanup unlink fires; if cancel won the race, no file was ever written).
    14. Check the Altium 365 Output Channel: it may contain a `[Altium 365] cancel cleanup: unlink failed: ...` line if the file was already gone — this is acceptable (best-effort per D-04).

    Test D — Title format consistency (SC-3):
    15. Across all three flows (Edit, Run Local, Debug Local), confirm the notification title always begins with `Altium 365: ` (matches D-08 + sign-in convention at extension.ts:198) and uses `ProgressLocation.Notification` (appears in the bottom-right notification area, not the status bar).
  </how-to-verify>
  <resume-signal>Type "approved" if all four tests pass. If any test fails (no spinner appears, cancel leaves orphan tmp file, wrong title format, or wrong location), report which test and the observed behavior.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User -> Extension UI | User clicks tree action; no new untrusted input vs. Phase 3 |
| Extension -> A365 GraphQL/FSP | Existing network surface unchanged (D-11) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-01 | Information Disclosure | `withScriptProgress` title string passed to notification | accept | Title is caller-controlled (label) and currently contains only static action labels + script names already shown in tree. No tokens/secrets enter the title. |
| T-05-02 | Denial of Service (cooperative-cancel leak) | AbortController not propagated to network layer (Landmine 1) | accept | Documented in JSDoc: cancel dismisses UI but in-flight fetch completes silently. No sensitive-data leak because tokens are already in memory regardless of cancel. Bandwidth waste is the only cost; revisit if dogfooding shows abuse. |
| T-05-03 | Tampering | Cancel-cleanup unlink path | mitigate | Unlink is guarded by `signal.aborted && tmpPath` so we never delete a file we did not write. Unlink failures swallowed to outputChannel only (best-effort, RESEARCH Pitfall 2) — no user-facing surface. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0.
- `npm run compile` exits 0.
- Manual UAT Tests A-D above all pass.
</verification>

<success_criteria>
- `src/progress.ts` exists and exports `withScriptProgress<T>` with D-05 signature.
- `downloadScriptToTmp` is wrapped; Edit/Run/Debug Local all show a Notification spinner.
- Cancel returns undefined silently; partial tmp file cleaned up if present.
- No regression to existing error-toast paths.
- No new commands, no `package.json` changes (D-11).
</success_criteria>

<output>
Create `.planning/phases/05-progress-feedback-async-ops/05-01-SUMMARY.md` when done documenting: helper signature shipped, file paths modified, UAT result, any noteworthy deviations from D-10 title wording.
</output>
