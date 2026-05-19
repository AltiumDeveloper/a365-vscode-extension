import * as vscode from 'vscode';

/**
 * Registers the four `altium365.script.*` commands declared in package.json so
 * the right-click menu items contributed by Plan 02-03 never error with
 * "command not found" (RESEARCH.md Pitfall 7, threat T-02-06-09).
 *
 * Plan 02-06 Task 1 (the blocking human-verify of the A365 file-download
 * endpoint A1 + the "single .py vs archive" question A2) returned BLOCKED:
 * a live A365 workspace was unavailable to confirm the endpoint pattern and
 * package format. Per the BLOCKED branch of Task 3's acceptance criteria,
 * `altium365.script.runLocal` is therefore registered as a Phase 3 placeholder
 * alongside `edit`, `executeRemote`, and `publish`. SCRIPT-01 and D-09 are
 * deferred to Phase 3, where the endpoint can be verified against a live
 * workspace and `fetchScriptBody` + `runLocalFromScriptNode` implemented.
 *
 * The `runScriptAtPath` helper extracted in Task 2 is intentionally still
 * available for Phase 3 to consume — the refactor stands on its own and is
 * behaviour-preserving for the existing editor-toolbar commands.
 */
export function registerScriptCommands(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    void context;
    void output;

    const placeholder = (label: string) => () =>
        vscode.window.showInformationMessage(
            `Altium 365: ${label} — coming in Phase 3.`
        );

    return [
        // BLOCKED branch: runLocal is a placeholder until Phase 3 confirms the
        // A365 file-download endpoint (RESEARCH.md Assumption A1) and the
        // "single .py vs archive" package format (Assumption A2).
        vscode.commands.registerCommand(
            'altium365.script.runLocal',
            placeholder('Run Script (Local)')
        ),
        vscode.commands.registerCommand(
            'altium365.script.edit',
            placeholder('Edit Script')
        ),
        vscode.commands.registerCommand(
            'altium365.script.executeRemote',
            placeholder('Execute Script Remotely')
        ),
        vscode.commands.registerCommand(
            'altium365.script.publish',
            placeholder('Publish Script')
        ),
    ];
}
