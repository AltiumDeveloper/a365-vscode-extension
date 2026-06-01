import * as vscode from 'vscode';
import { getSelectedWorkspace, listProjects, WorkspaceInfo } from '../workspace';

/**
 * Prompts the user to pick a projectId. Returns:
 *   - the picked id (string, possibly empty if user chose "no parameters")
 *   - undefined if the user cancelled
 *
 * D-08 (Phase 6): accepts an optional `target` workspace so cross-workspace
 * remote execute (and any caller acting on a non-active workspace's script)
 * can label the QuickPick with the target workspace's name instead of the
 * currently-active one, and load the project list against the target's
 * endpoint + scoped token (caller-supplied via `endpoint` + `accessToken`).
 *
 * Extracted from `extension.ts` to break a circular import risk
 * (remoteExecution → extension → remoteExecution chain). The optional
 * `output` channel decouples this module from `extension.ts`'s singleton —
 * callers that want error logging may pass their own channel; otherwise
 * the catch path silently falls through to the manual-input UI (preserving
 * the original behavior of the single existing caller).
 */
export async function pickProjectId(
    context: vscode.ExtensionContext,
    endpoint: string,
    accessToken: string,
    last: string,
    target?: WorkspaceInfo,
    output?: vscode.OutputChannel
): Promise<string | undefined> {
    type Item = vscode.QuickPickItem & { value?: string; manual?: boolean };
    const wsName = (target ?? getSelectedWorkspace(context))?.name || '-';

    const projects = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Loading projects from "${wsName}"...`,
        },
        async () => {
            try {
                return await listProjects(endpoint, accessToken);
            } catch (e) {
                output?.appendLine(
                    `[Altium 365] Failed to list projects: ${(e as Error).message}`
                );
                return undefined;
            }
        }
    );

    if (!projects) {
        // Fallback to manual input
        const entered = await vscode.window.showInputBox({
            prompt: `Enter projectId (workspace: ${wsName}) — could not list projects`,
            placeHolder: 'Leave empty to run without input_parameters',
            value: last,
            ignoreFocusOut: true,
        });
        return entered === undefined ? undefined : entered.trim();
    }

    const items: Item[] = [];
    items.push({
        label: '$(edit) Enter project id manually...',
        manual: true,
    });
    items.push({
        label: '$(circle-slash) No input_parameters',
        description: 'Run without projectId',
        value: '',
    });
    if (projects.length > 0) {
        items.push({ label: 'Projects', kind: vscode.QuickPickItemKind.Separator });
        const sorted = [...projects].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '')
        );
        for (const p of sorted) {
            items.push({
                label: p.name || '(no name)',
                description: p.id,
                detail: p.id === last ? 'last used' : undefined,
                value: p.id,
            });
        }
    }

    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `Pick a project for input_parameters (workspace: ${wsName})`,
        matchOnDescription: true,
        ignoreFocusOut: true,
    });
    if (!pick) {
        return undefined;
    }
    if (pick.manual) {
        const entered = await vscode.window.showInputBox({
            prompt: `Enter projectId (workspace: ${wsName})`,
            value: last,
            ignoreFocusOut: true,
        });
        return entered === undefined ? undefined : entered.trim();
    }
    return pick.value ?? '';
}
