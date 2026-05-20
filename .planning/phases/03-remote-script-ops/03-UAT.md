# Phase 3 — Remote Script Operations — User Acceptance Testing

This document is the manual UAT script for Phase 3. Each scenario has a fixed
prerequisites / steps / expected-outcome block plus blank rows for the operator
to fill in during the UAT session. Sign-off goes at the bottom.

> **Operator instructions:** Execute every scenario in order on a fresh
> Extension Development Host (F5 from this workspace). Fill in the
> _Observed Outcome_ and _Pass/Fail_ rows as you go. If a scenario fails,
> capture the OutputChannel transcript in the _Observations_ section and
> note the failing scenario in the Sign-off block.

---

## Scenario 1 — Open remote script (SCRIPT-02)

**Prerequisites**

- Signed in to Altium 365 (the same workspace used in 02.3 UAT is fine).
- Side panel shows ≥ 1 published script under the selected workspace.

**Steps**

1. Activity Bar → Altium 365.
2. Expand the workspace node → expand the `Scripts` group.
3. Right-click any script → **Edit Script**.

**Expected Outcome**

- A read/write editor opens with the URI `altium365://<workspaceId>/<scriptId>/<encodedName>.py` in the title bar.
- Document content matches the script body shown in the A365 web portal.
- Python syntax highlighting active (if the Python extension is installed).
- OutputChannel `Altium 365` shows exactly one line:
  `readFile <uri>: <N> bytes via fileToken <8-char-prefix>...`.

**Observed Outcome**

> Edit Script opened the remote body in a read/write editor with Python syntax highlighting active. URI shape was the GRID form `altium365:/grid:workspace:<authId>:scripts:script/<scriptId>/<displayName>` (final form after the in-phase URI fix — superseded the URI shape described in the original Expected Outcome). Content matched the portal.

**Pass** — confirmed in session 2026-05-20.

---

## Scenario 2 — Edit + Save Publish (SCRIPT-03 happy path)

**Prerequisites**

- Scenario 1 completed; editor still open.

**Steps**

1. Insert a comment line at the very top: `# UAT touch <ISO timestamp>`.
2. Save with `Ctrl+S` (macOS: `Cmd+S`) — _or_ right-click the script in the side panel → **Publish Script**.
3. Close the editor (`Ctrl+W` / `Cmd+W`).
4. Right-click the same script → **Edit Script** again.

**Expected Outcome**

- No error toast on save.
- OutputChannel shows: `writeFile <uri>: published <N> bytes → scriptVersionId=<...>`.
- The reopened editor shows the comment line at the top.
- The portal lists a new script version with the comment _"Updated via VS Code extension"_.

**Observed Outcome**

> Save published a new version; OutputChannel logged the writeFile line; reopening showed the touched content. New version appeared in the portal.

**Pass** — confirmed in session 2026-05-20.

---

## Scenario 3 — Publish failure preserves dirty state (D-03 + D-11)

**Prerequisites**

- Scenario 1 completed; editor open with at least one unsaved change.

**Steps**

1. Disconnect from the network (turn Wi-Fi off, or use a network-link conditioner / firewall block on the GraphQL endpoint).
2. Press `Ctrl+S` / `Cmd+S` to attempt publish.
3. Verify VS Code's standard "Failed to save" indicator appears and the editor stays dirty.
4. Reconnect to the network.
5. Press `Ctrl+S` / `Cmd+S` again.

**Expected Outcome**

- Step 2: VS Code shows "Failed to save" / "There are unsaved changes" — the dirty dot stays on the editor tab.
- Step 2: OutputChannel shows the network error (message + stack). The user-facing toast is friendly — either a curated message via the D-11 mapping if the failure carries a known `code`, or the raw error message (both acceptable).
- Step 5: save succeeds; dirty state cleared; new version visible in the portal.

**Observed Outcome**

> _operator fills in_

**Pass / Fail**

> _operator fills in_

---

## Scenario 4 — Execute Remotely happy path (SCRIPT-04 + SCRIPT-05)

**Prerequisites**

- Signed in.
- A script known to complete in &lt; 30 s (operator picks; e.g. a `print('hello')` script).

**Steps**

1. In the side panel, right-click the chosen script → **Execute Remotely**.
2. If a project-id input box appears (`altium365.promptForProjectId` is `true`), press Enter to skip _or_ paste a valid project id.
3. Reveal the Altium 365 OutputChannel.

**Expected Outcome**

- A progress notification appears titled `Altium 365: Executing <scriptName>...` with a Cancel button.
- OutputChannel shows a header line, then `status=` lines as the server-side execution advances.
- Log lines stream **incrementally** (multiple ticks before terminal status), not in one final batch.
- A terminal `status=` line appears whose value is one of (case-insensitive): `succeeded`, `failed`, `cancelled`, `stopped`, `completed`, `error`.
- A footer line `Remote execution finished (status=..., exit=...)` is the last thing written for this run.

**Observed Outcome**

> Execute Remotely streamed logs incrementally to OutputChannel. Status progressed `Pending` → `Running` → `Stopped` (terminal). Footer line `Remote execution finished (status=Stopped, exit=...)` appeared at the end. Note: observed status values are PascalCase (`Pending`, `Running`, `Stopped`), not the lowercase set listed in Expected Outcome — the `TERMINAL_STATUSES` set in `src/remoteExecution.ts` is case-insensitive so the lowercase entries continue to match. See Observations below.

**Pass** — confirmed in session 2026-05-20.

---

## Scenario 5 — Execute Remotely cancellation (D-10)

**Prerequisites**

- A script known to take &gt; 10 s (operator wraps a `time.sleep(20)` if needed).

**Steps**

1. Right-click the slow script → **Execute Remotely**.
2. Wait for 2–3 log lines to appear in the OutputChannel.
3. Click **Cancel** on the progress notification.

**Expected Outcome**

- Within ~1.5 s (one poll tick) the progress notification dismisses.
- OutputChannel shows _exactly one_ line: `[Altium 365] Remote execution cancelled (server-side execution continues)`.
- No further `status=` or log lines appear after the cancellation line.
- After ~5 s, the A365 web portal still shows the execution as running or completed on the server side — confirming the "server-side execution continues" caveat.

**Observed Outcome**

> _operator fills in_

**Pass / Fail**

> _operator fills in_

---

## Observations

### Terminal `status` values observed during UAT

Observed during session 2026-05-20 (dev1 workspace):

- Non-terminal: `Pending` (queued), `Running` (active)
- Terminal: `Stopped` (normal completion)

Server returns PascalCase. `TERMINAL_STATUSES` in `src/remoteExecution.ts` matches case-insensitively and contains `stopped`, `succeeded`, `failed`, `cancelled`, `completed`, `error` — only `stopped` was empirically observed; the others remain defensive entries pending observation against failure/cancel scenarios (Scenarios 3 + 5 deferred — see Sign-off).

### UAT-discovered bugs fixed in-phase

1. **URI shape (GRID semantics)** — original URI shape `altium365://<workspaceId>/<scriptId>/<encodedName>.py` caused double-encoding via `vscode.Uri.from`. Fixed to the GRID-form path `altium365:/grid:workspace:<authId>:scripts:script/<scriptId>/<displayName>`. Python language explicitly set after open (no `.py` suffix in URI). `editor/title` menu `when` clause simplified to `resourceScheme == altium365`. Commits `893452a` → `85f0fb6`.
2. **`gloScrScriptExecutionResult` schema mismatch** — the Query field returns the umbrella `GloScrScriptExecution` type. `exitCode` lives under `executionResult.exitCode` (Int!), not at top level. `startedAt`/`completedAt` do not exist — use `createdAt`/`updatedAt`. Commit `90cc30b`.
3. **OAuth scopes rejected by UAT/Prod auth servers** — `workspace:scripts.manage workspace:scripts.execute` are not yet registered with UAT/Prod auth clients; sign-in failed with scope-not-recognized. Reduced UAT/Prod to `openid profile` until the scopes are provisioned. Dev1 scopes unchanged (working). Tracked as follow-up: re-add scopes once registered server-side.

### Deviations from expected outcome

> _Anything unexpected — UI flicker, duplicate log lines, missing footer,
> error-toast wording quirks — that doesn't fail the scenario but should be
> tracked as fix-forward work._

### Regression sanity (quick checks — not part of the scenario set)

- [ ] Sign-in flow still works (02.2)
- [ ] Environment switch still works (02.3 — D-18)
- [ ] Workspace switch still works (resets selected workspace + clears tokens)
- [ ] Local `runScript` placeholder still shows the "coming in Phase 3" toast (Phase 02 BLOCKED — unchanged)

---

## Sign-off

| Field             | Value                       |
| ----------------- | --------------------------- |
| Signed off by:    | Dmitry Kolomiets             |
| Date:             | 2026-05-21                  |
| Phase result:     | **PASS (partial)**          |
| Passing scenarios | 1 (Open), 2 (Edit+Publish), 4 (Execute+stream) |
| Deferred scenarios | 3 (network-failure publish), 5 (cancel mid-exec) — deferred to follow-up; require deliberate failure injection not exercised this session |
| Failing scenarios | none                        |
| Notes for follow-up | (a) Re-run Scenarios 3 + 5 once a failure-injection harness is available. (b) Re-register `workspace:scripts.manage` + `workspace:scripts.execute` scopes on UAT/Prod auth clients, then restore them in `package.json`. (c) Trim `TERMINAL_STATUSES` once cancel/fail paths are observed and the unused defensive entries are confirmed dead. |

Phase 3 closed with partial UAT acceptance — mirrors the Phase 02.3 closure pattern.
