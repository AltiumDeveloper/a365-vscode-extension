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

> _operator fills in_

**Pass / Fail**

> _operator fills in_

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

> _operator fills in_

**Pass / Fail**

> _operator fills in_

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

> _operator fills in. Record EVERY distinct `status` value seen (intermediate + terminal) — feeds Pitfall 5 follow-up._

**Pass / Fail**

> _operator fills in_

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

> _List every distinct value seen in the `status=` field across Scenarios 4 + 5.
> If any value falls **outside** the curated set
> `{succeeded, failed, cancelled, stopped, completed, error}`, raise it as a
> follow-up — the curated set in `src/remoteExecution.ts` (TERMINAL_STATUSES)
> needs to grow._

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
| Signed off by:    | _____________               |
| Date:             | _____________               |
| Phase result:     | **PASS** / **FAIL** _(circle one)_ |
| Failing scenarios | _list IDs if FAIL, else "none"_ |
| Notes for follow-up | _free-form_               |

When `Phase result: PASS` is recorded, type `approved` in the GSD checkpoint
prompt to commit phase completion.
