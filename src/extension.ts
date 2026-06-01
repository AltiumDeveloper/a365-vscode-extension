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
    getBaseAccessToken,
    getStoredTokens,
    onAuthStateChanged,
    readOAuthConfig,
    signIn,
} from './auth';
import { pickWorkspace, getSelectedWorkspace, getWorkspaceApiUrl, listProjects, listWorkspaces, WorkspaceInfo, resolveWorkspaceFromAuthId } from './workspace';
import { A365Node, A365TreeDataProvider } from './sidePanel';
import { createStatusBar } from './statusBar';
import { registerScriptCommands } from './scriptCommands';
import { registerTreeCommands } from './treeCommands';
import { AltiumRemoteScriptFs } from './remoteScriptFs';
import { ensureSandboxDeps, getSandboxPythonPath } from './sandboxDeps';
import { registerLocalScriptSaveBridge, getLocalScript, rehydrateLocalScriptCacheFromDisk } from './localScriptCache';
import { resolveScriptIdentity } from './testEvents/identity';
import { resolveScriptParameters } from './testEvents/resolver';
import { TestEventFs } from './testEvents/eventFs';
import { registerTestEventCommands } from './testEvents/commands';
import { registerTestEventStatusItem } from './testEvents/statusItem';
import { registerPythonAnalysisSync } from './pythonAnalysisSync';

let outputChannel: vscode.OutputChannel;

async function updateSignedInContext(context: vscode.ExtensionContext): Promise<void> {
    try {
        const tok = await getStoredTokens(context);
        await vscode.commands.executeCommand('setContext', 'altium365.signedIn', !!tok);
    } catch {
        // best-effort — worst case is welcome view stays visible (recoverable)
    }
}

export function updateActiveRemoteContext(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
        void vscode.commands.executeCommand('setContext', 'altium365.activeIsRemoteScript', false);
        return;
    }
    
    const isRemote = !!(
        editor.document.uri.scheme === 'file'
        && getLocalScript(editor.document.uri.fsPath)
    );
    
    void vscode.commands.executeCommand(
        'setContext', 'altium365.activeIsRemoteScript', isRemote);
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Altium Developer');

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

    // Phase 999.3 D-15: writable virtual scheme backing test-event JSON
    // tabs. Cmd+S commits via TestEventFs.writeFile → writeStore.
    const testEventFs = new TestEventFs(context, outputChannel);
    const testEventFsRegistration = vscode.workspace.registerFileSystemProvider(
        'altium365-event',
        testEventFs,
        { isCaseSensitive: true, isReadonly: false }
    );

    const scriptCommandDisposables = registerScriptCommands(context, outputChannel);
    const treeCommandDisposables = registerTreeCommands(context, outputChannel);
    const testEventCommandDisposables = registerTestEventCommands(context, outputChannel);
    const testEventStatusDisposables = registerTestEventStatusItem(context);
    const localScriptSaveBridge = registerLocalScriptSaveBridge(context, outputChannel, remoteFs);
    const pythonAnalysisSyncDisposables = registerPythonAnalysisSync(context, outputChannel);

    context.subscriptions.push(
        outputChannel,
        fsRegistration,
        testEventFsRegistration,
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
        ...treeCommandDisposables,
        ...testEventCommandDisposables,
        ...testEventStatusDisposables,
        localScriptSaveBridge,
        ...pythonAnalysisSyncDisposables
    );

    // Plan 999.3-06 Task 2: activation boot line so dogfooders can see
    // in the output channel that the test-events subsystem booted, and
    // get a quick read on identity-count growth over time. Filters out
    // bloatWarned.* meta-keys so the number reflects scripts with stored
    // events, not the flag-tracking sidecar.
    const identityCount = context.globalState
        .keys()
        .filter(
            (k) =>
                k.startsWith('altium365.scriptParams.') &&
                !k.startsWith('altium365.scriptParams.bloatWarned.') &&
                !k.startsWith('altium365.scriptParams.importedFrom.')
        ).length;
    outputChannel.appendLine(
        `[Altium 365] testEvents.activate: subsystem active — ${identityCount} identities tracked.`
    );

    // D-15 (UAT-2 follow-up): rehydrate the localScriptCache from the
    // on-disk GRID layout BEFORE seeding the active-remote context key,
    // so remote-tmp `.py` tabs restored by VS Code from a previous
    // session are recognized as remote on first frame (Execute Remotely
    // / Publish submenu rows visible without re-downloading). Sync I/O
    // is intentional — UAT-3 showed async rehydration loses the race
    // against the seed call below.
    try {
        const n = rehydrateLocalScriptCacheFromDisk();
        if (n > 0) {
            outputChannel.appendLine(
                `[Altium 365] Rehydrated ${n} local script(s) from tmpdir cache.`
            );
        }
    } catch (e) {
        outputChannel.appendLine(
            `[Altium 365] Cache rehydration failed: ${(e as Error).message}`
        );
    }

    // D-15: seed BEFORE listener registration (RESEARCH §2.2) so submenu
    // items show correct visibility from the first frame — not after the
    // next tab switch.
    updateActiveRemoteContext(vscode.window.activeTextEditor);
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateActiveRemoteContext),
    );

    // Update remote script context when debug session ends
    // When debugging a remote script, the context key needs to be refreshed
    // after the debug session terminates, since the same editor remains active
    // (onDidChangeActiveTextEditor doesn't fire) but the context may be stale.
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(() => {
            updateActiveRemoteContext(vscode.window.activeTextEditor);
        })
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
    appId?: string;
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
        await doSelectWorkspace(context);
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
    // Resolve workspace context - prompts user if no workspace is active
    const workspaceTarget = await resolveWorkspaceForScript(context, target.fsPath);
    if (!workspaceTarget) {
        // User cancelled workspace selection - stop here
        return;
    }
    return runScriptAtPath(context, target.fsPath, workspaceTarget);
}

// Reused by src/scriptCommands.ts to run a fetched A365 script body written to os.tmpdir().
// D-01..D-03 (Phase 6): optional `target` routes execution through a specific
// workspace's token + apiServiceUrl (the script's owning workspace, NOT the
// currently-active one). When omitted, behavior is unchanged (palette /
// standalone .py path uses the active workspace per D-03).
export async function runScriptAtPath(
    context: vscode.ExtensionContext,
    scriptPath: string,
    target?: { workspaceId: string; workspaceAuthId: string }
): Promise<void> {
    const prep = await prepareRun(context, scriptPath, target);
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

async function debugScript(context: vscode.ExtensionContext, uri?: vscode.Uri) {
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
    // Resolve workspace context - prompts user if no workspace is active
    const workspaceTarget = await resolveWorkspaceForScript(context, target.fsPath);
    if (!workspaceTarget) {
        // User cancelled workspace selection - stop here
        return;
    }
    return debugScriptAtPath(context, target.fsPath, workspaceTarget);
}

// Reused by src/scriptCommands.ts to debug a fetched A365 script body
// written to os.tmpdir(). Mirrors runScriptAtPath: same prepareRun ->
// SandboxProcess PYTHONPATH wiring -> Python interpreter, but launches
// debugpy instead of spawning a subprocess.
export async function debugScriptAtPath(
    context: vscode.ExtensionContext,
    scriptPath: string,
    target?: { workspaceId: string; workspaceAuthId: string }
): Promise<void> {
    const prep = await prepareRun(context, scriptPath, target);
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

async function prepareRun(
    context: vscode.ExtensionContext,
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


