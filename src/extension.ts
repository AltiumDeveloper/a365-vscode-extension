import * as vscode from 'vscode';
import { onAuthStateChanged } from './auth';
import { type A365Node, A365TreeDataProvider } from './ux/panel';
import { createStatusBar } from './ux/statusBar';
import { registerScriptCommands } from './scripts/commands';
import { registerTreeCommands } from './ux/treeCommands';
import { AltiumRemoteScriptFs } from './scripts/remoteFs';
import { ensureSandboxDeps } from './runner/sandbox';
import { registerLocalScriptSaveBridge, getLocalScript, rehydrateLocalScriptCacheFromDisk } from './scripts/localCache';
import { TestEventFs } from './testEvents/eventFs';
import { registerTestEventCommands } from './testEvents/commands';
import { registerTestEventStatusItem } from './testEvents/statusItem';
import { registerPythonAnalysisSync } from './runner/pythonAnalysis';
import { registerRunLifecycle, resolvePythonPath } from './runner';
import { resolveConfig } from './config';
import {
    doSignIn,
    doSignOut,
    doSelectWorkspace,
    doSelectEnvironment,
    applyWorkspaceSelection,
    updateSignedInContext,
    onStatusBarClick,
    runScript,
    debugScript,
} from './ux/commands';

export { applyWorkspaceSelection };

let outputChannel: vscode.OutputChannel;

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
        () => resolveConfig().graphqlEndpoint
    );
    const treeView = vscode.window.createTreeView('altium365.tree', {
        treeDataProvider: treeProvider,
    });

    // Show the active environment name directly in
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
        () => resolveConfig().graphqlEndpoint,
        outputChannel
    );
    const fsRegistration = vscode.workspace.registerFileSystemProvider(
        'altium365',
        remoteFs,
        { isCaseSensitive: true, isReadonly: false }
    );

    // Writable virtual scheme backing test-event JSON tabs.
    // Cmd+S commits via TestEventFs.writeFile → writeStore.
    const testEventFs = new TestEventFs(context, outputChannel);
    const testEventFsRegistration = vscode.workspace.registerFileSystemProvider(
        'altium365-event',
        testEventFs,
        { isCaseSensitive: true, isReadonly: false }
    );

    const scriptCommandDisposables = registerScriptCommands(context, outputChannel);
    const treeCommandDisposables = registerTreeCommands(context, outputChannel);
    const testEventCommandDisposables = registerTestEventCommands(context, outputChannel);

    // Rehydrate the localScriptCache from the on-disk GRID layout
    // BEFORE registering the status bar item so its initial refresh() call sees
    // the correct remote identity for any restored tmp-file tab. Also required
    // before the active-remote context key seed below. Sync I/O is intentional —
    // async rehydration loses the race against both callers.
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

    const testEventStatusDisposables = registerTestEventStatusItem(context);
    const localScriptSaveBridge = registerLocalScriptSaveBridge(context, outputChannel, remoteFs);
    const pythonAnalysisSyncDisposables = registerPythonAnalysisSync(context, outputChannel);

    context.subscriptions.push(
        outputChannel,
        fsRegistration,
        testEventFsRegistration,
        vscode.commands.registerCommand('altium365.signIn', () => doSignIn(context, outputChannel)),
        vscode.commands.registerCommand('altium365.signOut', () => doSignOut(context)),
        vscode.commands.registerCommand('altium365.selectWorkspace', () =>
            doSelectWorkspace(context)
        ),
        vscode.commands.registerCommand('altium365.runScript', (uri?: vscode.Uri) =>
            runScript(context, outputChannel, uri)
        ),
        vscode.commands.registerCommand('altium365.debugScript', (uri?: vscode.Uri) =>
            debugScript(context, outputChannel, uri)
        ),
        vscode.commands.registerCommand('altium365.selectEnvironment', () =>
            doSelectEnvironment(context, outputChannel)
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
            treeProvider.refresh();
            await updateSignedInContext(context);
        }),
        // Refresh tree view title when the active
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
        vscode.commands.registerCommand('altium365.statusBar.click', () => onStatusBarClick(outputChannel)),
        ...scriptCommandDisposables,
        ...treeCommandDisposables,
        ...testEventCommandDisposables,
        ...testEventStatusDisposables,
        localScriptSaveBridge,
        ...pythonAnalysisSyncDisposables
    );

    // Activation boot line for the output channel. Filters out bloatWarned.*
    // meta-keys so the count reflects scripts with stored events, not the
    // flag-tracking sidecar.
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

    // Seed BEFORE listener registration so submenu
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

    context.subscriptions.push(registerRunLifecycle(outputChannel));

    void updateSignedInContext(context);
}

export function deactivate() {}
