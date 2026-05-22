import * as vscode from 'vscode';
import {
    ensureWorkspaceToken,
    getBaseAccessToken,
    readOAuthConfig,
} from './auth';
import {
    executeScript,
    ExecutionResult,
    getExecutionLogs,
    getExecutionResult,
    getSelectedWorkspace,
    getWorkspaceApiUrl,
    GraphQLError,
    listWorkspaces,
    WorkspaceInfo,
} from './workspace';
import { withScriptProgress } from './progress';

/**
 * Remote-script execution module.
 *
 * Phase 3 Plan 03-04 lands the real flow per D-04b (async mutation + 1.5 s
 * status/log poll loop). The exported signature is unchanged from the 03-02
 * stub so `scriptCommands.ts` wiring is untouched.
 *
 * Decisions referenced:
 * - D-04b: async — `gloScrExecuteScript` returns a `scriptExecutionId`;
 *   client polls `gloScrScriptExecutionResult` for status + logs every
 *   1.5 s with a 10-min wall-clock backstop.
 * - D-05: parameters resolved from `workspaceState['altium365.scriptParams.<id>']`
 *   (per-workspace per-script cache populated by future settings UI), else
 *   the same projectId-prompt used by `runScript`. All values are stringified
 *   (RESEARCH §Pitfall 2 — `GloScrScriptParameterInput.value: String!`).
 * - D-08: token resolved once per execution via `ensureWorkspaceToken` (mutex,
 *   per-workspace). Long executions across env-switches are documented as
 *   undefined-behavior in the Phase 3 README.
 * - D-09: OutputChannel singleton — caller passes it in via `args.output`;
 *   this module never calls `vscode.window.createOutputChannel`.
 * - D-10: cancellation = stop polling + write
 *   "(server-side execution continues)" to OutputChannel; no server cancel
 *   attempted (the API does not expose one).
 * - D-11: kick-off mutation failure routes through the user-friendly
 *   `showErrorMessage` + full body to OutputChannel.
 * - D-19: every GraphQL call goes through `getWorkspaceApiUrl(ws,
 *   envGlobalEndpoint)` — workspace-cluster routing.
 *
 * Threat mitigations:
 * - T-03-04-01 (DoS / infinite poll): `MAX_WALLCLOCK_MS` 10-min backstop +
 *   curated terminal set + observed-status logging so UAT can tighten the set.
 * - T-03-04-02 (token leak): grep gate `! appendLine ... ${wsToken}`.
 * - T-03-04-04 (parameter type injection): all values stringified via
 *   `String(v)` before send.
 */

export interface ExecuteRemoteArgs {
    context: vscode.ExtensionContext;
    output: vscode.OutputChannel;
    workspaceId: string;
    workspaceAuthId: string;
    scriptId: string;
    scriptName: string;
    workspaceName: string;
    envGlobalEndpoint: string;
}

const POLL_INTERVAL_MS = 1500;
const LOG_PAGE_LIMIT = 500;
const MAX_WALLCLOCK_MS = 10 * 60 * 1000;
// Status values are `String!` per schema (not an enum) — terminal set
// curated empirically. Observed during UAT 2026-05-20:
//   non-terminal: "Pending" (queued), "Running" (active)
//   terminal:     "Stopped" (normal completion path observed)
// Other strings below are defensive guesses for failure / cancel modes
// we have not yet exercised — they cost nothing if the server never emits
// them. Every observed status is logged via `[Altium 365] status=...` so
// any unknown terminal surfaces immediately and we can tighten this set
// fix-forward.
const TERMINAL_STATUSES = new Set<string>([
    'stopped',     // observed UAT 2026-05-20
    'succeeded',   // defensive
    'failed',      // defensive
    'cancelled',   // defensive
    'completed',   // defensive
    'error',       // defensive
]);

export async function executeRemoteScript(args: ExecuteRemoteArgs): Promise<void> {
    // ----- Block A + B: setup wrapped in withScriptProgress (D-01c, D-10) -----
    type SetupResult = {
        ws: WorkspaceInfo;
        wsToken: string;
        apiUrl: string;
        parameters: ReturnType<typeof resolveScriptParameters>;
    };
    const setup = await withScriptProgress<SetupResult | undefined>(
        `Preparing to execute ${args.scriptName}...`,
        async (signal) => {
            const cfg = readOAuthConfig();

            let ws: WorkspaceInfo | undefined = getSelectedWorkspace(args.context);
            if (!ws || ws.workspaceId !== args.workspaceId) {
                // Fall back to a fresh listWorkspaces — rare path (editor-title
                // button pressed against a script whose workspace is not the
                // currently selected one).
                try {
                    const baseToken = await getBaseAccessToken(args.context, cfg);
                    if (!baseToken) {
                        vscode.window.showErrorMessage(
                            'Altium 365: Execute Remotely failed: not signed in.'
                        );
                        return undefined;
                    }
                    const list = await listWorkspaces(args.envGlobalEndpoint, baseToken);
                    ws = list.find((w) => w.workspaceId === args.workspaceId);
                } catch (e) {
                    const err = e as Error;
                    args.output.appendLine(
                        '[Altium 365] Execute Remotely failed (workspace lookup): ' + err.message
                    );
                    vscode.window.showErrorMessage(
                        'Altium 365: Execute Remotely failed: ' + err.message
                    );
                    return undefined;
                }
            }
            if (!ws) {
                vscode.window.showErrorMessage(
                    'Altium 365: Execute Remotely failed: workspace not found ' +
                        '(refresh the side panel).'
                );
                return undefined;
            }

            if (signal.aborted) {
                return undefined;
            }

            let wsToken: string;
            try {
                wsToken = await ensureWorkspaceToken(args.context, cfg, {
                    workspaceId: args.workspaceId,
                    authId: args.workspaceAuthId || ws.authId,
                });
            } catch (e) {
                const err = e as Error;
                args.output.appendLine(
                    '[Altium 365] Execute Remotely failed (token exchange): ' + err.message
                );
                vscode.window.showErrorMessage(
                    'Altium 365: Execute Remotely failed: ' + err.message
                );
                return undefined;
            }
            const apiUrl = getWorkspaceApiUrl(ws, args.envGlobalEndpoint);

            // ----- Block B: parameters (D-05) -----
            const parameters = resolveScriptParameters(args.context, args.scriptId);

            return { ws, wsToken, apiUrl, parameters };
        },
        { cancellable: true },
    );
    if (!setup) {
        // Either user cancelled the spinner (silent return per D-04) or one
        // of the four early-return-with-toast arms above already surfaced
        // its own message.
        return;
    }
    const { ws, wsToken, apiUrl, parameters } = setup;

    // ----- Block C: OutputChannel header (D-09) -----
    args.output.show(true);
    args.output.appendLine(
        `\n[Altium 365] Executing ${args.scriptName} ` +
            `(scriptId=${args.scriptId}, workspace=${args.workspaceName})`
    );

    // ----- Block D: kick-off mutation (D-11 surface OUTSIDE withProgress) -----
    let execId: string;
    try {
        const r = await executeScript(apiUrl, wsToken, {
            scriptId: args.scriptId,
            parameters,
        });
        execId = r.scriptExecutionId;
        args.output.appendLine(
            `[Altium 365] Execution started: scriptExecutionId=${execId} ` +
                `(initial status=${r.status})`
        );
    } catch (e) {
        const err = e as Error & { rawErrors?: unknown[] };
        args.output.appendLine(
            '[Altium 365] Execute Remotely failed (kick-off): ' + err.message
        );
        if (err instanceof GraphQLError && err.rawErrors) {
            try {
                args.output.appendLine(
                    '[Altium 365]   GraphQL errors: ' +
                        JSON.stringify(err.rawErrors).slice(0, 1000)
                );
            } catch {
                // ignore
            }
        }
        vscode.window.showErrorMessage(
            'Altium 365: Execute Remotely failed: ' + err.message
        );
        return;
    }

    // ----- Block E: poll loop inside withProgress (cancellable) -----
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
            title: `Altium 365: Executing ${args.scriptName}...`,
        },
        (progress, token) => runPollLoop(apiUrl, wsToken, execId, args, progress, token)
    );
}

/**
 * Resolve parameters per D-05 priority chain:
 *   1. `workspaceState['altium365.scriptParams.<scriptId>']` — if set, all
 *      values are stringified (Pitfall 2).
 *   2. Otherwise undefined — server uses script defaults. The 02-phase
 *      projectId-prompt is intentionally NOT reused here for the v1 remote
 *      execution flow: the prompt is bound to the local Python runner's
 *      input_parameters convention, not to GloScrExecuteScript parameters.
 *      A future settings UI will populate the workspaceState entry above
 *      (deferred — out of scope for v1; tracked in backlog).
 */
function resolveScriptParameters(
    ctx: vscode.ExtensionContext,
    scriptId: string
): Array<{ key: string; value: string }> | undefined {
    const cached = ctx.workspaceState.get<Record<string, unknown>>(
        'altium365.scriptParams.' + scriptId
    );
    if (!cached || typeof cached !== 'object') {
        return undefined;
    }
    const out: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(cached)) {
        // Stringify every value — Pitfall 2: `GloScrScriptParameterInput.value: String!`.
        if (value === undefined || value === null) {
            continue;
        }
        out.push({ key, value: String(value) });
    }
    return out.length > 0 ? out : undefined;
}

async function runPollLoop(
    apiUrl: string,
    wsToken: string,
    execId: string,
    args: ExecuteRemoteArgs,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<void> {
    let nextToken: string | null = null;
    let cancelled = false;
    const cancelSub = token.onCancellationRequested(() => {
        cancelled = true;
    });
    const startedAt = Date.now();
    let lastStatus = '';

    try {
        while (!cancelled) {
            if (Date.now() - startedAt > MAX_WALLCLOCK_MS) {
                args.output.appendLine(
                    '[Altium 365] Remote execution backstop reached (10 min) — abandoning poll.'
                );
                return;
            }

            let result: ExecutionResult | undefined;
            let logPage: { logs: string[]; nextToken: string } | undefined;
            try {
                [result, logPage] = await Promise.all([
                    getExecutionResult(apiUrl, wsToken, execId),
                    getExecutionLogs(apiUrl, wsToken, execId, LOG_PAGE_LIMIT, nextToken),
                ]);
            } catch (e) {
                const err = e as Error;
                args.output.appendLine(
                    '[Altium 365] poll tick failed (will retry): ' + err.message
                );
                await sleep(POLL_INTERVAL_MS);
                continue;
            }

            // Log lines BEFORE the terminal-check so that the final batch is
            // rendered even on the same tick the status flips terminal.
            for (const line of logPage.logs) {
                args.output.appendLine(line);
            }
            if (logPage.nextToken) {
                nextToken = logPage.nextToken;
            }

            if (result.status !== lastStatus) {
                progress.report({ message: result.status });
                lastStatus = result.status;
                args.output.appendLine('[Altium 365] status=' + result.status);
            }

            if (TERMINAL_STATUSES.has(result.status.toLowerCase())) {
                writeFooter(args.output, result);
                return;
            }

            await sleep(POLL_INTERVAL_MS);
        }

        // Cancellation path (D-10).
        args.output.appendLine(
            '[Altium 365] Remote execution cancelled (server-side execution continues)'
        );
    } finally {
        cancelSub.dispose();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function writeFooter(out: vscode.OutputChannel, r: ExecutionResult): void {
    const exit =
        r.exitCode === null || r.exitCode === undefined ? 'ok' : String(r.exitCode);
    out.appendLine(
        `[Altium 365] Remote execution finished (status=${r.status}, exit=${exit})`
    );
    if (r.failureReason) {
        out.appendLine('[Altium 365] failureReason: ' + r.failureReason);
    }
}
