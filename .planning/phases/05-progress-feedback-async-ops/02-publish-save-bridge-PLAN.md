---
phase: 05-progress-feedback-async-ops
plan: 02
type: execute
wave: 2
depends_on: ["05-01"]
files_modified:
  - src/localScriptCache.ts
autonomous: true
requirements: [SC-2, SC-3]
tags: [vscode-extension, progress, publish, save-bridge]

must_haves:
  truths:
    - "SC-2 (publish half): When the user saves a tmp-file editor that's registered as a local-script bridge (Cmd+S or File: Save), a notification 'Altium 365: Publishing script...' appears during the `remoteFs.writeFile` round-trip and dismisses on success or error."
    - "SC-3: The notification uses ProgressLocation.Notification with title 'Altium 365: Publishing script...' (D-10), matching the convention enforced by withScriptProgress (Plan 01)."
    - "Publish is NON-cancellable (D-03): mid-mutation cancel is worse than a completed write (Phase 3 D-02 last-write-wins), and Cmd+S has no natural cancel UX. The notification renders without a cancel button."
    - "Error propagation contract preserved: the existing catch arm at localScriptCache.ts:109-117 stays inside the wrap; failures still log to outputChannel and call vscode.window.showErrorMessage (RESEARCH Landmine 2 — current code catches and shows toast; helper re-throws non-cancel errors but caller catches them). The setStatusBarMessage('published ...', 3000) success side-effect is unchanged."
  artifacts:
    - path: "src/localScriptCache.ts"
      provides: "Save-bridge body wrapped in withScriptProgress (non-cancellable)"
      contains: "withScriptProgress"
  key_links:
    - from: "src/localScriptCache.ts registerLocalScriptSaveBridge"
      to: "src/progress.ts withScriptProgress"
      via: "named import"
      pattern: "import .*withScriptProgress.* from '\\./progress'"
---

<objective>
Wrap the save-bridge handler in `registerLocalScriptSaveBridge` so that Cmd+S (and explicit "Publish Script" menu, which routes through the same `doc.save()` -> `onDidSaveTextDocument` flow) shows the `Altium 365: Publishing script...` notification during the `remoteFs.writeFile` round-trip. Non-cancellable per D-03.

Purpose: Close the publish-half of SC-2. User-visible behavior delta: Cmd+S in an open tmp-file editor now shows a spinner where today there is silence until the status-bar success flash.

Output: Modified `src/localScriptCache.ts` only.
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
@src/localScriptCache.ts
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

Current save-bridge body (src/localScriptCache.ts lines 83-118): an `onDidSaveTextDocument` async listener that filters to `file://` documents registered via `getLocalScript(doc.uri.fsPath)`, builds a remote `altium365:` URI, then `try { ... bytes / remoteFs.writeFile / output.appendLine / setStatusBarMessage ... } catch (e) { output.appendLine / showErrorMessage }`. The catch does NOT re-throw — VS Code's save-failure indicator is not relied on (RESEARCH Landmine 2 reconciles the CONTEXT.md §code_context wording).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wrap save-bridge body in withScriptProgress (non-cancellable)</name>
  <files>src/localScriptCache.ts</files>
  <read_first>
    - src/localScriptCache.ts (full file; lines 79-119 are the bridge)
    - src/progress.ts (the helper signature from Plan 01)
    - .planning/phases/05-progress-feedback-async-ops/05-CONTEXT.md (D-01b, D-03, D-04, D-10 publish title)
    - .planning/phases/05-progress-feedback-async-ops/05-RESEARCH.md (§"Caller wrap patterns" save-bridge paragraph, Pitfall 4, Landmine 2, Assumption A2)
    - .planning/phases/03-remote-script-ops/03-CONTEXT.md (D-02 last-write-wins, D-03 error contract)
  </read_first>
  <action>
    Add `import { withScriptProgress } from './progress';` to `src/localScriptCache.ts` (named import, no barrel).

    Refactor `registerLocalScriptSaveBridge` (lines 79-119):
    - The outer guards (`if (doc.uri.scheme !== 'file') return;`, `const identity = getLocalScript(doc.uri.fsPath); if (!identity) return;`, `const remoteUri = buildScriptUri(...)`) stay OUTSIDE the wrap. They are cheap sync filters; no need to show a spinner for irrelevant saves.
    - Wrap the entire `try { bytes / remoteFs.writeFile / output.appendLine / setStatusBarMessage } catch { output.appendLine / showErrorMessage }` block (lines 96-117) in `withScriptProgress('Publishing script...', async () => { ... }, { cancellable: false })`.
    - Title label is exactly `'Publishing script...'` (D-10 publish wording). Helper prepends `Altium 365: ` -> notification reads `Altium 365: Publishing script...`.
    - The op closure does NOT receive an AbortSignal usefully (`cancellable: false` means no cancel button renders; no need to thread signal anywhere).
    - Keep the existing try/catch INSIDE the op closure. Rationale: existing catch already does `output.appendLine` + `showErrorMessage` and intentionally does NOT re-throw (Phase 3 didn't surface FileSystemError, per Landmine 2 reconciliation). Preserving the catch inside the op means the helper sees no error, returns the op's value (undefined for void), and behavior is byte-identical to today PLUS the spinner.
    - The `await` on `withScriptProgress(...)` becomes a no-op fire-and-forget from VS Code's perspective on the `onDidSaveTextDocument` listener (VS Code awaits async listeners; serial per-doc per Assumption A2).
    - DO NOT add a "save in progress" outputChannel line (style preference left to Claude's discretion per RESEARCH §"Claude's Discretion"; planner says no — keep diagnostic noise minimal, the spinner IS the signal).
    - DO NOT modify `getLocalScript`, `registerLocalScript`, or any other export in this file.
    - Maintain 4-space indent, single quotes, trailing commas.
  </action>
  <verify>
    <automated>grep -q "import .*withScriptProgress.* from './progress'" src/localScriptCache.ts &amp;&amp; grep -q "withScriptProgress" src/localScriptCache.ts &amp;&amp; grep -q "Publishing script" src/localScriptCache.ts &amp;&amp; grep -q "cancellable: false" src/localScriptCache.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `src/localScriptCache.ts` imports `withScriptProgress` from `'./progress'` via named import.
    - The save-bridge body (post-filter) is wrapped in `withScriptProgress('Publishing script...', async () => { ... }, { cancellable: false })`.
    - The outer schema/identity guards remain outside the wrap (no spinner for non-bridged saves).
    - The existing try/catch stays INSIDE the op closure; existing `output.appendLine` + `vscode.window.showErrorMessage` + `setStatusBarMessage('published ...', 3000)` behavior is byte-identical apart from the surrounding spinner.
    - The catch does NOT re-throw (preserves current Phase 3 behavior; RESEARCH Landmine 2).
    - No changes to `getLocalScript`, `registerLocalScript`, or other exports.
    - No new outputChannel diagnostic lines added for the "publishing" event itself.
    - `npx tsc --noEmit` exits 0.
    - `npm run compile` exits 0.
  </acceptance_criteria>
  <done>The save-bridge handler is wrapped. Cmd+S on a registered tmp file shows `Altium 365: Publishing script...` notification without a cancel button. Success and failure paths behave identically to before, with the spinner as the new visible signal.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Human UAT — Publish save spinner (Cmd+S and Publish menu)</name>
  <what-built>
    - `src/localScriptCache.ts` `registerLocalScriptSaveBridge` body wrapped in `withScriptProgress('Publishing script...', ..., { cancellable: false })`.
  </what-built>
  <how-to-verify>
    Build and launch:
    1. `npm run compile` — must exit 0.
    2. Press F5 to launch the Extension Development Host.
    3. Sign in and select a workspace.

    Test A — Cmd+S save (SC-2 publish half):
    4. Expand workspace -> Scripts. Right-click a script and pick `Edit Script` (this exercises Plan 01's spinner too; ignore that one).
    5. Once the editor opens on the tmp file, make a trivial edit (add and delete a single space).
    6. Press Cmd+S (macOS) / Ctrl+S (Windows/Linux).
    7. EXPECT: A notification appears reading `Altium 365: Publishing script...` for the duration of the `remoteFs.writeFile` round-trip.
    8. EXPECT: The notification has NO cancel button (it's non-cancellable per D-03).
    9. EXPECT: On success, notification dismisses and the status bar briefly shows `Altium 365: published <scriptName>` for ~3s (existing behavior preserved).
    10. EXPECT: The Altium 365 Output Channel logs `[Altium 365] Published <fsPath> -> altium365://... (<N> bytes)`.

    Test B — Explicit Publish menu (same code path):
    11. With the same editor open and a fresh trivial edit, right-click in the editor and pick `Altium 365: Publish Script` (or invoke via Command Palette).
    12. EXPECT: Same `Altium 365: Publishing script...` notification appears (because Publish ultimately calls `doc.save()` which triggers `onDidSaveTextDocument`).

    Test C — Failure path preserved:
    13. Disconnect the network (or temporarily revoke workspace token via signing out and back in to invalidate the cache — quickest: edit the local file then sign out and try Cmd+S).
    14. EXPECT: Notification appears, dismisses, then `Altium 365: publish failed — <message>` error toast appears. (Confirms catch arm still fires + helper does not swallow.)

    Test D — Non-bridged saves do not spin:
    15. Open any random file outside the tmp-file flow (e.g., open `package.json` in the dev host's parent workspace and save it).
    16. EXPECT: NO `Altium 365: Publishing script...` notification appears (the schema/identity guards short-circuit before the wrap).
  </how-to-verify>
  <resume-signal>Type "approved" if all four tests pass. If any fail, report the test and observed behavior (e.g. "Test A: notification never appeared", "Test D: spurious spinner on unrelated saves").</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User editor save -> remote A365 mutation | Existing publish surface from Phase 3 D-02 (last-write-wins) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-04 | Tampering | Save-bridge wrap might suppress catch arm | mitigate | Catch stays INSIDE the op so existing `showErrorMessage` + `outputChannel` log fire as before. Verified in Task 2 Test C. |
| T-05-05 | Denial of Service (no-cancel mid-write) | `cancellable: false` is deliberate (D-03) | accept | Mid-mutation cancel is worse than completed write per Phase 3 D-02 last-write-wins. Notification renders without cancel button by passing `cancellable: false` to helper. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0.
- `npm run compile` exits 0.
- Manual UAT Tests A-D above all pass.
</verification>

<success_criteria>
- `registerLocalScriptSaveBridge` body wrapped in `withScriptProgress('Publishing script...', ..., { cancellable: false })`.
- Cmd+S and explicit Publish both show the spinner; non-bridged saves do not.
- Failure path still surfaces error toast via existing catch arm; success status-bar flash unchanged.
- No regression to Phase 3 D-02 last-write-wins behavior.
</success_criteria>

<output>
Create `.planning/phases/05-progress-feedback-async-ops/05-02-SUMMARY.md` documenting the wrap site, UAT result, and confirmation that error/success paths are unchanged.
</output>
