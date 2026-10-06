import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcess } from 'child_process';
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
import { withScriptProgress } from './progress';

import { resolveScriptIdentity } from '../testEvents/identity';
import { resolveScriptParameters } from '../testEvents/resolver';
import { resolveRunSecrets, type LocalSecrets } from '../secrets';

// Echoed back on vscode.DebugSession.configuration, which is the only handle a
// terminate listener gets on the run that created the file.
const DEBUG_TEMP_FILES_KEY = 'altium365TempFiles';

const KILL_GRACE_MS = 2000;

const runningScripts = new Map<ChildProcess, string[]>();
const debugTempFiles = new Set<string>();

function killProcessTree(
    proc: ChildProcess,
    signal: NodeJS.Signals,
    outputChannel: vscode.OutputChannel
): void {
    if (proc.pid === undefined) {
        return;
    }
    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']).on('error', (err) =>
            outputChannel.appendLine(`[Altium 365] taskkill failed: ${err.message}`)
        );
        return;
    }
    try {
        process.kill(-proc.pid, signal);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw e;
        }
    }
}

function removeTempFiles(paths: string[], outputChannel: vscode.OutputChannel): void {
    for (const file of paths) {
        debugTempFiles.delete(file);
        try {
            fs.unlinkSync(file);
        } catch (e) {
            const err = e as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                outputChannel.appendLine(
                    `[Altium 365] Failed to remove ${file}: ${err.message}`
                );
            }
        }
    }
}

function writeTempJson(kind: 'params' | 'secrets', values: Record<string, string>): string {
    const file = path.join(os.tmpdir(), `altium365-${kind}-${Date.now()}-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(values, null, 2), { encoding: 'utf-8', mode: 0o600 });
    return file;
}

/**
 * Terminates scripts still running at shutdown and removes the temp files of a
 * debug session once it ends. Register on `context.subscriptions`.
 */
export function registerRunLifecycle(outputChannel: vscode.OutputChannel): vscode.Disposable {
    const debugCleanup = vscode.debug.onDidTerminateDebugSession((session) => {
        const tempFiles: unknown = session.configuration?.[DEBUG_TEMP_FILES_KEY];
        if (Array.isArray(tempFiles)) {
            removeTempFiles(tempFiles.filter((f) => typeof f === 'string'), outputChannel);
        }
    });
    return new vscode.Disposable(() => {
        debugCleanup.dispose();
        for (const [proc, tempFiles] of runningScripts) {
            killProcessTree(proc, 'SIGKILL', outputChannel);
            removeTempFiles(tempFiles, outputChannel);
        }
        runningScripts.clear();
        removeTempFiles([...debugTempFiles], outputChannel);
    });
}

interface RunPrep {
    python: string;
    runnerPath: string;
    scriptPath: string;
    scriptDir: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    endpoint: string;
    paramsPath: string;
    secretNames: string[];
    tempFiles: string[];
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
    let params: Array<{ key: string; value: string }> | undefined;
    let secrets: LocalSecrets = {};
    const idResult = resolveScriptIdentity(targetUri);
    if (idResult) {
        params = await resolveScriptParameters(
            context,
            idResult,
            outputChannel,
            { promptOnFirstRun: true },
        );
        const resolvedSecrets = await resolveRunSecrets(context, outputChannel, {
            identity: idResult,
            scriptPath,
            workspace: resolvedWs,
            endpoint,
            token,
        });
        if (!resolvedSecrets) {
            return undefined;
        }
        secrets = resolvedSecrets;
    }
    const paramsPath = params
        ? writeTempJson('params', Object.fromEntries(params.map((p) => [p.key, p.value])))
        : '';
    const secretsPath = Object.keys(secrets).length > 0 ? writeTempJson('secrets', secrets) : '';
    const tempFiles = [paramsPath, secretsPath].filter((f) => f);

    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
    env.ALTIUM365_GRAPHQL_ENDPOINT = endpoint;
    env.ALTIUM365_TOKEN = token;
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUNBUFFERED = '1';
    if (secretsPath) {
        env.SECRETS_FILE_PATH = secretsPath;
    }
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

    return {
        python,
        runnerPath,
        scriptPath,
        scriptDir,
        args,
        env,
        endpoint,
        paramsPath,
        secretNames: Object.keys(secrets),
        tempFiles,
        workspaceName: resolvedWs?.name,
    };
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
    const { python, runnerPath, scriptPath: resolvedPath, scriptDir, args, env, endpoint, paramsPath, secretNames, tempFiles, workspaceName } = prep;

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
    if (secretNames.length > 0) {
        outputChannel.appendLine(`[Altium 365] Secrets:  ${secretNames.join(', ')}`);
    }

    try {
        await withScriptProgress(
            `Running ${path.basename(resolvedPath)}`,
            (signal) =>
                new Promise<void>((resolve) => {
                    const proc = spawn(python, ['-u', runnerPath, ...args], {
                        cwd: scriptDir,
                        env,
                        detached: process.platform !== 'win32',
                    });
                    runningScripts.set(proc, tempFiles);
                    const onAbort = () => {
                        killProcessTree(proc, 'SIGTERM', outputChannel);
                        if (process.platform !== 'win32') {
                            setTimeout(
                                () => killProcessTree(proc, 'SIGKILL', outputChannel),
                                KILL_GRACE_MS
                            ).unref();
                        }
                    };
                    signal.addEventListener('abort', onAbort);
                    const finish = () => {
                        signal.removeEventListener('abort', onAbort);
                        runningScripts.delete(proc);
                        resolve();
                    };
                    proc.stdout.on('data', (d) => outputChannel.append(d.toString()));
                    proc.stderr.on('data', (d) => outputChannel.append(d.toString()));
                    proc.on('error', (err) => {
                        outputChannel.appendLine(
                            `[Altium 365] Failed to start Python: ${err.message}`
                        );
                        finish();
                    });
                    proc.on('exit', finish);
                    proc.on('close', (code) => {
                        outputChannel.appendLine(`\n[Altium 365] Exit code: ${code}`);
                    });
                }),
            { cancellable: true },
        );
    } finally {
        removeTempFiles(tempFiles, outputChannel);
    }
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
    const { python, runnerPath, scriptPath: resolvedPath, scriptDir, args, env, endpoint, paramsPath, secretNames, tempFiles, workspaceName } = prep;

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
    if (secretNames.length > 0) {
        outputChannel.appendLine(`[Altium 365] Secrets:  ${secretNames.join(', ')}`);
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
        [DEBUG_TEMP_FILES_KEY]: tempFiles,
    };

    tempFiles.forEach((f) => debugTempFiles.add(f));
    const started = await vscode.debug.startDebugging(undefined, debugConfig);
    if (!started) {
        vscode.window.showErrorMessage(
            'Failed to start debugger. Make sure the "Python Debugger" (ms-python.debugpy) extension is installed.'
        );
        removeTempFiles(tempFiles, outputChannel);
    }
}
