import * as vscode from 'vscode';
import { ScriptIdentity, resolveScriptIdentity } from './identity';
import {
    TestEventStore,
    readStore,
    writeStore,
    deleteEvent,
    setDefault,
    eventCount,
    isBloatWarned,
    markBloatWarned,
} from './store';

/**
 * Soft cap on stored events per script. Crossing this triggers a
 * one-time informational toast (D-21 / RESEARCH §Q9). Not a hard limit
 * — storage continues to function past the threshold.
 */
const BLOAT_WARN_THRESHOLD = 25;
import { pickTestEvent } from './picker';
import { buildEventUri } from './eventFs';
import { pickProjectId } from '../projectPicker';
import { ensureWorkspaceToken, getBaseAccessToken, readOAuthConfig } from '../auth';
import { getSelectedWorkspace, listWorkspaces, WorkspaceInfo } from '../workspace';

/**
 * Test-event commands (Phase 999.3 Plan 04, D-10..D-14).
 *
 * Five palette-eligible commands wrapping the storage/picker/FSP layers
 * from Plans 01-03. All operate on globalState (D-04 — never
 * workspaceState). All resolve a `ScriptIdentity` from either an
 * explicit argument (resolver-path dispatch from resolver.ts) or the
 * active editor's URI (palette-path).
 *
 * CONVENTIONS: registration factory + private `do*` handlers; all
 * command bodies wrap in try/catch with outputChannel + showErrorMessage
 * at the boundary so background failures never surface as raw stack
 * traces.
 *
 * D-13 cancellation: every input/picker dialog that returns undefined
 * is treated as silent abort — no error toast, no console noise beyond
 * a debug-level outputChannel line.
 *
 * Return values: `create` returns `{ name, body }` (or undefined on
 * cancel) so the resolver TODO-stub replacement path can route the
 * newly-created event straight into the run loop without re-reading
 * the store; the other four commands return void.
 */

interface CreateOpts {
    autoSetDefault?: boolean;
}

type CreateResult = { name: string; body: Record<string, unknown> } | undefined;

export function registerTestEventCommands(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(
            'altium365.testEvents.pick',
            async (identity?: ScriptIdentity) => {
                try {
                    await doPickTestEvent(context, outputChannel, identity);
                } catch (err) {
                    surfaceError(outputChannel, 'pick', err);
                }
            },
        ),
        vscode.commands.registerCommand(
            'altium365.testEvents.create',
            async (
                identity?: ScriptIdentity,
                opts?: CreateOpts,
            ): Promise<CreateResult> => {
                try {
                    return await doCreateTestEvent(context, outputChannel, identity, opts);
                } catch (err) {
                    surfaceError(outputChannel, 'create', err);
                    return undefined;
                }
            },
        ),
        vscode.commands.registerCommand(
            'altium365.testEvents.edit',
            async (identity?: ScriptIdentity, name?: string) => {
                try {
                    await doEditTestEvent(context, outputChannel, identity, name);
                } catch (err) {
                    surfaceError(outputChannel, 'edit', err);
                }
            },
        ),
        vscode.commands.registerCommand(
            'altium365.testEvents.delete',
            async (identity?: ScriptIdentity, name?: string) => {
                try {
                    await doDeleteTestEvent(context, outputChannel, identity, name);
                } catch (err) {
                    surfaceError(outputChannel, 'delete', err);
                }
            },
        ),
        vscode.commands.registerCommand(
            'altium365.testEvents.setDefault',
            async (identity?: ScriptIdentity, name?: string) => {
                try {
                    await doSetDefaultTestEvent(context, outputChannel, identity, name);
                } catch (err) {
                    surfaceError(outputChannel, 'setDefault', err);
                }
            },
        ),
    ];
}

function surfaceError(output: vscode.OutputChannel, cmd: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`[Altium 365] testEvents.${cmd} failed: ${msg}`);
    vscode.window.showErrorMessage(`Altium 365: ${cmd} failed — ${msg}`);
}

/**
 * Resolve a ScriptIdentity from an explicit argument or the active
 * editor. Returns undefined and shows a non-blocking warning when no
 * script context is available — callers should early-return.
 */
function resolveIdentityOrWarn(
    identity: ScriptIdentity | undefined,
): ScriptIdentity | undefined {
    if (identity && typeof identity === 'object' && 'kind' in identity && 'identity' in identity) {
        return identity;
    }
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    if (editorUri) {
        const fromEditor = resolveScriptIdentity(editorUri);
        if (fromEditor) {
            return fromEditor;
        }
    }
    vscode.window.showWarningMessage(
        'Altium 365: No active script — open a script editor or invoke from the side panel.',
    );
    return undefined;
}

// ─── Command handlers ───────────────────────────────────────────────

async function doPickTestEvent(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    identityArg: ScriptIdentity | undefined,
): Promise<void> {
    // Unified picker (UAT iter 5, 2026-05-25): single click on the status bar
    // / editor-title menu shows the full picker (events + Create + Edit
    // current) and picking an event SETS IT AS THE DEFAULT. The previous
    // "pick for one run" semantics returned a transient body but never
    // mutated the store, so the status bar indicator never updated and
    // the affordance felt broken. We collapsed pick → setDefault because
    // no caller used the transient body return — the resolver routes
    // through testEvents.create / testEvents.setDefault directly.
    const identity = resolveIdentityOrWarn(identityArg);
    if (!identity) return;

    const store = readStore(context, identity.identity);
    const result = await pickTestEvent(identity.identity, store);
    if (!result) {
        output.appendLine(`[Altium 365] testEvents.pick: cancelled for ${identity.identity}`);
        return;
    }
    if (result.kind === 'event') {
        await setDefault(context, identity.identity, result.name);
        output.appendLine(
            `[Altium 365] testEvents.pick: "${result.name}" is now default for ${identity.identity}`,
        );
        vscode.window.showInformationMessage(
            `Altium 365: Default event set to "${result.name}".`,
        );
        return;
    }
    if (result.kind === 'create') {
        // autoSetDefault: true — user explicitly asked for a new event from
        // the unified picker, they want it active immediately.
        await vscode.commands.executeCommand<CreateResult>(
            'altium365.testEvents.create',
            identity,
            { autoSetDefault: true },
        );
        return;
    }
    if (result.kind === 'edit-default') {
        await vscode.commands.executeCommand('altium365.testEvents.edit', identity);
        return;
    }
    // kind === 'empty' — unreachable in current picker UI but kept for
    // exhaustiveness; treat as cancellation.
    output.appendLine(`[Altium 365] testEvents.pick: no-op (kind=empty) for ${identity.identity}`);
}

async function doCreateTestEvent(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    identityArg: ScriptIdentity | undefined,
    opts: CreateOpts | undefined,
): Promise<CreateResult> {
    const identity = resolveIdentityOrWarn(identityArg);
    if (!identity) return undefined;

    const existingStore = readStore(context, identity.identity);
    const existingNames = new Set(existingStore ? Object.keys(existingStore.events) : []);

    const name = await vscode.window.showInputBox({
        prompt: 'Test event name',
        placeHolder: 'default',
        validateInput: (v) => {
            const trimmed = (v || '').trim();
            if (!trimmed) return 'Name is required';
            if (trimmed.length > 64) return 'Max 64 characters';
            if (trimmed.includes('/')) return 'Slashes are not allowed';
            if (existingNames.has(trimmed)) return `An event named "${trimmed}" already exists`;
            return null;
        },
    });
    if (name === undefined) {
        output.appendLine(`[Altium 365] testEvents.create: name cancelled`);
        return undefined;
    }
    const trimmedName = name.trim();

    type PresetItem = vscode.QuickPickItem & { preset: 'empty' | 'project' };
    const presetItems: PresetItem[] = [
        {
            label: '$(json) Empty',
            description: 'Start with {}',
            preset: 'empty',
        },
        {
            label: '$(project) Project-related',
            description: 'Seed with { projectId: <picked> }',
            preset: 'project',
        },
    ];
    const preset = await vscode.window.showQuickPick(presetItems, {
        placeHolder: 'Choose a starting template',
    });
    if (!preset) {
        output.appendLine(`[Altium 365] testEvents.create: preset cancelled`);
        return undefined;
    }

    let body: Record<string, unknown> = {};
    if (preset.preset === 'project') {
        const pickedProject = await pickProjectIdSafe(context, output, identity);
        if (pickedProject === undefined) {
            output.appendLine(`[Altium 365] testEvents.create: project preset cancelled`);
            return undefined;
        }
        body = { projectId: pickedProject };
    }

    // Write to store.
    const store: TestEventStore = existingStore ?? { defaultEventName: '', events: {} };
    store.events[trimmedName] = body;
    const isFirstEvent = existingNames.size === 0;
    if (opts?.autoSetDefault || isFirstEvent || !store.defaultEventName) {
        store.defaultEventName = trimmedName;
    }
    await writeStore(context, identity.identity, store);
    output.appendLine(
        `[Altium 365] testEvents.create: wrote "${trimmedName}" for ${identity.identity}` +
            (store.defaultEventName === trimmedName ? ' (set as default)' : ''),
    );

    // Bloat warning (D-21): one-time toast when crossing threshold.
    // Fires from .create ONLY — .edit and .setDefault are legitimate
    // maintenance and must not nag the user.
    const totalEvents = Object.keys(store.events).length;
    if (totalEvents > BLOAT_WARN_THRESHOLD && !isBloatWarned(context, identity.identity)) {
        vscode.window.showInformationMessage(
            `[Altium 365] You now have ${totalEvents} test events for this script. Consider deleting unused ones — globalState is shared across all workspaces.`,
        );
        await markBloatWarned(context, identity.identity);
        output.appendLine(
            `[Altium 365] testEvents.create: bloat warning fired for ${identity.identity} at count=${totalEvents}`,
        );
    }

    // Open editor tab for the event.
    try {
        const uri = buildEventUri(identity.identity, trimmedName);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    } catch (e) {
        output.appendLine(
            `[Altium 365] testEvents.create: failed to open editor for "${trimmedName}": ${(e as Error).message}`,
        );
    }

    return { name: trimmedName, body };
}

async function doEditTestEvent(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    identityArg: ScriptIdentity | undefined,
    name: string | undefined,
): Promise<void> {
    const identity = resolveIdentityOrWarn(identityArg);
    if (!identity) return;

    let eventName = name;
    if (!eventName) {
        const store = readStore(context, identity.identity);
        if (!store || Object.keys(store.events).length === 0) {
            vscode.window.showInformationMessage(
                'Altium 365: No test events yet — use "Create Test Event" first.',
            );
            return;
        }
        const result = await pickTestEvent(identity.identity, store, {
            eventsOnly: true,
            headerLabel: 'Pick event to edit',
        });
        if (!result || result.kind !== 'event') {
            output.appendLine(`[Altium 365] testEvents.edit: cancelled`);
            return;
        }
        eventName = result.name;
    }

    const uri = buildEventUri(identity.identity, eventName);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
}

async function doDeleteTestEvent(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    identityArg: ScriptIdentity | undefined,
    name: string | undefined,
): Promise<void> {
    const identity = resolveIdentityOrWarn(identityArg);
    if (!identity) return;

    let eventName = name;
    if (!eventName) {
        const store = readStore(context, identity.identity);
        if (!store || Object.keys(store.events).length === 0) {
            vscode.window.showInformationMessage('Altium 365: No test events to delete.');
            return;
        }
        const result = await pickTestEvent(identity.identity, store, {
            eventsOnly: true,
            headerLabel: 'Pick event to delete',
        });
        if (!result || result.kind !== 'event') {
            output.appendLine(`[Altium 365] testEvents.delete: cancelled`);
            return;
        }
        eventName = result.name;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Delete test event "${eventName}"? This cannot be undone.`,
        { modal: true },
        'Delete',
    );
    if (confirm !== 'Delete') {
        output.appendLine(`[Altium 365] testEvents.delete: cancelled by user`);
        return;
    }
    await deleteEvent(context, identity.identity, eventName);
    output.appendLine(
        `[Altium 365] testEvents.delete: removed "${eventName}" from ${identity.identity}` +
            ` (remaining: ${eventCount(context, identity.identity)})`,
    );
}

async function doSetDefaultTestEvent(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    identityArg: ScriptIdentity | undefined,
    name: string | undefined,
): Promise<void> {
    const identity = resolveIdentityOrWarn(identityArg);
    if (!identity) return;

    let eventName = name;
    if (!eventName) {
        const store = readStore(context, identity.identity);
        if (!store || Object.keys(store.events).length === 0) {
            const offerCreate = await vscode.window.showInformationMessage(
                'Altium 365: No test events yet. Create one now?',
                'Create',
            );
            if (offerCreate === 'Create') {
                await vscode.commands.executeCommand('altium365.testEvents.create', identity, {
                    autoSetDefault: true,
                });
            }
            return;
        }
        const result = await pickTestEvent(identity.identity, store, {
            eventsOnly: true,
            headerLabel: 'Pick event to set as default',
        });
        if (!result || result.kind !== 'event') {
            output.appendLine(`[Altium 365] testEvents.setDefault: cancelled`);
            return;
        }
        eventName = result.name;
    }

    await setDefault(context, identity.identity, eventName);
    output.appendLine(
        `[Altium 365] testEvents.setDefault: "${eventName}" is now default for ${identity.identity}`,
    );
    vscode.window.showInformationMessage(`Altium 365: Default event set to "${eventName}".`);
}

// ─── Preset helpers ─────────────────────────────────────────────────

/**
 * Wraps `pickProjectId` with the auth orchestration it needs and three
 * fallback paths so the Project-related preset works in every script
 * context — including cross-workspace (remote script not owned by the
 * active workspace) and offline (no active workspace at all).
 *
 * Resolution order:
 *   1. Remote script identity carries `workspaceAuthId` → look up the
 *      script's own WorkspaceInfo via `listWorkspaces` and use THAT
 *      workspace's project list (not the active workspace). Required
 *      so that a Create on an Edit-opened remote script always offers
 *      projects from the script's home workspace.
 *   2. Local script + active workspace selected → use the active
 *      workspace (legacy behaviour, unchanged).
 *   3. Local script + NO active workspace → 2-option QuickPick:
 *      a. "Select workspace first" — dispatches `altium365.selectWorkspace`
 *         then retries against the new selection.
 *      b. "Enter project ID manually" — falls through to a plain input box.
 *      (Cancel returns undefined.)
 *
 * Token-mint failures at any branch fall back to manual entry rather
 * than aborting the create flow.
 */
async function pickProjectIdSafe(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    identity: ScriptIdentity,
): Promise<string | undefined> {
    const endpoint = vscode.workspace
        .getConfiguration('altium365')
        .get<string>('graphqlEndpoint', '');
    const cfg = readOAuthConfig();

    // Branch 1 — remote script: prefer the script's owning workspace
    // over the active one. This is the "of course the context is the
    // script's workspace" case that surfaced in UAT.
    if (
        identity.kind === 'remote' &&
        identity.workspaceAuthId &&
        endpoint
    ) {
        const ws = await lookupWorkspaceByAuthId(
            context,
            cfg,
            endpoint,
            identity.workspaceAuthId,
            output,
        );
        if (ws) {
            return mintAndPickProject(context, cfg, endpoint, ws, output);
        }
        output.appendLine(
            `[Altium 365] testEvents.create: could not resolve workspace for authId=${identity.workspaceAuthId}; falling back to active workspace`,
        );
    }

    // Branch 2 — local (or remote without workspaceAuthId) with an
    // active workspace selected.
    const active = getSelectedWorkspace(context);
    if (active && endpoint) {
        return mintAndPickProject(context, cfg, endpoint, active, output);
    }

    // Branch 3 — no active workspace. Offer Select-vs-Manual instead
    // of silently dropping to a free-text input.
    return offerSelectOrManual(context, output, endpoint, cfg);
}

async function lookupWorkspaceByAuthId(
    context: vscode.ExtensionContext,
    cfg: ReturnType<typeof readOAuthConfig>,
    endpoint: string,
    authId: string,
    output: vscode.OutputChannel,
): Promise<WorkspaceInfo | undefined> {
    try {
        const baseToken = await getBaseAccessToken(context, cfg);
        if (!baseToken) {
            return undefined;
        }
        const all = await listWorkspaces(endpoint, baseToken);
        return all.find((w) => w.authId === authId);
    } catch (e) {
        output.appendLine(
            `[Altium 365] testEvents.create: workspace lookup by authId failed: ${(e as Error).message}`,
        );
        return undefined;
    }
}

async function mintAndPickProject(
    context: vscode.ExtensionContext,
    cfg: ReturnType<typeof readOAuthConfig>,
    endpoint: string,
    ws: WorkspaceInfo,
    output: vscode.OutputChannel,
): Promise<string | undefined> {
    let token: string;
    try {
        token = await ensureWorkspaceToken(context, cfg, {
            workspaceId: ws.workspaceId,
            authId: ws.authId,
        });
    } catch (e) {
        output.appendLine(
            `[Altium 365] testEvents.create: workspace token mint failed for "${ws.name}": ${(e as Error).message}`,
        );
        const entered = await vscode.window.showInputBox({
            prompt: `Enter projectId (token mint failed for "${ws.name}")`,
            placeHolder: 'projectId GUID',
            ignoreFocusOut: true,
        });
        return entered === undefined ? undefined : entered.trim();
    }
    return pickProjectId(context, endpoint, token, '', ws, output);
}

async function offerSelectOrManual(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    endpoint: string,
    cfg: ReturnType<typeof readOAuthConfig>,
): Promise<string | undefined> {
    type FallbackItem = vscode.QuickPickItem & { action: 'select' | 'manual' };
    const items: FallbackItem[] = [
        {
            label: '$(symbol-namespace) Select workspace first',
            description: 'Pick an Altium 365 workspace, then load its project list',
            action: 'select',
        },
        {
            label: '$(edit) Enter project ID manually',
            description: 'Type or paste a projectId GUID',
            action: 'manual',
        },
    ];
    const choice = await vscode.window.showQuickPick(items, {
        placeHolder: 'No active workspace — how do you want to set the projectId?',
        ignoreFocusOut: true,
    });
    if (!choice) {
        return undefined;
    }
    if (choice.action === 'manual') {
        const entered = await vscode.window.showInputBox({
            prompt: 'Enter projectId',
            placeHolder: 'projectId GUID',
            ignoreFocusOut: true,
        });
        return entered === undefined ? undefined : entered.trim();
    }
    // 'select' — invoke selectWorkspace, then re-check.
    await vscode.commands.executeCommand('altium365.selectWorkspace');
    const nowActive = getSelectedWorkspace(context);
    if (!nowActive || !endpoint) {
        output.appendLine(
            `[Altium 365] testEvents.create: workspace still unset after selectWorkspace; aborting`,
        );
        return undefined;
    }
    return mintAndPickProject(context, cfg, endpoint, nowActive, output);
}
