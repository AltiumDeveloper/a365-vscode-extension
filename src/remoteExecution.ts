import * as vscode from 'vscode';

/**
 * Remote-script execution module.
 *
 * Plan 03-02 lands a stub that exercises the wiring (progress notification +
 * OutputChannel reveal) so right-click → Execute Remotely is observably
 * connected. Plan 03-04 replaces the body with the real flow per D-04 (async
 * mutation + 1.5 s status/log poll loop) WITHOUT changing the exported
 * signature — so this file is the only place 03-04 will need to touch.
 *
 * Decisions referenced:
 * - D-04 (resolved → D-04b async + poll, RESEARCH §D-04).
 * - D-09: OutputChannel singleton — caller passes it in via `args.output`;
 *   this module never calls `vscode.window.createOutputChannel`.
 * - D-10: cancellation = stop polling + write "(server-side execution
 *   continues)" to OutputChannel; no server cancel attempted (the API does
 *   not expose one).
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

export async function executeRemoteScript(args: ExecuteRemoteArgs): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
            title: `Altium 365: Executing ${args.scriptName}...`,
        },
        async (_progress, _token) => {
            args.output.show(true);
            args.output.appendLine(
                `\n[Altium 365] Execute Remotely: stub — real implementation lands in Plan 03-04 ` +
                    `(scriptId=${args.scriptId}, workspace=${args.workspaceName}).`
            );
        }
    );
}
