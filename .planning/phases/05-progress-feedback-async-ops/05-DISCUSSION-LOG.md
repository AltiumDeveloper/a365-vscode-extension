# Phase 05: Progress Feedback for Async Operations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 05-progress-feedback-async-ops
**Areas discussed:** Coverage scope, Cancellation policy, Cancel UX, Helper vs raw calls, Location convention, Threshold

---

## Coverage scope

| Option | Description | Selected |
|--------|-------------|----------|
| All four mandatory + downloadScriptToTmp helper | Wrap downloadScriptToTmp (covers edit/runLocal/debugLocal), publishScript save bridge, executeRemoteScript Block A setup. Skip tree expansion and selectWorkspace token exchange. | ✓ |
| Mandatory + downloadScriptToTmp + tree expansion | Above PLUS wrap listProjects/listScripts on workspace expand. | |
| Everything network/IO >200ms | Add token exchange, env refresh, sign-out cleanup, refresh-token. Maximum coverage. | |

**User's choice:** Recommended option — four call sites only.
**Notes:** Keeps scope tight to ROADMAP success criteria. Tree expansion intentionally deferred — it's a different UX class (Notification on chevron click is intrusive).

---

## Cancellation policy

| Option | Description | Selected |
|--------|-------------|----------|
| Edit/Run/Debug + executeRemote setup cancellable; publish not | Pre-action work is cancellable (no server state). Publish stays non-cancellable — mid-mutation cancel is worse than completed write. | ✓ |
| Only download is cancellable | ExecuteRemote setup is fast; no second cancel point. | |
| All cancellable | Even publish — log warning and let server-side consistency settle (D-02 last-write-wins). | |

**User's choice:** Recommended option.
**Notes:** Aligns with Phase 3 D-02 (last-write-wins) — mid-mutation cancel is the worst outcome, not best.

---

## Cancel UX

| Option | Description | Selected |
|--------|-------------|----------|
| Silent return + cleanup partial tmp file | Abort fetch, return undefined, delete partial tmp. No toast. | ✓ |
| Info toast + cleanup | Show "Action cancelled" toast for explicit feedback. | |
| Silent return, no cleanup | Skip the unlink; OS tmpdir hygiene handles it. | |

**User's choice:** Recommended option.
**Notes:** User explicitly clicked cancel — confirmation toast is noise. Cleanup is best-effort (swallow unlink errors to OutputChannel).

---

## Helper vs raw calls

| Option | Description | Selected |
|--------|-------------|----------|
| Tiny helper module (src/progress.ts) | New `withScriptProgress<T>(label, op, opts?)` enforcing location/title/AbortController wiring. ~30 LoC, removes ~60 LoC duplication. | ✓ |
| Raw calls at each site | Inline `vscode.window.withProgress(...)` at three sites. Verbose but no abstraction. | |
| Local helper in scriptCommands.ts only | 15-line local helper used by script commands; executeRemote uses raw inline. | |

**User's choice:** Recommended option.
**Notes:** Helper signature locked in CONTEXT.md D-05. Existing four `withProgress` sites (sign-in, project picker, exec poll, deps install) NOT migrated this phase — chore for later (D-07).

---

## Location convention

| Option | Description | Selected |
|--------|-------------|----------|
| Notification everywhere in scope | Matches existing convention (sign-in, project picker, exec poll, deps install all use Notification). Cancel button prominent. | ✓ |
| Notification for cancellable, Window for non-cancellable | Status-bar spinner for publish; Notification for the rest. | |
| Window everywhere | Quietest option; cancel button less discoverable. | |

**User's choice:** Recommended option.
**Notes:** "Split for ambient ops" question is moot for Phase 05 because no ambient ops (tree expand etc.) are in scope.

---

## Threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Always show — no threshold | Matches every existing withProgress site in codebase. Tiny flicker on sub-200ms ops accepted. | ✓ |
| 200ms threshold via setTimeout race | Only mount progress UI if op hasn't resolved in 200ms. Adds setTimeout + disposal complexity. | |
| Ship always-show, revisit if needed | Same outcome as option 1; explicit "revisit" framing. | |

**User's choice:** Recommended option.
**Notes:** VS Code has no built-in delay-show; implementing one is real complexity for marginal UX gain. Revisit only if dogfooding shows annoyance.

---

## The agent's Discretion

None — user picked the recommended option in every area, but each option was an explicit decision (not a "you decide").

## Deferred Ideas

- Tree expansion progress (different UX class — Window not Notification).
- Workspace token exchange progress during selectWorkspace.
- Migration of existing four `withProgress` sites to the new helper.
- 200ms delay-show threshold.
- Telemetry / timing hooks for slow ops.
- `withScriptProgress` test infrastructure (no test infra exists project-wide).
- Coordinating progress UI auto-reveal with OutputChannel auto-reveal.
- Folded the misnamed `2026-05-22-phase-05-candidates.md` todo into "Reviewed Todos (not folded)" — actual scope is a future phase. Recommended rename to remove `phase-05-` prefix.
