import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import {
    ensureWorkspaceToken,
    getBaseAccessToken,
    readOAuthConfig,
} from '../auth';
import { resolveConfig } from '../config';
import {
    getSelectedWorkspace,
    getWorkspaceApiUrl,
    listWorkspaces,
    pickWorkspace,
    setSelectedWorkspace,
    type WorkspaceInfo,
} from '../workspace';
import { ensureSandboxDeps, getSandboxPythonPath } from './sandbox';
import { resolveScriptIdentity } from '../testEvents/identity';
import { resolveScriptParameters } from '../testEvents/resolver';

interface RunPrep {
    python: string;
    runnerPath: string;
    scriptPath: string;
    scriptDir: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    endpoint: string;
    paramsPath: string;
    // When the caller passes a `target`, this carries the resolved workspace
    // name so runScriptAtPath / debugScriptAtPath can log it in the
    // OutputChannel header. Undefined for the active-workspace fallback.
    workspaceName?: string;
}

interface PythonExtensionApi {
    environments?: {
        getActiveEnvironmentPath?: (resource?: vscode.Uri) => { path?: string } | undefined;
    };
    settings?: {
        getExecutionDetails?: (resource?: vscode.Uri) => { execCommand?: string[] } | undefined;
    };
}

export async function resolvePythonPath(): Promise<string> {
    const cfg = vscode.workspace.getConfiguration('altium365');
    const configured = (cfg.get<string>('pythonPath') || '').trim();
    if (configured) {
        return configured;
    }
    try {
        const pyExt = vscode.extensions.getExtension('ms-python.python');
        if (pyExt) {
            if (!pyExt.isActive) {
                await pyExt.activate();
            }
            const api = pyExt.exports as PythonExtensionApi | undefined;
            const resource = vscode.window.activeTextEditor?.document.uri;
            const details = api?.environments?.getActiveEnvironmentPath?.(resource);
            if (details?.path && path.isAbsolute(details.path)) {
                return details.path;
            }
            const exec: string[] | undefined = api?.settings?.getExecutionDetails?.(resource)
                ?.execCommand;
            if (exec && exec.length > 0) {
                return exec[0];
            }
        }
    } catch {
        // fall through
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

async function prepareRun(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    uriOrPath?: vscode.Uri | string,
    target?: { workspaceId: string; workspaceAuthId: string }
): Promise<RunPrep | undefined> {
    let targetUri: vscode.Uri | undefined =
        typeof uriOrPath === 'string' ? vscode.Uri.file(uriOrPath) : uriOrPath;
    if (!targetUri) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'python') {
            if (editor.document.isDirty) {
                await editor.document.save();
            }
            targetUri = editor.document.uri;
        }
    }
    if (!targetUri) {
        vscode.window.showErrorMessage('No Python script selected.');
        return undefined;
    }

    const wcfg = vscode.workspace.getConfiguration('altium365');
    const envGlobalEndpoint = resolveConfig().graphqlEndpoint;
    if (!envGlobalEndpoint) {
        vscode.window.showErrorMessage('Set "altium365.graphqlEndpoint" in settings.');
        return undefined;
    }

    const oauthCfg = readOAuthConfig();
    let endpoint: string;
    let token: string | undefined;
    let resolvedWs: WorkspaceInfo | undefined;

    if (target) {
        // Tree-driven invocation against a specific workspace: resolve the
        // workspace (fall back to listWorkspaces if it isn't the active one)
        // then mint a workspace-scoped token via ensureWorkspaceToken and use
        // the workspace's own apiServiceUrl. Does NOT touch the active
        // workspace selection — no implicit switch.
        //
        // Some callers (e.g. editor-title run for cached tmp files) know the
        // workspaceAuthId but not the workspaceId (GRID). We match on either
        // field — authId preferred when workspaceId is blank.
        const matchesTarget = (w: WorkspaceInfo) =>
            target.workspaceId
                ? w.workspaceId === target.workspaceId
                : w.authId === target.workspaceAuthId;

        resolvedWs = getSelectedWorkspace(context);
        if (!resolvedWs || !matchesTarget(resolvedWs)) {
            try {
                const baseToken = await getBaseAccessToken(context, oauthCfg);
                if (!baseToken) {
                    vscode.window.showErrorMessage(
                        'Altium 365: not signed in.'
                    );
                    return undefined;
                }
                const list = await listWorkspaces(envGlobalEndpoint, baseToken);
                resolvedWs = list.find(matchesTarget);
            } catch (e) {
                vscode.window.showErrorMessage(
                    'Altium 365: workspace lookup failed: ' + (e as Error).message
                );
                return undefined;
            }
        }
        if (!resolvedWs) {
            vscode.window.showErrorMessage(
                'Altium 365: workspace not found (refresh the side panel).'
            );
            return undefined;
        }
        try {
            token = await ensureWorkspaceToken(context, oauthCfg, {
                workspaceId: resolvedWs.workspaceId,
                authId: resolvedWs.authId,
            });
        } catch (e) {
            vscode.window.showErrorMessage(
                'Altium 365: token exchange failed: ' + (e as Error).message
            );
            return undefined;
        }
        endpoint = getWorkspaceApiUrl(resolvedWs, envGlobalEndpoint);
    } else {
        // No target workspace — prefer the currently active workspace selection
        // (set via the sidebar / status bar / 'Switch Workspace' command). This
        // is the path taken when run/debug is invoked from the editor title
        // icon or the command palette: if the user already has an active
        // workspace, reuse it silently instead of prompting again on every
        // run. Only fall back to pickWorkspace when no workspace is selected
        // (e.g. first-ever run after sign-in on a fresh install).
        let picked = getSelectedWorkspace(context);
        if (!picked) {
            picked = await pickWorkspace(context, oauthCfg, envGlobalEndpoint);
            if (!picked) {
                return undefined; // user cancelled or not signed in
            }
            await setSelectedWorkspace(context, picked);
            // Refresh the sidebar so the active-workspace indicator updates
            // immediately without requiring a manual refresh click.
            await vscode.commands.executeCommand('altium365.tree.refresh');
        }
        resolvedWs = picked;
        try {
            token = await ensureWorkspaceToken(context, oauthCfg, {
                workspaceId: picked.workspaceId,
                authId: picked.authId,
            });
        } catch (e) {
            vscode.window.showErrorMessage(
                'Altium 365: token exchange failed: ' + (e as Error).message
            );
            return undefined;
        }
        endpoint = getWorkspaceApiUrl(picked, envGlobalEndpoint);
    }

    const python = await resolvePythonPath();
    // Ensure the vendored SandboxProcess deps are installed before
    // launching the runner — otherwise user scripts fail at import time
    // with `ModuleNotFoundError: No module named 'altium'` (or 'gql', etc).
    // ensureSandboxDeps surfaces its own user-facing errors / cancel.
    const depsReady = await ensureSandboxDeps(context, python, outputChannel);
    if (!depsReady) {
        return undefined;
    }
    const scriptPath = targetUri.fsPath;
    const scriptDir = path.dirname(scriptPath);
    const pythonDir = context.asAbsolutePath('python');
    const runnerPath = path.join(pythonDir, '_runner.py');
    const injectHelper = wcfg.get<boolean>('injectHelper', true);
    const extraEnv = wcfg.get<Record<string, string>>('extraEnv') || {};

    // Test events stored per-script are the sole source of parameters; sibling
    // .params.json auto-detect and the projectId prompt fold into the resolver.
    let paramsPath = '';
    {
        const idResult = resolveScriptIdentity(targetUri);
        if (idResult) {
            const params = await resolveScriptParameters(
                context,
                idResult,
                outputChannel,
                { promptOnFirstRun: true },
            );
            if (params !== undefined) {
                const tmpFile = path.join(
                    os.tmpdir(),
                    `altium365-params-${Date.now()}-${process.pid}.json`,
                );
                const obj: Record<string, string> = {};
                for (const p of params) {
                    obj[p.key] = p.value;
                }
                fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), 'utf-8');
                paramsPath = tmpFile;
            }
        }
    }

    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
    env.ALTIUM365_GRAPHQL_ENDPOINT = endpoint;
    env.ALTIUM365_TOKEN = token;
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUNBUFFERED = '1';
    // When a target workspace was supplied, expose its identity to the runner
    // (NOT the currently-active workspace) so user scripts that read
    // ALTIUM365_WORKSPACE_* see the script's owning workspace.
    const envWs = target ? resolvedWs : getSelectedWorkspace(context);
    if (envWs) {
        env.ALTIUM365_WORKSPACE_ID = envWs.workspaceId;
        env.ALTIUM365_WORKSPACE_AUTH_ID = envWs.authId;
        env.ALTIUM365_WORKSPACE_NAME = envWs.name;
    }
    if (injectHelper) {
        const sep = process.platform === 'win32' ? ';' : ':';
        // Prepend SandboxProcess/ and SandboxProcess/.deps/ so user
        // scripts can `import altium` / `import altium_api` / `import gql`
        // / `import requests`. `pythonDir` (which hosts _runner.py and
        // a365.py) is added last so the legacy helper still resolves.
        const sandboxPaths = getSandboxPythonPath(context);
        const prefix = [...sandboxPaths, pythonDir].join(sep);
        env.PYTHONPATH = env.PYTHONPATH ? `${prefix}${sep}${env.PYTHONPATH}` : prefix;
    }

    const args = [scriptPath];
    if (paramsPath) {
        args.push(paramsPath);
    }

    return { python, runnerPath, scriptPath, scriptDir, args, env, endpoint, paramsPath, workspaceName: resolvedWs?.name };
}

// Reused by src/scripts/commands.ts to run a fetched A365 script body written to os.tmpdir().
// An optional `target` routes execution through a specific workspace's token +
// apiServiceUrl (the script's owning workspace, NOT the currently-active one).
// When omitted, the palette / standalone .py path uses the active workspace.
export async function runScriptAtPath(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    scriptPath: string,
    target?: { workspaceId: string; workspaceAuthId: string }
): Promise<void> {
    const prep = await prepareRun(context, outputChannel, scriptPath, target);
    if (!prep) {
        return;
    }
    const { python, runnerPath, scriptPath: resolvedPath, scriptDir, args, env, endpoint, paramsPath, workspaceName } = prep;

    outputChannel.show(true);
    outputChannel.appendLine(`\n[Altium 365] Running ${resolvedPath}`);
    if (target && workspaceName) {
        outputChannel.appendLine(`[Altium 365] Workspace: ${workspaceName}`);
    }
    outputChannel.appendLine(`[Altium 365] Endpoint: ${endpoint}`);
    outputChannel.appendLine(`[Altium 365] Python:   ${python}`);
    if (paramsPath) {
        outputChannel.appendLine(`[Altium 365] Params:   ${paramsPath}`);
    }

    const proc = spawn(python, ['-u', runnerPath, ...args], { cwd: scriptDir, env });
    proc.stdout.on('data', (d) => outputChannel.append(d.toString()));
    proc.stderr.on('data', (d) => outputChannel.append(d.toString()));
    proc.on('error', (err) =>
        outputChannel.appendLine(`[Altium 365] Failed to start Python: ${err.message}`)
    );
    proc.on('close', (code) =>
        outputChannel.appendLine(`\n[Altium 365] Exit code: ${code}`)
    );
}

// Reused by src/scripts/commands.ts to debug a fetched A365 script body written
// to os.tmpdir(). Mirrors runScriptAtPath but launches debugpy instead of
// spawning a subprocess.
export async function debugScriptAtPath(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    scriptPath: string,
    target?: { workspaceId: string; workspaceAuthId: string }
): Promise<void> {
    const prep = await prepareRun(context, outputChannel, scriptPath, target);
    if (!prep) {
        return;
    }
    const { python, runnerPath, scriptPath: resolvedPath, scriptDir, args, env, endpoint, paramsPath, workspaceName } = prep;

    outputChannel.show(true);
    outputChannel.appendLine(`\n[Altium 365] Debugging ${resolvedPath}`);
    if (target && workspaceName) {
        outputChannel.appendLine(`[Altium 365] Workspace: ${workspaceName}`);
    }
    outputChannel.appendLine(`[Altium 365] Endpoint: ${endpoint}`);
    outputChannel.appendLine(`[Altium 365] Python:   ${python}`);
    if (paramsPath) {
        outputChannel.appendLine(`[Altium 365] Params:   ${paramsPath}`);
    }

    const debugConfig: vscode.DebugConfiguration = {
        type: 'debugpy',
        request: 'launch',
        name: `Altium 365: ${path.basename(resolvedPath)}`,
        program: runnerPath,
        args: [resolvedPath, ...args.slice(1)],
        cwd: scriptDir,
        console: 'integratedTerminal',
        justMyCode: false,
        python,
        env,
    };

    const started = await vscode.debug.startDebugging(undefined, debugConfig);
    if (!started) {
        vscode.window.showErrorMessage(
            'Failed to start debugger. Make sure the "Python Debugger" (ms-python.debugpy) extension is installed.'
        );
    }
}
