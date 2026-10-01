import * as vscode from 'vscode';
import { resolveConfig } from '../config';
import { resolveScriptIdentity } from '../testEvents/identity';
import { getSelectedWorkspace, resolveWorkspaceFromAuthId, type WorkspaceInfo } from '../workspace';
import { promptSecretValue, readLocalSecrets, writeLocalSecrets } from '.';

export function registerSecretCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('altium365.secrets.set', () =>
            withErrorBoundary('set', () => doSetSecret(context))
        ),
        vscode.commands.registerCommand('altium365.secrets.clear', () =>
            withErrorBoundary('clear', () => doClearSecrets(context))
        ),
    ];
}

async function withErrorBoundary(cmd: string, run: () => Promise<void>): Promise<void> {
    try {
        await run();
    } catch (e) {
        vscode.window.showErrorMessage(`Altium 365: secrets.${cmd} failed — ${(e as Error).message}`);
    }
}

/** The active remote script's workspace, otherwise the selected workspace. */
async function targetWorkspace(context: vscode.ExtensionContext): Promise<WorkspaceInfo | undefined> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const identity = uri ? resolveScriptIdentity(uri) : undefined;
    const ws =
        identity?.kind === 'remote' && identity.workspaceAuthId
            ? await resolveWorkspaceFromAuthId(context, identity.workspaceAuthId, resolveConfig().graphqlEndpoint)
            : getSelectedWorkspace(context);
    if (!ws) {
        vscode.window.showErrorMessage('Altium 365: select a workspace first.');
    }
    return ws;
}

async function doSetSecret(context: vscode.ExtensionContext): Promise<void> {
    const ws = await targetWorkspace(context);
    if (!ws) {
        return;
    }
    const stored = await readLocalSecrets(context, ws.workspaceId);
    const picked = await vscode.window.showQuickPick(
        [
            ...Object.keys(stored).sort().map((name) => ({ label: name, name })),
            { label: '$(add) New secret…', name: undefined },
        ],
        { placeHolder: `Local secret to set for ${ws.name}` }
    );
    if (!picked) {
        return;
    }
    const name =
        picked.name ??
        (await vscode.window.showInputBox({
            prompt: 'Secret name, as passed to context.get_secret()',
            validateInput: (v) => (v.trim() ? undefined : 'Enter a name'),
        }))?.trim();
    if (!name) {
        return;
    }
    const value = await promptSecretValue(name, ws.name);
    if (value === undefined) {
        return;
    }
    await writeLocalSecrets(context, ws.workspaceId, { ...stored, [name]: value });
    vscode.window.showInformationMessage(`Altium 365: local secret "${name}" saved for ${ws.name}.`);
}

async function doClearSecrets(context: vscode.ExtensionContext): Promise<void> {
    const ws = await targetWorkspace(context);
    if (!ws) {
        return;
    }
    const stored = await readLocalSecrets(context, ws.workspaceId);
    const names = Object.keys(stored).sort();
    if (names.length === 0) {
        vscode.window.showInformationMessage(`Altium 365: no local secrets stored for ${ws.name}.`);
        return;
    }
    const picked = await vscode.window.showQuickPick(names, {
        canPickMany: true,
        placeHolder: `Local secrets to clear for ${ws.name}`,
    });
    if (!picked?.length) {
        return;
    }
    for (const name of picked) {
        delete stored[name];
    }
    await writeLocalSecrets(context, ws.workspaceId, stored);
    vscode.window.showInformationMessage(`Altium 365: cleared ${picked.length} local secret(s) for ${ws.name}.`);
}
