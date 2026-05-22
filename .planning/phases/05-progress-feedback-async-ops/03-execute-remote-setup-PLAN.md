---
phase: 05-progress-feedback-async-ops
plan: 03
type: execute
wave: 2
depends_on: ["05-01"]
files_modified:
  - src/remoteExecution.ts
autonomous: true
requirements: [SC-2, SC-3, SC-4]
tags: [vscode-extension, progress, remote-execution, abortcontroller]

must_haves:
  truths:
    - "SC-2 (executeRemote half): When the user invokes Execute Remotely, a notification 'Altium 365: Preparing to execute ${scriptName}...' appears immediately and stays visible during the workspace lookup, token exchange, and parameter resolution (Block A + Block B, lines 88-144). It dismisses BEFORE the existing poll-loop notification 'Altium 365: Executing ${scriptName}...' appears (D-02 acknowledges two back-to-back notifications; titles disambiguate phases per RESEARCH Pitfall 3)."
    - "SC-3: Block A spinner uses ProgressLocation.Notification with title prefix 'Altium 365: ' (matches D-08 + helper convention from Plan 01)."
    - "SC-4 (cooperative): Cancelling the 'Preparing to execute...' notification dismisses the spinner, prevents the kickoff mutation (Block D, executeScript at line 156) from firing, and exits silently with no error toast. In-flight `getBaseAccessToken` / `listWorkspaces` / `ensureWorkspaceToken` calls complete silently in the background (AbortSignal not propagated — RESEARCH Landmine 1)."
    - "The existing poll-loop withProgress at remoteExecution.ts:187 is NOT modified (D-02). Block C OutputChannel header (line 147-151) and Block D kickoff (lines 154-184) stay OUTSIDE the new wrap and run only after Block A+B succeeds."
    - "Block A's four early-return-with-toast arms (workspace baseToken missing, workspace lookup catch, workspace not found, token exchange catch) are preserved verbatim inside the wrap. Each returns undefined from the op closure; caller checks result and bails (RESEARCH Open Question 2)."
  artifacts:
    - path: "src/remoteExecution.ts"
      provides: "executeRemoteScript Block A+B wrapped in withScriptProgress (cancellable)"
      contains: "withScriptProgress"
  key_links:
    - from: "src/remoteExecution.ts executeRemoteScript"
      to: "src/progress.ts withScriptProgress"
      via: "named import"
      pattern: "import .*withScriptProgress.* from '\\./progress'"
    - from: "Block A+B wrap result"
      to: "Block C/D (kickoff)"
      via: "if (!setup) return; then destructure ws/wsToken/apiUrl/parameters"
      pattern: "if \\(!.*\\) return"
---

<objective>
Wrap `executeRemoteScript` Block A (workspace lookup + token exchange) and Block B (parameter resolution) in `withScriptProgress(\`Preparing to execute ${scriptName}...\`, ..., { cancellable: true })` so the user sees immediate feedback during the setup phase that today runs silently before the existing poll-loop spinner mounts. Closes the "frozen UI before kickoff" gap (backlog 999.3 item 2) and the executeRemote half of SC-2.

Purpose: Plug the silent gap between user click and the existing poll-loop notification. User-visible behavior delta: clicking Execute Remotely now shows an immediate "Preparing..." spinner; today nothing visible happens until the kickoff mutation returns and the poll-loop notification appears.

Output: Modified `src/remoteExecution.ts` only.
</objective>

<execution_context>
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/dmitrykolomiets/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/codebase/CONVENTIONS.md
@.planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md
@.planning/phases/05-progress-feedback-async-ops/05-RESEARCH.md
@.planning/phases/03-remote-script-ops/03-CONTEXT.md
@./AGENTS.md
@src/remoteExecution.ts
@src/progress.ts

<interfaces>
<!-- Helper from Plan 01 (Wave 1, dependency). -->

```
export async function withScriptProgress<T>(
    label: string,
    op: (signal: AbortSignal, progress: vscode.Progress<{ message?: string }>) => Promise<T>,
    opts?: { cancellable?: boolean }
): Promise<T | undefined>;
```

executeRemoteScript current structure (src/remoteExecution.ts:87-194):
- Block A (lines 88-141): cfg read, workspace resolution (getSelectedWorkspace or fallback listWorkspaces), token exchange via ensureWorkspaceToken, apiUrl computation. Four error arms each `showErrorMessage` + `return;`.
- Block B (line 144): `const parameters = resolveScriptParameters(args.context, args.scriptId);` — synchronous, fast.
- Block C (lines 147-151): `args.output.show(true)` + `output.appendLine` execution header.
- Block D (lines 154-184): `executeScript(...)` kickoff mutation + its own try/catch error arm.
- Block E (lines 187-194): existing poll-loop `vscode.window.withProgress` — DO NOT MODIFY (D-02).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wrap executeRemoteScript Block A+B in withScriptProgress (cancellable)</name>
  <files>src/remoteExecution.ts</files>
  <read_first>
    - src/remoteExecution.ts lines 80-194 (full setup + kickoff + poll-loop region)
    - src/progress.ts (helper signature from Plan 01)
    - .planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md (D-01c, D-02, D-03, D-04, D-10 Block A title)
    - .planning/phases/05-progress-feedback-async-ops/05-RESEARCH.md (§"Caller wrap patterns" Block A paragraph, Pitfall 3, Landmine 1, Open Question 2)
    - .planning/phases/03-remote-script-ops/03-CONTEXT.md (D-09 outputChannel header ordering)
  </read_first>
  <action>
    Add `import { withScriptProgress } from './progress';` to `src/remoteExecution.ts` (named import).

    Refactor `executeRemoteScript` (lines 87-194):
    - Keep `const cfg = readOAuthConfig();` (line 89) inside the wrap (it's part of setup and cheap; including it keeps the wrap boundary clean and matches RESEARCH §"Caller wrap patterns" which says "wrap lines 89-144").
    - Wrap Block A (lines 89-141) PLUS Block B (line 144) in a single `withScriptProgress(\`Preparing to execute ${args.scriptName}...\`, async (signal) => { ... }, { cancellable: true })` call. Title label is exactly `` `Preparing to execute ${args.scriptName}...` `` per D-10 (helper prepends `Altium 365: ` -> notification reads `Altium 365: Preparing to execute <scriptName>...`). Disambiguated from the poll-loop's `Executing ${scriptName}...` per RESEARCH Pitfall 3.
    - The op closure must return either:
      - On success: an object `{ ws, wsToken, apiUrl, parameters }` so Block C/D downstream can destructure.
      - On any of the four existing early-return-with-toast arms (baseToken missing, workspace lookup catch, ws not found, token exchange catch): keep the existing `vscode.window.showErrorMessage(...)` calls INSIDE the op AND `return undefined;` from the op closure (not `throw`). Helper passes undefined back to caller cleanly. Per RESEARCH Open Question 2.
    - After the wrap resolves, add `if (!setup) return;` to handle both the cancellation path (helper returned undefined silently) AND the four explicit error returns (each already showed its own toast). Then destructure: `const { ws, wsToken, apiUrl, parameters } = setup;`.
    - Type the destructured shape explicitly to keep TS strict happy. Inline interface or `type` alias is fine: `type SetupResult = { ws: WorkspaceInfo; wsToken: string; apiUrl: string; parameters: ReturnType<typeof resolveScriptParameters> };` (use the existing imported types; do not invent new ones).
    - Block C (output.show + header, lines 147-151) stays OUTSIDE the wrap and runs only after `setup` is truthy. This preserves Phase 3 D-09 ordering: header appears AFTER the "Preparing..." notification dismisses.
    - Block D kickoff mutation (lines 154-184) stays OUTSIDE the wrap with its existing try/catch unchanged.
    - Block E poll-loop withProgress (lines 187-194) MUST NOT be modified (D-02). Verify by inspection that lines 187-194 are byte-identical after refactor.
    - DO NOT thread `signal` into `listWorkspaces` or `ensureWorkspaceToken` — Landmine 1 says these functions do not accept AbortSignal; threading would require auth.ts/workspace.ts changes forbidden by D-11. The signal parameter on the op closure is unused but accepted (helper still wires `controller.abort()` on cancel; the helper's own abort-check short-circuits the return to undefined).
    - Cooperative-cancel note: optionally add a single `if (signal.aborted) return undefined;` check between the workspace-lookup `await` and the token-exchange `await` (e.g., around line 124 area between Block A's two await points). This gives the user one extra short-circuit point if they cancel right between the two network round-trips. Acceptable but not required — left to executor judgment.
    - Maintain 4-space indent, single quotes, trailing commas.
  </action>
  <verify>
    <automated>grep -q "import .*withScriptProgress.* from './progress'" src/remoteExecution.ts &amp;&amp; grep -q "Preparing to execute" src/remoteExecution.ts &amp;&amp; grep -q "cancellable: true" src/remoteExecution.ts &amp;&amp; grep -q "withScriptProgress" src/remoteExecution.ts &amp;&amp; grep -c "vscode.window.withProgress" src/remoteExecution.ts | awk '$1 == 1 { exit 0 } { exit 1 }' &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `src/remoteExecution.ts` imports `withScriptProgress` from `'./progress'`.
    - Block A+B (lines ~89-144 in the pre-refactor file) is wrapped in `withScriptProgress(\`Preparing to execute ${args.scriptName}...\`, async (signal) => { ... }, { cancellable: true })`.
    - The op closure returns a typed object `{ ws, wsToken, apiUrl, parameters }` on success.
    - All four pre-existing error-toast arms inside Block A (baseToken missing, workspace lookup catch, ws not found, token exchange catch) are preserved verbatim and `return undefined;` from the op closure.
    - After the wrap, `if (!setup) return;` handles both cancel and explicit error returns.
    - Block C (output.show + header) runs AFTER the wrap resolves successfully — header order unchanged.
    - Block D (executeScript kickoff) runs unchanged after Block C.
    - Block E (poll-loop withProgress at line 187) is byte-identical — D-02 invariant preserved. `grep -c 'vscode.window.withProgress' src/remoteExecution.ts` returns exactly 1 (the poll loop). The new Block A wrap uses `withScriptProgress`, not raw `vscode.window.withProgress`.
    - No new imports beyond `withScriptProgress` (no new types invented; reuse `WorkspaceInfo` and existing types).
    - `npx tsc --noEmit` exits 0.
    - `npm run compile` exits 0.
  </acceptance_criteria>
  <done>executeRemoteScript shows a cancellable `Altium 365: Preparing to execute <scriptName>...` notification covering Block A + B. On success, it dismisses, then the existing OutputChannel header and `Altium 365: Executing <scriptName>...` poll-loop notification appear. On cancel, the kickoff mutation does not fire and no error toast appears.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Human UAT — Execute Remotely setup spinner and cancel</name>
  <what-built>
    - `src/remoteExecution.ts` `executeRemoteScript` Block A+B wrapped in `withScriptProgress(\`Preparing to execute ${scriptName}...\`, ..., { cancellable: true })`.
    - Poll-loop withProgress at line 187 unchanged (D-02).
  </what-built>
  <how-to-verify>
    Build and launch:
    1. `npm run compile` — must exit 0.
    2. Press F5 to launch the Extension Development Host.
    3. Sign in and select a workspace.

    Test A — Setup spinner appears before kickoff (SC-2 executeRemote half):
    4. Expand workspace -> Scripts. Right-click a script and pick `Execute Remotely` (or click the editor-title Execute button on an open remote script).
    5. EXPECT: A notification appears IMMEDIATELY reading `Altium 365: Preparing to execute <scriptName>...` with a cancel (X) button.
    6. EXPECT: It dismisses, then the Altium 365 Output Channel reveals (`output.show(true)` from Block C) and prints `[Altium 365] Executing <scriptName> (scriptId=..., workspace=...)`.
    7. EXPECT: A second notification appears reading `Altium 365: Executing <scriptName>...` (existing poll-loop, unchanged).
    8. EXPECT: Two notifications visible back-to-back is acknowledged behavior (D-02 + RESEARCH Pitfall 3).

    Test B — Cancel during setup aborts before kickoff (SC-4 cooperative):
    9. Right-click a script and pick `Execute Remotely` again.
    10. While the `Preparing to execute...` spinner is visible, click the X cancel button.
    11. EXPECT: Notification dismisses immediately.
    12. EXPECT: NO `Executing <scriptName>...` poll-loop notification appears (proves Block D kickoff did NOT fire).
    13. EXPECT: NO error toast.
    14. EXPECT: Output Channel does NOT show a new `[Altium 365] Executing <scriptName> ...` header line for this cancelled invocation (Block C runs only after setup is truthy).

    Test C — Title disambiguation (SC-3 + RESEARCH Pitfall 3):
    15. Verify visually that the two notification titles are distinguishable: `Preparing to execute <scriptName>...` vs `Executing <scriptName>...`. They should NOT both read the same string.

    Test D — Error path preserved:
    16. Sign out, then immediately attempt Execute Remotely on a tree node (token cache may still have a stale base token).
    17. EXPECT: `Preparing to execute...` spinner appears, then dismisses, then existing error toast `Altium 365: Execute Remotely failed: not signed in.` or similar appears. (Confirms the four error arms inside Block A still surface their own toast and return undefined cleanly.)
  </how-to-verify>
  <resume-signal>Type "approved" if all four tests pass. If any fail, report the test number and observed behavior (e.g. "Test B: kickoff still fired after cancel", "Test C: titles identical and confusing").</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User click -> kickoff mutation (executeScript) | Existing Phase 3 surface; cancel must prevent kickoff to avoid orphan executions |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-06 | Information Disclosure | Notification title contains `scriptName` | accept | scriptName is already visible in the tree node and OutputChannel header; no new disclosure surface. |
| T-05-07 | Tampering / Denial of Service | Background `listWorkspaces` / `ensureWorkspaceToken` complete after cancel (Landmine 1) | accept | No server-side state created by these reads. Tokens cached as side effect — same outcome as a non-cancelled invocation that the user simply does not consume. No leak (tokens already in memory regardless of cancel). |
| T-05-08 | Repudiation | Cancelled setup leaves no Output Channel trace | accept | Cancel is silent by design (D-04). User clicked cancel; they know the action did not run. Adding an audit line would contradict the silent-cancel contract. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0.
- `npm run compile` exits 0.
- `grep -c 'vscode.window.withProgress' src/remoteExecution.ts` returns exactly 1 (poll loop only; setup uses `withScriptProgress` helper).
- Manual UAT Tests A-D above all pass.
</verification>

<success_criteria>
- executeRemoteScript Block A+B is wrapped; setup spinner appears immediately on Execute Remotely.
- Cancel during setup prevents Block D kickoff and surfaces no error toast.
- Poll-loop withProgress at line 187 unmodified.
- Block C OutputChannel header still appears AFTER setup, BEFORE kickoff.
- Existing four error arms inside Block A still surface their toasts unchanged.
</success_criteria>

<output>
Create `.planning/phases/05-progress-feedback-async-ops/05-03-SUMMARY.md` documenting the wrap boundary, the chosen success-shape return object, UAT result, and confirmation that the poll-loop withProgress was not touched.
</output>
