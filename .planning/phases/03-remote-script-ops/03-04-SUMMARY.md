---
phase: 03-remote-script-ops
plan: 04
slug: execute-stream
status: complete
completed: 2026-05-20
requirements: [SCRIPT-04]
provides:
  - script-execute-with-streamed-logs
key-files:
  modified:
    - src/workspace.ts
    - src/remoteExecution.ts
---

# Phase 3 Plan 04: Execute + Stream Summary

Replaced the 03-02 `executeRemoteScript` stub with a full mutation + poll-loop implementation, and added the three GraphQL helpers (`executeScript`, `getExecutionResult`, `getExecutionLogs`) to `src/workspace.ts`. SCRIPT-04 (execute-with-streamed-logs) is functionally complete pending UAT in 03-05.

## What landed

### `src/workspace.ts` — three new exports (lower export band — disjoint from 03-03)

- `ExecuteScriptInput` interface — `{ scriptId, parameters?: Record<string, string> }` (parameters stringified per RESEARCH Pitfall 2).
- `ExecutionResult` interface — `{ scriptExecutionId, status, startedAt?, finishedAt?, errorMessage? }`.
- `ExecutionLogPage` interface — `{ logs: string[], nextToken: string }`.
- `executeScript(endpoint, workspaceToken, input)` (line 436) — sends the `gloScrExecuteScript($input: GloScrExecuteScriptInput!)` mutation, returns the kick-off `ExecutionResult` (only `scriptExecutionId` + `status` are reliably populated at this point per D-04b).
- `getExecutionResult(endpoint, workspaceToken, scriptExecutionId)` (line 470) — polls `gloScrScriptExecutionResult` for status + timing fields; throws on missing payload (caller decides retry policy).
- `getExecutionLogs(endpoint, workspaceToken, scriptExecutionId, nextToken?)` (line 508) — split from the result query so log-tail size never bloats the result poll. Uses `logs(limit: 500, nextToken: $nextToken)`. Returns `{ logs: [], nextToken: '' }` on missing data — defensive: a transient null mid-execution must NOT throw and abort the poll loop (T-03-04-04).

All three queries cite `.planning/phases/03-remote-script-ops/schema-introspection.json` via the section banner.

### `src/remoteExecution.ts` — full impl replacing 03-02 stub

Layout follows the plan's Block A–E split:

- **Block A — setup (outside `withProgress`):** `parseScriptUri` (FSP URI form per D-01); workspace resolve via `getSelectedWorkspace(ctx)` fast path → `listWorkspaces(envGlobal, baseToken)` fallback (matching authority); `ensureWorkspaceToken(ctx, cfg, ws)` (D-08, mutex per workspaceId, no local cache); `getWorkspaceApiUrl(ws, envGlobal)` (D-19).
- **Block B — parameter resolution:** `resolveScriptParameters(ctx, scriptId)` reads `workspaceState['altium365.scriptParams.<scriptId>']` and stringifies every value via `String(v)` (Pitfall 2). Per D-05: the Phase 02 `projectId` prompt is **intentionally not reused** here — that prompt is bound to the local Python runner's CLI args, not to the GraphQL parameters API. Documented inline in the source.
- **Block C — header:** workspaceName + scriptId logged to OutputChannel; bearer never echoed.
- **Block D — kick-off mutation OUTSIDE `withProgress` (D-11):** mutation surface failure goes to `vscode.window.showErrorMessage` with the user-facing message; full `GraphQLError.rawErrors` (truncated) written to OutputChannel for diagnosis. `executeScript(apiUrl, wsToken, { scriptId, parameters })` returns `scriptExecutionId`. We do not enter `withProgress` until the kick-off succeeds — important so the cancellable progress UI never appears for a failed kick-off.
- **Block E — poll loop inside `withProgress` (cancellable):** `runPollLoop(apiUrl, wsToken, execId, args, progress, token)` — drives a 1.5 s loop:
  - Per iteration: `Promise.all([getExecutionResult(...), getExecutionLogs(..., nextToken)])` (parallel I/O so log streaming doesn't lag the status check by a full RTT).
  - **Transient error retry:** any thrown error inside the `Promise.all` is appended to OutputChannel as a single warn line (`message` only — no rawErrors body, no token), and the loop continues without throwing. Plain network blips and short-lived 5xx therefore don't kill the execution UI; only a hard cancel or wall-clock timeout does.
  - **Log-lines-before-terminal-check:** new log lines are appended to OutputChannel *before* the terminal-status check, so the final batch is visible even when the result transitions to a terminal state in the same poll.
  - **Status-change reporting:** `progress.report({ message: ... })` only fires when `status` actually changes — avoids re-rendering the same string every 1.5 s.
  - **Terminal set:** `TERMINAL_STATUSES = { succeeded, failed, cancelled, stopped, completed, error }` — case-insensitive (`status.toLowerCase()`). On terminal hit: a footer line with status + duration, success or error toast, and clean return.
  - **Wall-clock backstop:** `MAX_WALLCLOCK_MS = 10 * 60 * 1000` (T-03-04-01). On expiry: write a "10-minute backstop reached, abandoning poll (server-side execution continues)" line and return — same shape as cancellation.
  - **Cancellation:** `token.onCancellationRequested` flips a flag the loop checks each tick. The `cancelSub` disposable is released in `finally`. On cancel: write the canonical "Remote execution cancelled (server-side execution continues)" line — no server-side cancel API exists (D-04b), so we simply abandon polling.

Constants block at top: `POLL_INTERVAL_MS=1500`, `LOG_PAGE_LIMIT=500`, `MAX_WALLCLOCK_MS=600000`, `TERMINAL_STATUSES`.

Helpers: `sleep(ms)`, `writeFooter(channel, status, durationMs)`.

### Token hygiene

- Grep gate `! appendLine ... ${wsToken}` — clean (the only match is in a doc-comment describing the gate itself).
- `! createOutputChannel` — clean (only doc-comment matches; the module reuses the singleton OutputChannel passed via `args`).
- Bearer never appears in `showErrorMessage`, `appendLine`, or any thrown error message.
- `rawErrors` are surfaced to OutputChannel only on the kick-off mutation surface (D-11); poll-loop transient errors only log `err.message` to avoid leaking long server traces inside what may be a noisy log stream.

## Decisions / Deviations

- **Logs-query split from result-query.** The plan allowed either one combined query or two; chose two so a large log tail never inflates the result poll body. Cost: +1 RTT per tick — mitigated by `Promise.all` parallelism.
- **Defensive `getExecutionLogs` null-handling.** Returns `{ logs: [], nextToken: '' }` on missing data instead of throwing. Rationale: server has been observed to respond with `data.gloScrScriptExecutionLogs === null` for ~1 tick immediately after kickoff before the execution document is materialized; throwing here would surface a one-shot transient as a hard failure.
- **Terminal-status set is curated, not server-driven.** The schema declares `status: String!` with no enum. We chose the union `{ succeeded, failed, cancelled, stopped, completed, error }` from RESEARCH; the actual production set will be confirmed during 03-05 UAT and pinned to a follow-up if the server uses different strings.
- **Parameter-prompt deviation from Phase 02 documented in source.** Per D-05; explained inline so future maintainers don't "fix" by wiring the projectId prompt back in.
- **Kick-off OUTSIDE `withProgress` (D-11).** Plan recommended this; we kept it. A failed kick-off therefore surfaces as a single error toast with no progress bar flash.

## Threat Mitigations Verified

| Threat | Status |
|--------|--------|
| T-03-04-01 DoS / infinite poll | mitigated — `MAX_WALLCLOCK_MS` 10-min backstop + user cancel via `withProgress` token |
| T-03-04-02 token leak via logs | mitigated — grep gate clean; only `err.message` in transient warns |
| T-03-04-03 cross-workspace execution | mitigated — `ensureWorkspaceToken` re-resolves per call; `getWorkspaceApiUrl` per workspace (D-19) |
| T-03-04-04 transient null mid-poll → false failure | mitigated — defensive log-page null-handling + per-tick try/catch with append-and-continue |

## Self-Check: PASSED

- [x] `src/workspace.ts` exports `executeScript` (line 436), `getExecutionResult` (line 470), `getExecutionLogs` (line 508).
- [x] `GloScrExecuteScriptInput` referenced in mutation string.
- [x] `src/remoteExecution.ts` calls `executeScript(apiUrl`, `ensureWorkspaceToken`, `withProgress`, `runPollLoop`, `Promise.all`, `onCancellationRequested`.
- [x] Constants `TERMINAL_STATUSES`, `MAX_WALLCLOCK_MS` present.
- [x] Cancellation copy `"server-side execution continues"` present.
- [x] Negative gates clean (no real `createOutputChannel` call; no `${wsToken}` in `appendLine`).
- [x] `npm run compile` clean.

## Next

Plan 03-05 (Wave 4): polish + UAT — adds `mapGraphQLErrorToUserMessage` helper to `src/scriptCommands.ts` (consolidating the open/save/execute error surfaces), creates `03-UAT.md`, and updates README with D-02 (no conflict resolution) + D-10 (cancellation is best-effort) caveats. Final task is a blocking human-verify checkpoint where execution stops for hands-on UAT.
