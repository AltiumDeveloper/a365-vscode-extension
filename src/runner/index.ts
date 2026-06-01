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
import {
    getSelectedWorkspace,
    getWorkspaceApiUrl,
    listWorkspaces,
    WorkspaceInfo,
    resolveWorkspaceFromAuthId,
} from '../workspace';
import { ensureSandboxDeps, getSandboxPythonPath } from './sandbox';
import { getLocalScript } from '../scripts/localCache';
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
    // D-01..D-03: when caller passes a `target`, this carries the resolved
    // workspace name so callers (runScriptAtPath / debugScriptAtPath) can
    // log it in the OutputChannel header (RESEARCH §5.4). Undefined for
    // the active-workspace fallback (preserves today's header).
    workspaceName?: string;
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
            const api: any = pyExt.exports;
            const resource = vscode.window.activeTextEditor?.document.uri;
            const details = api?.environments?.getActiveEnvironmentPath?.(resource);
            if (details?.path) {
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

/**
 * Resolve workspace context for a script file path.
 *
 * If the script is tracked in localScriptCache (downloaded A365 script),
 * resolve its workspace from the cache and listWorkspaces.
 *
 * If not found in cache, use the currently active workspace, or prompt
 * the user to select one if none is active.
 *
 * Returns target object with workspaceId + workspaceAuthId, or undefined
 * if user cancels the workspace selection.
 */
async function resolveWorkspaceForScript(
    context: vscode.ExtensionContext,
    scriptPath: string
): Promise<{ workspaceId: string; workspaceAuthId: string } | undefined> {
    // Check if this script is tracked in localScriptCache (downloaded A365 script)
    const identity = getLocalScript(scriptPath);
    if (identity) {
        // Script belongs to a specific workspace - resolve it via the centralized helper
        const envEndpoint = vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', '');
        const workspace = await resolveWorkspaceFromAuthId(context, identity.workspaceAuthId, envEndpoint);
        if (workspace) {
            return {
                workspaceId: workspace.workspaceId,
                workspaceAuthId: workspace.authId
            };
        }
    }

    // Not in cache or lookup failed - use active workspace, or prompt if none selected
    const selected = getSelectedWorkspace(context);
    if (selected) {
        return {
            workspaceId: selected.workspaceId,
            workspaceAuthId: selected.authId
        };
    }

    // No active workspace - prompt user to select one
    const choice = await vscode.window.showWarningMessage(
        'Scripts require a workspace to be selected. Select a workspace now?',
        'Select Workspace',
        'Cancel'
    );

    if (choice === 'Select Workspace') {
        await vscode.commands.executeCommand('altium365.selectWorkspace');
        // Check if user actually selected a workspace
        const newSelected = getSelectedWorkspace(context);
        if (newSelected) {
            return {
                workspaceId: newSelected.workspaceId,
                workspaceAuthId: newSelected.authId
            };
        }
    }

    // User cancelled or workspace selection failed
    return undefined;
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
    const envGlobalEndpoint = wcfg.get<string>('graphqlEndpoint') || '';
    if (!envGlobalEndpoint) {
        vscode.window.showErrorMessage('Set "altium365.graphqlEndpoint" in settings.');
        return undefined;
    }

    const oauthCfg = readOAuthConfig();
    let endpoint: string;
    let token: string | undefined;
    let resolvedWs: WorkspaceInfo | undefined;

    if (target) {
        // D-01..D-03 (Phase 6): tree-driven invocation against a specific
        // workspace. Mirror remoteExecution.ts:99-155 Block A — resolve the
        // workspace (fall back to listWorkspaces if it isn't the active one)
        // then mint a workspace-scoped token via ensureWorkspaceToken and use
        // the workspace's own apiServiceUrl. Does NOT touch the active
        // workspace selection (no implicit switch — D-01).
        resolvedWs = getSelectedWorkspace(context);
        if (!resolvedWs || resolvedWs.workspaceId !== target.workspaceId) {
            try {
                const baseToken = await getBaseAccessToken(context, oauthCfg);
                if (!baseToken) {
                    vscode.window.showErrorMessage(
                        'Altium 365: not signed in.'
                    );
                    return undefined;
                }
                const list = await listWorkspaces(envGlobalEndpoint, baseToken);
                resolvedWs = list.find((w) => w.workspaceId === target.workspaceId);
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
                workspaceId: target.workspaceId,
                authId: target.workspaceAuthId || resolvedWs.authId,
            });
        } catch (e) {
            vscode.window.showErrorMessage(
                'Altium 365: token exchange failed: ' + (e as Error).message
            );
            return undefined;
        }
        endpoint = getWorkspaceApiUrl(resolvedWs, envGlobalEndpoint);
    } else {
        // No target workspace specified - this should not happen after resolveWorkspaceForScript
        // but keeping as fallback. Scripts ALWAYS require workspace-scoped tokens.
        vscode.window.showErrorMessage(
            'Altium 365: Cannot run script - no workspace context available. Please select a workspace first.'
        );
        return undefined;
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

    // Unified test-event resolver (Phase 999.3 D-20). The legacy
    // inputParametersPath escape hatch was removed in Plan 06 UAT iter 5
    // (2026-05-25); test events stored per-script are now the sole source
    // of truth. Sibling .params.json auto-detect and the projectId prompt
    // were folded into the resolver. The legacy lastProjectId cache key
    // remains in use by the project-related preset (Plan 999.3-04); not
    // touched here.
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
                // Write resolver output as a tmp JSON object — same
                // pattern as the legacy prepareRun at extension.ts:839-848.
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
    // D-01..D-03: when a target workspace was supplied, expose its identity
    // to the runner (NOT the currently-active workspace) so user scripts that
    // read ALTIUM365_WORKSPACE_* see the script's owning workspace.
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
// D-01..D-03 (Phase 6): optional `target` routes execution through a specific
// workspace's token + apiServiceUrl (the script's owning workspace, NOT the
// currently-active one). When omitted, behavior is unchanged (palette /
// standalone .py path uses the active workspace per D-03).
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

// Reused by src/scripts/commands.ts to debug a fetched A365 script body
// written to os.tmpdir(). Mirrors runScriptAtPath: same prepareRun ->
// SandboxProcess PYTHONPATH wiring -> Python interpreter, but launches
// debugpy instead of spawning a subprocess.
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
