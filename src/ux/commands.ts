import * as vscode from 'vscode';
import {
    clearAllTokens,
    ensureWorkspaceToken,
    fireAuthStateChanged,
    getStoredTokens,
    readOAuthConfig,
    signIn,
} from '../auth';
import { resolveConfig } from '../config';
import {
    setSelectedWorkspace,
    clearSelectedWorkspace,
    pickWorkspace,
    type WorkspaceInfo,
} from '../workspace';
import { runScriptAtPath, debugScriptAtPath } from '../runner';
import { getLocalScript } from '../scripts/localCache';

// ── Auth context helpers ───────────────────────────────────────────────────

export async function updateSignedInContext(context: vscode.ExtensionContext): Promise<void> {
    try {
        const tok = await getStoredTokens(context);
        await vscode.commands.executeCommand('setContext', 'altium365.signedIn', !!tok);
    } catch {
        // best-effort — worst case is welcome view stays visible (recoverable)
    }
}

// ── Auth command handlers ──────────────────────────────────────────────────

export async function doSignIn(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const cfg = readOAuthConfig();
    if (!cfg.clientId || !cfg.authEndpoint || !cfg.tokenEndpoint) {
        vscode.window.showErrorMessage(
            'Configure altium365.clientId, altium365.authEndpoint and altium365.tokenEndpoint first.'
        );
        return;
    }
    if (!cfg.actionWaitEndpoint || !cfg.redirectUri) {
        vscode.window.showErrorMessage(
            "Altium 365: actionWaitEndpoint or redirectUri are not configured. Select an environment via 'Altium Developer: Select Environment'."
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

        // Silent cancellation — the closing progress notification IS the feedback.
        if (msg === 'Sign-in cancelled.') {
            return;
        }

        // CSRF guard (exact match)
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

        // Network error during poll — message format: 'ActionWait network error: <err> (<host>)'
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

        // ActionWait non-2xx HTTP status — message format: 'ActionWait returned <status>: <body>'
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
        // to OutputChannel so debugging is possible.
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

        // Token endpoint failure without a parseable OAuth error, or anything else.
        vscode.window.showErrorMessage(`Sign-in failed: ${msg}`);
    }
}

export async function doSignOut(context: vscode.ExtensionContext): Promise<void> {
    await clearAllTokens(context, { revokeWith: readOAuthConfig() });
    await clearSelectedWorkspace(context);
    vscode.window.showInformationMessage('Altium 365: signed out.');
}

// ── Workspace command handlers ─────────────────────────────────────────────

export async function doSelectWorkspace(context: vscode.ExtensionContext): Promise<void> {
    const cfg = readOAuthConfig();
    const endpoint = resolveConfig().graphqlEndpoint;
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
 * Factored out of `doSelectWorkspace` + `pickAndExchangeWorkspace` so the
 * tree-context-menu command `altium365.workspace.selectFromNode` can reuse the
 * exact same activation path (token exchange, globalState write, tree refresh,
 * status bar refresh) without going through a QuickPick.
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
        await setSelectedWorkspace(context, workspace);
        vscode.window.showInformationMessage('Altium 365: workspace token acquired.');
        // Refresh the side panel so the active-workspace cue follows the
        // user's explicit selection without waiting for sign-in/out.
        await vscode.commands.executeCommand('altium365.tree.refresh');
    } catch (e) {
        vscode.window.showErrorMessage(
            `Workspace token exchange failed: ${(e as Error).message}`
        );
    }
}

// ── Environment command handler ────────────────────────────────────────────

interface EnvironmentSpec {
    graphqlEndpoint?: string;
    authEndpoint?: string;
    tokenEndpoint?: string;
    actionWaitEndpoint?: string;
    redirectUri?: string;
    scopes?: string;
}

export async function doSelectEnvironment(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): Promise<void> {
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

    // Capture before the switch: afterwards readOAuthConfig() returns the new
    // environment's endpoints, and the old token must be revoked at the old server.
    const previousOAuth = readOAuthConfig();

    const target = vscode.ConfigurationTarget.Global;
    await cfg.update('activeEnvironment', pick.name, target);

    const resolved = resolveConfig();
    outputChannel.appendLine(`[Altium 365] Active environment: ${pick.name}`);
    outputChannel.appendLine(`[Altium 365]   graphql:    ${resolved.graphqlEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   auth:       ${resolved.authEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   token:      ${resolved.tokenEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   actionWait: ${resolved.actionWaitEndpoint || '(empty)'}`);
    outputChannel.appendLine(`[Altium 365]   redirect:   ${resolved.redirectUri || '(empty)'}`);

    // Tokens and selected workspace are environment-bound — offer to clear them.
    // IMPORTANT: do NOT fire authStateChanged before
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
        await clearAllTokens(context, { revokeWith: previousOAuth });
        await clearSelectedWorkspace(context);
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
        await doSignIn(context, outputChannel);
    }
}

// ── Status bar click handler ───────────────────────────────────────────────

export async function onStatusBarClick(outputChannel: vscode.OutputChannel): Promise<void> {
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

// ── Run / debug command handlers ───────────────────────────────────────────
//
// For remote scripts the workspace context is embedded in the URI or the local
// script cache — we never want to prompt the user when the context is known.
//
// Routing logic:
//   1. `altium365:` URI (script opened directly via FSP) → delegate to
//      `altium365.script.runLocal` / `debugLocal`, which download to tmp and
//      carry the workspace target from the URI.
//   2. `file:` URI tracked in localScriptCache (tmp file from Edit/Run/Debug)
//      → extract workspaceAuthId from cache and pass as `target`; no prompt.
//   3. `file:` URI not in cache → pure local script; use active workspace
//      (prepareRun will prompt only if none is selected).

export async function runScript(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    uri?: vscode.Uri
): Promise<void> {
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
    // Remote script opened directly via altium365: FSP — delegate so the
    // workspace target is resolved from the URI (no workspace prompt).
    if (target.scheme === 'altium365') {
        await vscode.commands.executeCommand('altium365.script.runLocal');
        return;
    }
    // Tmp file from Edit/Run/Debug — workspace identity is in localScriptCache.
    const cached = target.scheme === 'file' ? getLocalScript(target.fsPath) : undefined;
    const runTarget = cached
        ? { workspaceId: '', workspaceAuthId: cached.workspaceAuthId }
        : undefined;
    await runScriptAtPath(context, outputChannel, target.fsPath, runTarget);
}

export async function debugScript(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    uri?: vscode.Uri
): Promise<void> {
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
    // Remote script opened directly via altium365: FSP — delegate so the
    // workspace target is resolved from the URI (no workspace prompt).
    if (target.scheme === 'altium365') {
        await vscode.commands.executeCommand('altium365.script.debugLocal');
        return;
    }
    // Tmp file from Edit/Run/Debug — workspace identity is in localScriptCache.
    const cached = target.scheme === 'file' ? getLocalScript(target.fsPath) : undefined;
    const runTarget = cached
        ? { workspaceId: '', workspaceAuthId: cached.workspaceAuthId }
        : undefined;
    await debugScriptAtPath(context, outputChannel, target.fsPath, runTarget);
}
