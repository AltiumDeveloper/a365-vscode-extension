import * as vscode from 'vscode';
import {
    ensureWorkspaceToken,
    getBaseAccessToken,
    readOAuthConfig,
} from '../auth';
import {
    executeScript,
    executeAssignment,
    type ExecutionResult,
    getExecutionLogs,
    getExecutionResult,
    getSelectedWorkspace,
    getWorkspaceApiUrl,
    GraphQLError,
    listWorkspaces,
    type WorkspaceInfo,
} from '../workspace';
import { withScriptProgress } from '../runner/progress';
import { resolveScriptParameters } from '../testEvents/resolver';
import { dedupLogPage } from '../shared/logDedup';

/**
 * Remote-script execution module.
 *
 * - Execution is async: `gloScrExecuteScript` returns a `scriptExecutionId` and
 *   the client polls `gloScrScriptExecutionResult` for status + logs every
 *   1.5 s, with a 10-minute wall-clock backstop against an infinite poll.
 * - Parameters resolve through `resolveScriptParameters`, the same code path as
 *   the local Python runner's `prepareRun`. The per-script test-event store
 *   lives in `globalState` keyed by `altium365.scriptParams.<identity>` and is
 *   owned by ./testEvents/store.ts. Values are stringified inside the resolver
 *   because `GloScrScriptParameterInput.value` is `String!`.
 * - The token is resolved once per execution via `ensureWorkspaceToken`.
 *   Behaviour of a long execution across an environment switch is undefined.
 * - The OutputChannel is passed in via `args.output`; this module never calls
 *   `vscode.window.createOutputChannel`. The workspace token is never written
 *   to it.
 * - Cancellation stops polling and writes "(server-side execution continues)";
 *   no server-side cancel is attempted because the API does not expose one.
 * - Every GraphQL call goes through `getWorkspaceApiUrl(ws, envGlobalEndpoint)`
 *   for workspace-cluster routing.
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
    /** Optional: if provided, executes via gloCusExecuteAssignment instead of gloScrExecuteScript */
    assignmentId?: string;
}

const POLL_INTERVAL_MS = 1500;
const LOG_PAGE_LIMIT = 500;
const MAX_WALLCLOCK_MS = 10 * 60 * 1000;
// Status values are `String!` per schema (not an enum) — terminal set
// curated empirically. Observed 2026-05-20:
//   non-terminal: "Pending" (queued), "Running" (active)
//   terminal:     "Stopped" (normal completion path observed)
// Other strings below are defensive guesses for failure / cancel modes
// we have not yet exercised — they cost nothing if the server never emits
// them. Every observed status is logged via `[Altium 365] status=...` so
// any unknown terminal surfaces immediately and we can tighten this set
// fix-forward.
const TERMINAL_STATUSES = new Set<string>([
    'stopped',     // observed 2026-05-20
    'succeeded',   // defensive
    'failed',      // defensive
    'cancelled',   // defensive
    'completed',   // defensive
    'error',       // defensive
]);

export async function executeRemoteScript(args: ExecuteRemoteArgs): Promise<void> {
    // ----- Block A + B: setup wrapped in withScriptProgress -----
    type SetupResult = {
        ws: WorkspaceInfo;
        wsToken: string;
        apiUrl: string;
        parameters: Awaited<ReturnType<typeof resolveScriptParameters>>;
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
            // Block C reads args.workspaceName, so refresh it here or a
            // cross-workspace remote execute logs '<workspace-name unknown>'.
            if (ws.name && ws.name !== args.workspaceName) {
                args.workspaceName = ws.name;
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

            // ----- Block B: parameters -----
            // Same resolver as prepareRun. Sibling import and silent-default
            // semantics live inside resolveScriptParameters.
            const parameters = await resolveScriptParameters(
                args.context,
                { kind: 'remote', identity: args.scriptId },
                args.output,
                { promptOnFirstRun: true },
            );

            return { ws, wsToken, apiUrl, parameters };
        },
        { cancellable: true },
    );
    if (!setup) {
        // Either the user cancelled the spinner — a silent return — or one of
        // the early-return-with-toast arms above already surfaced its message.
        return;
    }
    const { ws: _ws, wsToken, apiUrl, parameters } = setup;

    // ----- Block C: OutputChannel header -----
    args.output.show(true);
    const executionType = args.assignmentId ? 'assignment' : 'script';
    args.output.appendLine(
        `\n[Altium 365] Executing ${executionType} ${args.scriptName} ` +
            `(scriptId=${args.scriptId}${args.assignmentId ? `, assignmentId=${args.assignmentId}` : ''}, workspace=${args.workspaceName})`
    );

    // ----- Block D: kick-off mutation, surfaced OUTSIDE withProgress -----
    let execId: string;
    try {
        let r: { scriptExecutionId: string; status: string };
        if (args.assignmentId) {
            // Execute via assignment — the correct way to trigger extension points
            r = await executeAssignment(apiUrl, wsToken, {
                assignmentId: args.assignmentId,
                parameters,
            });
        } else {
            // Legacy: Execute script directly
            r = await executeScript(apiUrl, wsToken, {
                scriptId: args.scriptId,
                parameters,
            });
        }
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

async function runPollLoop(
    apiUrl: string,
    wsToken: string,
    execId: string,
    args: ExecuteRemoteArgs,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<void> {
    let printedCount = 0;
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
                    getExecutionLogs(apiUrl, wsToken, execId, LOG_PAGE_LIMIT, null),
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
            // Server re-sends overlapping pages each poll; dedupLogPage slices
            // off the already-printed prefix using printedCount as the cursor.
            const { fresh, newPrintedCount } = dedupLogPage(logPage.logs, printedCount);
            for (const line of fresh) {
                args.output.appendLine(line);
            }
            printedCount = newPrintedCount;

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

        // Cancellation path.
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
