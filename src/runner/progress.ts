import * as vscode from 'vscode';

/**
 * Runs `op` inside a `vscode.window.withProgress` notification with the
 * Altium 365 brand title prefix. Returns whatever `op` resolves to, or
 * `undefined` if `op` throws after the user cancels (when `opts.cancellable` is true).
 *
 * Title format is `Altium 365: ${label}` — callers supply any trailing
 * punctuation (e.g. `'Open Script: loading...'`). The helper never
 * appends an ellipsis automatically.
 *
 * Cancellation (cooperative — v1):
 *   The `AbortSignal` passed to `op` is cooperative only, and the helper
 *   waits for `op` to settle, so the notification stays up until it does.
 *   The project's network helpers (`graphqlRequest`, `ensureWorkspaceToken`,
 *   and the `vscode.workspace.fs` FileSystemProvider readFile/writeFile
 *   paths) do NOT accept an `AbortSignal`, so an in-flight request started
 *   before cancel runs to completion first. Callers MAY inspect
 *   `signal.aborted` between awaits to skip downstream work.
 *
 * Error handling: non-cancel errors thrown by `op` are
 * re-thrown unchanged so caller-level `try/catch` + `outputChannel`
 * + `showErrorMessage` keep working. Only cancellation is swallowed.
 */
export async function withScriptProgress<T>(
    label: string,
    op: (signal: AbortSignal, progress: vscode.Progress<{ message?: string }>) => Promise<T>,
    opts?: { cancellable?: boolean },
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
                return await op(controller.signal, progress);
            } catch (e) {
                if (controller.signal.aborted) {
                    return undefined;
                }
                throw e;
            } finally {
                sub?.dispose();
            }
        },
    );
}
