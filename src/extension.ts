import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import {
    clearAllTokens,
    ensureWorkspaceToken,
    fireAuthStateChanged,
    getActiveAccessToken,
    getStoredTokens,
    onAuthStateChanged,
    readOAuthConfig,
    signIn,
} from './auth';
import { pickWorkspace, getSelectedWorkspace, getWorkspaceApiUrl, listProjects, WorkspaceInfo } from './workspace';
import { A365Node, A365TreeDataProvider } from './sidePanel';
import { createStatusBar } from './statusBar';
import { registerScriptCommands } from './scriptCommands';
import { registerTreeCommands } from './treeCommands';
import { AltiumRemoteScriptFs } from './remoteScriptFs';
import { ensureSandboxDeps, getSandboxPythonPath } from './sandboxDeps';

let outputChannel: vscode.OutputChannel;

async function updateSignedInContext(context: vscode.ExtensionContext): Promise<void> {
    try {
        const tok = await getStoredTokens(context);
        await vscode.commands.executeCommand('setContext', 'altium365.signedIn', !!tok);
    } catch {
        // best-effort — worst case is welcome view stays visible (recoverable)
    }
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Altium 365');

    const treeProvider = new A365TreeDataProvider(
        context,
        outputChannel,
        () => vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', '')
    );
    const treeView = vscode.window.createTreeView('altium365.tree', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    // D-07 (revised after UAT): Show the active environment name directly in
    // the tree view title (e.g. "Altium 365 — Production") so users can see
    // which env is active at a glance without scanning for dimmed description
    // text. Sourced from the canonical `altium365.activeEnvironment` config
    // (same value driving the status bar). When unset (e.g. first launch
    // before the user explicitly runs "Select Environment"), fall back to the
    // first configured environment name. The base title "Altium 365" is the
    // package.json `views` contribution; `treeView.title` overrides it at
    // runtime. `treeView.description` is left empty so the env name is not
    // duplicated.
    const BASE_TITLE = 'Altium 365';
    const resolveEnvLabel = (): string | undefined => {
        const cfg = vscode.workspace.getConfiguration('altium365');
        const active = cfg.get<string>('activeEnvironment', '');
        if (active) {
            return active;
        }
        const envs = cfg.get<Record<string, unknown>>('environments') || {};
        const names = Object.keys(envs);
        return names.length > 0 ? names[0] : undefined;
    };
    const applyTreeTitle = () => {
        const env = resolveEnvLabel();
        treeView.title = env ? `${BASE_TITLE} — ${env}` : BASE_TITLE;
    };
    applyTreeTitle();

    const statusBar = createStatusBar(context, outputChannel);

    const remoteFs = new AltiumRemoteScriptFs(
        context,
        () => vscode.workspace.getConfiguration('altium365').get<string>('graphqlEndpoint', ''),
        outputChannel
    );
    const fsRegistration = vscode.workspace.registerFileSystemProvider(
        'altium365',
        remoteFs,
        { isCaseSensitive: true, isReadonly: false }
    );

    const scriptCommandDisposables = registerScriptCommands(context, outputChannel);
    const treeCommandDisposables = registerTreeCommands(context, outputChannel);

    context.subscriptions.push(
        outputChannel,
        fsRegistration,
        vscode.commands.registerCommand('altium365.signIn', () => doSignIn(context)),
        vscode.commands.registerCommand('altium365.signOut', () => doSignOut(context)),
        vscode.commands.registerCommand('altium365.selectWorkspace', () =>
            doSelectWorkspace(context)
        ),
        vscode.commands.registerCommand('altium365.runScript', (uri?: vscode.Uri) =>
            runScript(context, uri)
        ),
        vscode.commands.registerCommand('altium365.debugScript', (uri?: vscode.Uri) =>
            debugScript(context, uri)
        ),
        vscode.commands.registerCommand('altium365.selectEnvironment', () =>
            doSelectEnvironment(context)
        ),
        vscode.commands.registerCommand('altium365.installScriptDependencies', async () => {
            const python = await resolvePythonPath();
            const ok = await ensureSandboxDeps(context, python, outputChannel, true);
            if (ok) {
                vscode.window.showInformationMessage(
                    'Altium 365: script dependencies installed.'
                );
            }
        }),
        treeView,
        vscode.commands.registerCommand('altium365.tree.refresh', () => treeProvider.refresh()),
        vscode.commands.registerCommand('altium365.tree.retryNode', (n?: A365Node) => {
            if (n?.kind === 'error') {
                treeProvider.refresh(n.parent);
            }
        }),
        onAuthStateChanged(async () => {
            await updateSignedInContext(context);
            treeProvider.refresh();
        }),
        // D-07 (revised after UAT): Refresh tree view title when the active
        // environment changes. TreeView.title is not re-read by provider
        // refresh, so we listen to the canonical configuration event — this
        // keeps wiring decoupled from `doSelectEnvironment` which mutates the
        // configuration value directly.
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('altium365.activeEnvironment') ||
                e.affectsConfiguration('altium365.environments')
            ) {
                applyTreeTitle();
            }
        }),
        statusBar.item,
        statusBar.subscription,
        vscode.commands.registerCommand('altium365.statusBar.click', () => onStatusBarClick()),
        ...scriptCommandDisposables,
        ...treeCommandDisposables
    );

    void updateSignedInContext(context);
}

export function deactivate() {}

async function onStatusBarClick(): Promise<void> {
    const items: Array<vscode.QuickPickItem & { command: string }> = [
        { label: '$(sign-out) Sign Out', command: 'altium365.signOut' },
        { label: '$(globe) Switch Environment', command: 'altium365.selectEnvironment' },
        { label: '$(repo) Switch Workspace', command: 'altium365.selectWorkspace' },
    ];
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Altium 365',
        ignoreFocusOut: false,
    });
    if (!pick) {
        return;
    }
    try {
        await vscode.commands.executeCommand(pick.command);
    } catch (e) {
        const msg = (e as Error).message;
        vscode.window.showErrorMessage('Altium 365: ' + msg);
        outputChannel.appendLine('[Altium 365] statusBar action failed: ' + msg);
    }
}

async function doSignIn(context: vscode.ExtensionContext) {
    const cfg = readOAuthConfig();
    if (!cfg.clientId || !cfg.authEndpoint || !cfg.tokenEndpoint) {
        vscode.window.showErrorMessage(
            'Configure altium365.clientId, altium365.authEndpoint and altium365.tokenEndpoint first.'
        );
        return;
    }
    if (!cfg.actionWaitEndpoint || !cfg.redirectUri) {
        vscode.window.showErrorMessage(
            "Altium 365: actionWaitEndpoint and redirectUri are not configured. Run 'Altium 365: Select Environment' to populate them from the env defaults."
        );
        return;
    }
    const controller = new AbortController();
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                cancellable: true,
                title: 'Altium 365: waiting for sign-in...',
            },
            async (_progress, token) => {
                const cancelSubscription = token.onCancellationRequested(() => controller.abort());
                try {
                    await signIn(context, cfg, 180_000, controller.signal);
                } finally {
                    cancelSubscription.dispose();
                }
            }
        );
        vscode.window.showInformationMessage('Altium 365: signed in.');
        await updateSignedInContext(context);
        const choice = await vscode.window.showInformationMessage(
            'Pick a workspace now?',
            'Select workspace'
        );
        if (choice === 'Select workspace') {
            await doSelectWorkspace(context);
        }
    } catch (e) {
        const msg = (e as Error).message ?? String(e);

        // Silent cancellation per D-12 — the closing progress notification IS the feedback.
        if (msg === 'Sign-in cancelled.') {
            return;
        }

        // CSRF guard (exact match per D-07/D-12)
        if (msg === 'State mismatch (possible CSRF).') {
            vscode.window.showErrorMessage(
                'Altium 365 sign-in failed: state mismatch (possible CSRF).'
            );
            return;
        }

        // Wall-clock timeout
        if (msg.includes('wall-clock timeout')) {
            vscode.window.showErrorMessage(
                'Altium 365 sign-in timed out after 3 minutes. Please try again.'
            );
            return;
        }

        // Network error during poll — message format from plan 04: 'ActionWait network error: <err> (<host>)'
        if (msg.startsWith('ActionWait network error')) {
            const hostMatch = msg.match(/\(([^)]+)\)\s*$/);
            let host = hostMatch ? hostMatch[1] : '';
            if (!host) {
                try {
                    host = new URL(cfg.actionWaitEndpoint).host;
                } catch {
                    host = cfg.actionWaitEndpoint;
                }
            }
            vscode.window.showErrorMessage(
                `Altium 365 sign-in failed: cannot reach ActionWait service (${host}). Check network connectivity.`
            );
            return;
        }

        // ActionWait non-2xx HTTP status — message format from plan 04: 'ActionWait returned <status>: <body>'
        if (msg.startsWith('ActionWait returned')) {
            const statusMatch = msg.match(/^ActionWait returned (\d+)/);
            const status = statusMatch ? statusMatch[1] : '?';
            vscode.window.showErrorMessage(
                `Altium 365 sign-in failed: ActionWait returned ${status}.`
            );
            return;
        }

        // Token endpoint OAuth error (RFC 6749 §5.2) — postForm formats these as
        // 'Token endpoint <status> <error>[ — <description>] (body: ...)'. Map the
        // well-known error codes to friendly messages; fall back to a generic
        // friendly message for unknown codes. The full technical detail still goes
        // to OutputChannel so debugging is possible. D-12 final bullet superseded
        // by this branch for 'Token endpoint' messages with a parseable OAuth code.
        const tokenOAuthMatch = msg.match(
            /^Token endpoint (\d+) ([a-z_]+)(?: — ([^(]*))?\s*\(body:/
        );
        if (tokenOAuthMatch) {
            const [, status, oauthError, oauthDesc] = tokenOAuthMatch;
            outputChannel.appendLine(`[Altium 365] sign-in token-endpoint error: ${msg}`);
            const friendly: Record<string, string> = {
                invalid_grant:
                    'the authorization was rejected (the code may be expired, already used, or the redirect_uri / PKCE verifier did not match). Please try signing in again.',
                invalid_client:
                    'the configured client_id was not recognised by the auth server. Check altium365.clientId.',
                invalid_request:
                    'the token request was malformed. This is likely an extension bug — please report it.',
                unauthorized_client:
                    'this client is not allowed to use the authorization-code grant. Check the Altium auth client configuration.',
                unsupported_grant_type:
                    'the auth server does not support the authorization-code grant. Check the Altium auth client configuration.',
                invalid_scope:
                    'one or more requested scopes were rejected. Check altium365.scopes.',
            };
            const desc = (friendly[oauthError] || (oauthDesc?.trim() ?? '')).trim();
            const detail = desc ? `: ${desc}` : ` (${oauthError}).`;
            vscode.window.showErrorMessage(
                `Altium 365 sign-in failed${detail} (HTTP ${status} ${oauthError}; see Output → Altium 365 for details.)`
            );
            return;
        }

        // Token endpoint failure without a parseable OAuth error, or anything else —
        // existing pass-through preserved (D-12 final bullet)
        vscode.window.showErrorMessage(`Sign-in failed: ${msg}`);
    }
}

async function doSignOut(context: vscode.ExtensionContext) {
    await clearAllTokens(context);
    await context.globalState.update('altium365.selectedWorkspace', undefined);
    await updateSignedInContext(context);
    vscode.window.showInformationMessage('Altium 365: signed out.');
}

async function doSelectWorkspace(context: vscode.ExtensionContext) {
    const cfg = readOAuthConfig();
    const endpoint = vscode.workspace
        .getConfiguration('altium365')
        .get<string>('graphqlEndpoint', '');
    if (!endpoint) {
        vscode.window.showErrorMessage('Set altium365.graphqlEndpoint first.');
        return;
    }
    const ws = await pickWorkspace(context, cfg, endpoint);
    if (!ws) {
        return;
    }
    await applyWorkspaceSelection(context, ws);
}

/**
 * Activate a workspace: exchange the base token for a workspace-scoped token,
 * persist the selection to `globalState['altium365.selectedWorkspace']`,
 * surface success/failure UI, and refresh the side panel.
 *
 * Plan 04-04 (D-14, D-16): factored out of `doSelectWorkspace` +
 * `pickAndExchangeWorkspace` so the tree-context-menu command
 * `altium365.workspace.selectFromNode` can reuse the exact same activation
 * path (token exchange, globalState write, tree refresh, status bar refresh)
 * without going through a QuickPick. The globalState key
 * (`altium365.selectedWorkspace`) is preserved verbatim per D-16.
 *
 * Errors are caught + surfaced + swallowed (no rethrow) to match the
 * pre-refactor `doSelectWorkspace` behavior — callers should not see
 * exceptions from this helper.
 */
export async function applyWorkspaceSelection(
    context: vscode.ExtensionContext,
    workspace: WorkspaceInfo
): Promise<void> {
    try {
        await ensureWorkspaceToken(context, readOAuthConfig(), {
            workspaceId: workspace.workspaceId,
            authId: workspace.authId,
        });
        await context.globalState.update('altium365.selectedWorkspace', workspace);
        vscode.window.showInformationMessage('Altium 365: workspace token acquired.');
        // WR-02 fix: refresh the side panel so the active-workspace cue
        // (Plan 04-02 icon swap + Plan 04-04 contextValue split) follows the
        // user's explicit selection without waiting for sign-in/out.
        await vscode.commands.executeCommand('altium365.tree.refresh');
    } catch (e) {
        vscode.window.showErrorMessage(
            `Workspace token exchange failed: ${(e as Error).message}`
        );
    }
}

interface EnvironmentSpec {
    graphqlEndpoint?: string;
    authEndpoint?: string;
    tokenEndpoint?: string;
    actionWaitEndpoint?: string;
    redirectUri?: string;
    scopes?: string;
    audience?: string;
}

async function doSelectEnvironment(context: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('altium365');
    const envs = cfg.get<Record<string, EnvironmentSpec>>('environments') || {};
    const names = Object.keys(envs);
    if (names.length === 0) {
        vscode.window.showErrorMessage(
            'No environments configured. Set "altium365.environments" in settings.'
        );
        return;
    }
    const active = cfg.get<string>('activeEnvironment') || '';
    const items = names.map((name) => {
        const e = envs[name] || {};
        return {
            label: name,
            description: name === active ? '$(check) active' : undefined,
            detail: e.graphqlEndpoint || '(no graphqlEndpoint set)',
            name,
            spec: e,
        };
    });
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select Altium 365 environment',
        ignoreFocusOut: true,
    });
    if (!pick) {
        return;
    }
    const spec = pick.spec;
    if (!spec.graphqlEndpoint || !spec.authEndpoint || !spec.tokenEndpoint) {
        const choice = await vscode.window.showWarningMessage(
            `Environment "${pick.name}" is missing graphqlEndpoint / authEndpoint / tokenEndpoint. Open settings to fill them in?`,
            'Open Settings',
            'Apply anyway'
        );
        if (choice === 'Open Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'altium365.environments'
            );
            return;
        }
        if (choice !== 'Apply anyway') {
            return;
        }
    }

    const target = vscode.ConfigurationTarget.Global;
    await cfg.update('graphqlEndpoint', spec.graphqlEndpoint ?? '', target);
    await cfg.update('authEndpoint', spec.authEndpoint ?? '', target);
    await cfg.update('tokenEndpoint', spec.tokenEndpoint ?? '', target);
    if (spec.actionWaitEndpoint !== undefined) {
        await cfg.update('actionWaitEndpoint', spec.actionWaitEndpoint, target);
    }
    if (spec.redirectUri !== undefined) {
        await cfg.update('redirectUri', spec.redirectUri, target);
    }
    if (spec.scopes !== undefined) {
        await cfg.update('scopes', spec.scopes, target);
    }
    if (spec.audience !== undefined) {
        await cfg.update('audience', spec.audience, target);
    }
    await cfg.update('activeEnvironment', pick.name, target);

    outputChannel.appendLine(`[Altium 365] Active environment: ${pick.name}`);
    outputChannel.appendLine(`[Altium 365]   graphql: ${spec.graphqlEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   auth:    ${spec.authEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   token:   ${spec.tokenEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   actionWait: ${spec.actionWaitEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   redirect:   ${spec.redirectUri || '(empty)'}`);

    // Tokens and selected workspace are environment-bound — offer to clear them.
    // IMPORTANT (02.3 UAT bug, 2026-05-20): do NOT fire authStateChanged before
    // this prompt resolves. The side panel listens to that event and triggers
    // a workspace refresh — firing early would refresh against the new env's
    // graphqlEndpoint using the previous env's token, producing an auth error
    // in the panel before the user even decides what to do with their session.
    const next = await vscode.window.showInformationMessage(
        `Switched to "${pick.name}". Sign out current session and select a workspace in the new environment?`,
        'Sign out & sign in',
        'Sign out only',
        'Keep session'
    );
    if (next === 'Sign out & sign in' || next === 'Sign out only') {
        await clearAllTokens(context);
        await context.globalState.update('altium365.selectedWorkspace', undefined);
        await updateSignedInContext(context);
    }

    // Fire AFTER the prompt + any token clearing so listeners see a consistent
    // (env, token) pair. signIn() below will fire its own event on completion.
    try {
        const tok = await getStoredTokens(context);
        fireAuthStateChanged({ signedIn: !!tok, environment: pick.name });
    } catch {
        // best-effort broadcast
    }

    if (next === 'Sign out & sign in') {
        await doSignIn(context);
    }
}

async function resolvePythonPath(): Promise<string> {
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

async function runScript(context: vscode.ExtensionContext, uri?: vscode.Uri) {
    let target = uri;
    if (!target) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'python') {
            if (editor.document.isDirty) {
                await editor.document.save();
            }
            target = editor.document.uri;
        }
    }
    if (!target) {
        vscode.window.showErrorMessage('No Python script selected.');
        return;
    }
    return runScriptAtPath(context, target.fsPath);
}

// Reused by src/scriptCommands.ts to run a fetched A365 script body written to os.tmpdir().
export async function runScriptAtPath(
    context: vscode.ExtensionContext,
    scriptPath: string
): Promise<void> {
    const prep = await prepareRun(context, scriptPath);
    if (!prep) {
        return;
    }
    const { python, runnerPath, scriptPath: resolvedPath, scriptDir, args, env, endpoint, paramsPath } = prep;

    outputChannel.show(true);
    outputChannel.appendLine(`\n[Altium 365] Running ${resolvedPath}`);
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

async function debugScript(context: vscode.ExtensionContext, uri?: vscode.Uri) {
    const prep = await prepareRun(context, uri);
    if (!prep) {
        return;
    }
    const { python, runnerPath, scriptPath, scriptDir, args, env, endpoint, paramsPath } = prep;

    outputChannel.show(true);
    outputChannel.appendLine(`\n[Altium 365] Debugging ${scriptPath}`);
    outputChannel.appendLine(`[Altium 365] Endpoint: ${endpoint}`);
    outputChannel.appendLine(`[Altium 365] Python:   ${python}`);
    if (paramsPath) {
        outputChannel.appendLine(`[Altium 365] Params:   ${paramsPath}`);
    }

    const debugConfig: vscode.DebugConfiguration = {
        type: 'debugpy',
        request: 'launch',
        name: `Altium 365: ${path.basename(scriptPath)}`,
        program: runnerPath,
        args: [scriptPath, ...args.slice(1)],
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

interface RunPrep {
    python: string;
    runnerPath: string;
    scriptPath: string;
    scriptDir: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    endpoint: string;
    paramsPath: string;
}

async function prepareRun(
    context: vscode.ExtensionContext,
    uriOrPath?: vscode.Uri | string
): Promise<RunPrep | undefined> {
    let target: vscode.Uri | undefined =
        typeof uriOrPath === 'string' ? vscode.Uri.file(uriOrPath) : uriOrPath;
    if (!target) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'python') {
            if (editor.document.isDirty) {
                await editor.document.save();
            }
            target = editor.document.uri;
        }
    }
    if (!target) {
        vscode.window.showErrorMessage('No Python script selected.');
        return undefined;
    }

    const wcfg = vscode.workspace.getConfiguration('altium365');
    const envGlobalEndpoint = wcfg.get<string>('graphqlEndpoint') || '';
    if (!envGlobalEndpoint) {
        vscode.window.showErrorMessage('Set "altium365.graphqlEndpoint" in settings.');
        return undefined;
    }
    // Phase 02.3 D-19: when a workspace is selected, prefer its own
    // apiServiceUrl over the env-global endpoint for any workspace-scoped
    // operation (listing projects, executing scripts on that workspace).
    // Falls back to env-global for the "no workspace selected" case so the
    // existing Python-runner workflow keeps working.
    const endpoint = getWorkspaceApiUrl(getSelectedWorkspace(context), envGlobalEndpoint);

    const oauthCfg = readOAuthConfig();
    let token = await getActiveAccessToken(context, oauthCfg);
    if (!token) {
        const choice = await vscode.window.showWarningMessage(
            'Not signed in to Altium 365.',
            'Sign in'
        );
        if (choice === 'Sign in') {
            await doSignIn(context);
            token = await getActiveAccessToken(context, oauthCfg);
        }
        if (!token) {
            return undefined;
        }
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
    const scriptPath = target.fsPath;
    const scriptDir = path.dirname(scriptPath);
    const pythonDir = context.asAbsolutePath('python');
    const runnerPath = path.join(pythonDir, '_runner.py');
    const injectHelper = wcfg.get<boolean>('injectHelper', true);
    const extraEnv = wcfg.get<Record<string, string>>('extraEnv') || {};

    let paramsPath = (wcfg.get<string>('inputParametersPath') || '').trim();
    if (!paramsPath) {
        const sibling = path.join(
            scriptDir,
            `${path.basename(scriptPath, path.extname(scriptPath))}.params.json`
        );
        if (fs.existsSync(sibling)) {
            paramsPath = sibling;
        }
    }

    // If no params file is configured, prompt for projectId (the most common A365 input).
    if (!paramsPath) {
        const promptForProject = wcfg.get<boolean>('promptForProjectId', true);
        if (promptForProject) {
            const wsId = getSelectedWorkspace(context)?.workspaceId || 'default';
            const lastKey = `altium365.lastProjectId.${wsId}`;
            const last = context.globalState.get<string>(lastKey, '');
            const picked = await pickProjectId(context, endpoint, token!, last);
            if (picked === undefined) {
                // user cancelled
                return undefined;
            }
            if (picked) {
                await context.globalState.update(lastKey, picked);
                const tmpFile = path.join(
                    os.tmpdir(),
                    `altium365-params-${Date.now()}-${process.pid}.json`
                );
                fs.writeFileSync(
                    tmpFile,
                    JSON.stringify({ projectId: picked }, null, 2),
                    'utf-8'
                );
                paramsPath = tmpFile;
            }
        }
    }

    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
    env.ALTIUM365_GRAPHQL_ENDPOINT = endpoint;
    env.ALTIUM365_TOKEN = token;
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUNBUFFERED = '1';
    const selectedWs = getSelectedWorkspace(context);
    if (selectedWs) {
        env.ALTIUM365_WORKSPACE_ID = selectedWs.workspaceId;
        env.ALTIUM365_WORKSPACE_AUTH_ID = selectedWs.authId;
        env.ALTIUM365_WORKSPACE_NAME = selectedWs.name;
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

    return { python, runnerPath, scriptPath, scriptDir, args, env, endpoint, paramsPath };
}

/**
 * Prompts the user to pick a projectId. Returns:
 *   - the picked id (string, possibly empty if user chose "no parameters")
 *   - undefined if the user cancelled
 */
async function pickProjectId(
    context: vscode.ExtensionContext,
    endpoint: string,
    accessToken: string,
    last: string
): Promise<string | undefined> {
    type Item = vscode.QuickPickItem & { value?: string; manual?: boolean };
    const wsName = getSelectedWorkspace(context)?.name || '-';

    const projects = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Loading projects from "${wsName}"...`,
        },
        async () => {
            try {
                return await listProjects(endpoint, accessToken);
            } catch (e) {
                outputChannel.appendLine(
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
