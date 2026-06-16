import * as vscode from 'vscode';
import { ensureWorkspaceToken, readOAuthConfig } from '../auth';
import { uploadAndGetToken } from '../scripts/filesService';
import { type A365Node } from './panel';
import { applyWorkspaceSelection } from './commands';
import { resolveConfig } from '../config';
import {
    addAssignment,
    createScript,
    GraphQLError,
    getWorkspaceApiUrl,
    getWorkspaceFilesUrl,
    type ExtensionPointParameterInfo,
    resolveWorkspaceFromAuthId,
    updateAssignment,
} from '../workspace';

/**
 * Safely open an http(s) URL supplied by the GraphQL backend in the user's
 * external browser. Rejects any other scheme (javascript:, file:, vscode:,
 * data:, ...) defensively — `vscode.Uri.parse` is permissive and would
 * otherwise hand a hostile or malformed backend URL to `openExternal`. See
 * WR-04 in 02.1-REVIEW.md.
 */
async function openExternalHttpUrl(
    url: string,
    output: vscode.OutputChannel,
    logTag: string
): Promise<void> {
    let parsed: vscode.Uri;
    try {
        parsed = vscode.Uri.parse(url, true);
    } catch (e) {
        const msg = (e as Error).message;
        vscode.window.showErrorMessage('Altium 365: malformed URL from server');
        output.appendLine(`[Altium 365] ${logTag} rejected malformed URL: ${msg}`);
        return;
    }
    if (parsed.scheme !== 'https' && parsed.scheme !== 'http') {
        vscode.window.showErrorMessage(
            `Altium 365: refusing to open non-http(s) URL (scheme: ${parsed.scheme})`
        );
        output.appendLine(
            `[Altium 365] ${logTag} rejected URL with scheme=${parsed.scheme}`
        );
        return;
    }
    await vscode.env.openExternal(parsed);
}

function defaultScriptName(node: Extract<A365Node, { kind: 'extensionPointNode' }>): string {
    const fromServer = node.extensionPoint.scriptName?.trim();
    if (fromServer) {
        return fromServer;
    }
    const base = node.extensionPoint.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return base ? `${base} Script` : 'New Extension Point Script';
}

function buildInitialScriptSource(node: Extract<A365Node, { kind: 'extensionPointNode' }>): Uint8Array {
    const source = node.extensionPoint.scriptText?.trimEnd();
    if (source) {
        return Buffer.from(`${source}\n`, 'utf8');
    }
    return Buffer.from(
        [
            'def onExecute(context, input_parameters):',
            '    return {}',
            '',
        ].join('\n'),
        'utf8'
    );
}

async function pickConfigurationParameterValue(
    parameter: ExtensionPointParameterInfo
): Promise<string | undefined> {
    if (parameter.predefinedValues.length > 0) {
        const items: Array<vscode.QuickPickItem & { value: string }> =
            parameter.predefinedValues.map((value) => ({
                label: value.displayText || value.value,
                description: value.displayText ? value.value : undefined,
                value: value.value,
            }));
        const picked = await vscode.window.showQuickPick(
            items,
            {
                title: 'Create Script',
                placeHolder: parameter.description || parameter.name,
            }
        );
        return picked?.value;
    }

    const value = await vscode.window.showInputBox({
        title: 'Create Script',
        prompt: parameter.description || parameter.name,
        placeHolder: parameter.name,
    });
    return value;
}

async function collectConfigurationParameters(
    parameters: ExtensionPointParameterInfo[]
): Promise<Array<{ name: string; value: string }> | undefined> {
    const values: Array<{ name: string; value: string }> = [];
    for (const parameter of parameters) {
        const value = await pickConfigurationParameterValue(parameter);
        if (value === undefined) {
            return undefined;
        }
        values.push({ name: parameter.name, value });
    }
    return values;
}

async function createScriptForExtensionPoint(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    node?: A365Node
): Promise<void> {
    if (!node || node.kind !== 'extensionPointNode') {
        output.appendLine(
            '[Altium 365] extensionPoint.createScript: ignored kind=' +
                (node?.kind ?? 'undefined')
        );
        return;
    }

    if (
        node.extensionPoint.supportedAssignmentTypes.length > 0 &&
        !node.extensionPoint.supportedAssignmentTypes.includes('SCRIPT')
    ) {
        vscode.window.showInformationMessage(
            'This extension point does not support script assignments.'
        );
        return;
    }

    const scriptName = await vscode.window.showInputBox({
        title: 'Create Script',
        prompt: 'Script name',
        value: defaultScriptName(node),
        validateInput: (value) => value.trim().length > 0 ? undefined : 'Enter a script name.',
    });
    if (scriptName === undefined) {
        return;
    }
    const trimmedName = scriptName.trim();

    const description = await vscode.window.showInputBox({
        title: 'Create Script',
        prompt: 'Description',
        value: node.extensionPoint.scriptDescription || `Script for ${node.extensionPoint.name}`,
    });
    if (description === undefined) {
        return;
    }
    const configurationParameters = await collectConfigurationParameters(
        node.extensionPoint.configurationParameters
    );
    if (configurationParameters === undefined) {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Altium 365: creating ${trimmedName}...`,
            cancellable: false,
        },
        async () => {
            const envGlobalEndpoint = resolveConfig().graphqlEndpoint;
            const workspace = await resolveWorkspaceFromAuthId(
                context,
                node.workspaceAuthId,
                envGlobalEndpoint
            );
            if (!workspace) {
                throw new Error('workspace not found (refresh the side panel)');
            }

            const workspaceToken = await ensureWorkspaceToken(context, readOAuthConfig(), {
                workspaceId: workspace.workspaceId,
                authId: workspace.authId,
            });
            const apiUrl = getWorkspaceApiUrl(workspace, envGlobalEndpoint);
            const filesUrl = getWorkspaceFilesUrl(workspace);
            const safeFileName = trimmedName.replace(/[^\w.-]+/g, '_') || 'script';
            const fileName = safeFileName.toLowerCase().endsWith('.py')
                ? safeFileName
                : `${safeFileName}.py`;
            const source = buildInitialScriptSource(node);

            const fileToken = await uploadAndGetToken(filesUrl, workspaceToken, source, {
                filename: fileName,
            });
            const script = await createScript(
                apiUrl,
                workspaceToken,
                trimmedName,
                fileToken,
                description.trim() || undefined
            );
            const assignment = await addAssignment(
                apiUrl,
                workspaceToken,
                node.extensionPoint.extensionPointId,
                configurationParameters
            );
            await updateAssignment(
                apiUrl,
                workspaceToken,
                assignment.assignmentId,
                script.scriptId,
                script.latestVersionId,
                trimmedName,
                description.trim() || undefined
            );

            output.appendLine(
                `[Altium 365] Created script ${script.scriptId} and assignment ${assignment.assignmentId} for extension point ${node.extensionPoint.extensionPointId}`
            );
            await vscode.commands.executeCommand('altium365.tree.refresh');

            const assignmentNode: A365Node = {
                kind: 'assignmentNode',
                workspaceId: workspace.workspaceId,
                workspaceAuthId: workspace.authId,
                workspaceUrl: workspace.url || node.workspaceUrl,
                extensionPointId: node.extensionPoint.extensionPointId,
                assignment: {
                    assignmentId: assignment.assignmentId,
                    name: trimmedName,
                    description: description.trim() || undefined,
                    type: 'SCRIPT',
                    active: true,
                    scriptId: script.scriptId,
                    scriptVersionId: script.latestVersionId,
                    scriptFileToken: fileToken,
                    createdAt: '',
                    createdBy: '',
                    lastModifiedAt: '',
                    lastModifiedBy: '',
                },
            };
            await vscode.commands.executeCommand('altium365.script.edit', assignmentNode);
        }
    ).then(
        () => vscode.window.showInformationMessage(`Altium 365: created ${trimmedName}.`),
        (e) => {
            const err = e as Error;
            output.appendLine(
                '[Altium 365] extensionPoint.createScript failed: ' +
                    (err.stack ?? err.message)
            );
            if (err instanceof GraphQLError) {
                try {
                    output.appendLine(
                        '[Altium 365]   GraphQL errors: ' +
                            JSON.stringify(err.rawErrors).slice(0, 1000)
                    );
                } catch {
                    // ignore stringify issues
                }
            }
            vscode.window.showErrorMessage('Altium 365: Create Script failed: ' + err.message);
        }
    );
}

/**
 * Hosts tree-generic (non-script-scoped) command handlers contributed by
 * Phase 02.1. Mirrors the `registerScriptCommands` factory shape per D-11 of
 * `.planning/phases/02.1-side-panel-ux/02.1-CONTEXT.md`.
 *
 * Currently registers `altium365.tree.copyId` (Plan 02.1-03). Future plans
 * (e.g. 02.1-05 Open in Browser) will add their handlers here alongside.
 */
export function registerTreeCommands(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(
            'altium365.extensionPoint.createScript',
            async (node?: A365Node) => createScriptForExtensionPoint(context, output, node)
        ),
        vscode.commands.registerCommand(
            'altium365.tree.copyId',
            async (node?: A365Node) => {
                if (!node) {
                    output.appendLine('[Altium 365] tree.copyId: ignored kind=undefined');
                    return;
                }
                let id: string | undefined;
                switch (node.kind) {
                    case 'workspace':
                        id = node.info.workspaceId;
                        break;
                    case 'project':
                        id = node.project.id;
                        break;
                    case 'script':
                        id = node.script.scriptId;
                        break;
                    case 'extensionPointNode':
                        id = node.extensionPoint.extensionPointId;
                        await vscode.env.clipboard.writeText(id);
                        vscode.window.showInformationMessage(
                            'Extension Point ID copied to clipboard.'
                        );
                        return;
                    case 'assignmentNode':
                        id = node.assignment.assignmentId;
                        await vscode.env.clipboard.writeText(id);
                        vscode.window.showInformationMessage(
                            'Assignment ID copied to clipboard.'
                        );
                        return;
                    default:
                        output.appendLine(
                            '[Altium 365] tree.copyId: ignored kind=' + node.kind
                        );
                        return;
                }
                if (!id) {
                    output.appendLine(
                        '[Altium 365] tree.copyId: no id on kind=' + node.kind
                    );
                    return;
                }
                try {
                    await vscode.env.clipboard.writeText(id);
                    vscode.window.showInformationMessage(
                        'Altium 365: ID copied to clipboard'
                    );
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Copy ID failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] tree.copyId failed: ' + (err.stack ?? err.message)
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            'altium365.workspace.openInBrowser',
            async (node?: A365Node) => {
                if (!node || node.kind !== 'workspace') {
                    output.appendLine(
                        '[Altium 365] workspace.openInBrowser: ignored kind=' +
                            (node?.kind ?? 'undefined')
                    );
                    return;
                }
                const url = node.url;
                if (!url) {
                    vscode.window.showInformationMessage(
                        'This workspace does not expose a browser URL'
                    );
                    return;
                }
                try {
                    await openExternalHttpUrl(url, output, 'workspace.openInBrowser');
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Open in Browser failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] workspace.openInBrowser failed: ' +
                            (err.stack ?? err.message)
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            'altium365.workspace.selectFromNode',
            async (node?: A365Node) => {
                if (!node || node.kind !== 'workspace') {
                    output.appendLine(
                        '[Altium 365] workspace.selectFromNode: ignored kind=' +
                            (node?.kind ?? 'undefined')
                    );
                    return;
                }
                try {
                    await applyWorkspaceSelection(context, node.info);
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Select Workspace failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] workspace.selectFromNode failed: ' +
                            (err.stack ?? err.message)
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            'altium365.project.openInBrowser',
            async (node?: A365Node) => {
                if (!node || node.kind !== 'project') {
                    output.appendLine(
                        '[Altium 365] project.openInBrowser: ignored kind=' +
                            (node?.kind ?? 'undefined')
                    );
                    return;
                }
                const url = node.url;
                if (!url) {
                    vscode.window.showInformationMessage(
                        'This project does not expose a browser URL'
                    );
                    return;
                }
                try {
                    await openExternalHttpUrl(url, output, 'project.openInBrowser');
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Open in Browser failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] project.openInBrowser failed: ' +
                            (err.stack ?? err.message)
                    );
                }
            }
        ),
        vscode.commands.registerCommand(
            'altium365.assignment.openInBrowser',
            async (node?: A365Node) => {
                if (!node || node.kind !== 'assignmentNode') {
                    output.appendLine(
                        '[Altium 365] assignment.openInBrowser: ignored kind=' +
                            (node?.kind ?? 'undefined')
                    );
                    return;
                }
                // Build URL: https://{workspace-url}/customization-manager/scripts/{extension-point-id}/{assignment-id}/edit
                if (!node.workspaceUrl) {
                    vscode.window.showInformationMessage(
                        'This assignment does not have a workspace URL'
                    );
                    return;
                }
                // Strip trailing slash from workspaceUrl to avoid double slashes
                const baseUrl = node.workspaceUrl.replace(/\/$/, '');
                const url = `${baseUrl}/customization-manager/scripts/${node.extensionPointId}/${node.assignment.assignmentId}/edit`;
                try {
                    await openExternalHttpUrl(url, output, 'assignment.openInBrowser');
                } catch (e) {
                    const err = e as Error;
                    vscode.window.showErrorMessage(
                        'Altium 365: Open in Browser failed: ' + err.message
                    );
                    output.appendLine(
                        '[Altium 365] assignment.openInBrowser failed: ' +
                            (err.stack ?? err.message)
                    );
                }
            }
        ),
    ];
}
