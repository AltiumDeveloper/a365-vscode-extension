import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ScriptIdentity, resolveScriptIdentity } from './identity';
import {
    TestEventStore,
    readStore,
    writeStore,
    deleteEvent,
    setDefault,
    eventCount,
} from './store';
import { pickTestEvent } from './picker';
import { buildEventUri } from './eventFs';
import { pickProjectId } from '../projectPicker';
import { ensureWorkspaceToken, readOAuthConfig } from '../auth';
import { getSelectedWorkspace } from '../workspace';

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
                    return await doPickTestEvent(context, outputChannel, identity);
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
): Promise<Record<string, unknown> | undefined> {
    const identity = resolveIdentityOrWarn(identityArg);
    if (!identity) return undefined;

    const store = readStore(context, identity.identity);
    const result = await pickTestEvent(identity.identity, store);
    if (!result) {
        output.appendLine(`[Altium 365] testEvents.pick: cancelled for ${identity.identity}`);
        return undefined;
    }
    if (result.kind === 'event') {
        output.appendLine(
            `[Altium 365] testEvents.pick: selected "${result.name}" for ${identity.identity}`,
        );
        return result.body;
    }
    if (result.kind === 'create') {
        const created = await vscode.commands.executeCommand<CreateResult>(
            'altium365.testEvents.create',
            identity,
        );
        return created?.body;
    }
    if (result.kind === 'edit-default') {
        await vscode.commands.executeCommand('altium365.testEvents.edit', identity);
        return undefined;
    }
    // kind === 'empty'
    output.appendLine(`[Altium 365] testEvents.pick: run with empty params`);
    return {};
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

    type PresetItem = vscode.QuickPickItem & { preset: 'empty' | 'project' | 'settings' };
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
        {
            label: '$(file-code) From settings.inputParametersPath',
            description: 'Read JSON from altium365.inputParametersPath',
            preset: 'settings',
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
        const pickedProject = await pickProjectIdSafe(context, output);
        if (pickedProject === undefined) {
            output.appendLine(`[Altium 365] testEvents.create: project preset cancelled`);
            return undefined;
        }
        body = { projectId: pickedProject };
    } else if (preset.preset === 'settings') {
        body = await readSettingsSeed(output);
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
 * Wraps `pickProjectId` with the auth orchestration it needs (active
 * workspace + minted token + endpoint). If no workspace is selected or
 * token mint fails, falls back to a plain showInputBox so the preset
 * still works in offline / unauthenticated scenarios.
 */
async function pickProjectIdSafe(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): Promise<string | undefined> {
    const ws = getSelectedWorkspace(context);
    const endpoint = vscode.workspace
        .getConfiguration('altium365')
        .get<string>('graphqlEndpoint', '');
    if (!ws || !endpoint) {
        const entered = await vscode.window.showInputBox({
            prompt: 'Enter projectId (no active workspace — list unavailable)',
            placeHolder: 'projectId GUID',
            ignoreFocusOut: true,
        });
        return entered === undefined ? undefined : entered.trim();
    }
    let token: string;
    try {
        token = await ensureWorkspaceToken(context, readOAuthConfig(), {
            workspaceId: ws.workspaceId,
            authId: ws.authId,
        });
    } catch (e) {
        output.appendLine(
            `[Altium 365] testEvents.create: workspace token mint failed: ${(e as Error).message}`,
        );
        const entered = await vscode.window.showInputBox({
            prompt: 'Enter projectId (could not mint workspace token)',
            placeHolder: 'projectId GUID',
            ignoreFocusOut: true,
        });
        return entered === undefined ? undefined : entered.trim();
    }
    return pickProjectId(context, endpoint, token, '', ws, output);
}

/**
 * Reads `altium365.inputParametersPath` setting, resolves relative to
 * the first workspace folder, JSON.parses, and returns the body. On
 * any error surfaces a non-blocking warning and returns {} so the
 * create flow proceeds.
 */
async function readSettingsSeed(
    output: vscode.OutputChannel,
): Promise<Record<string, unknown>> {
    const raw = (
        vscode.workspace.getConfiguration('altium365').get<string>('inputParametersPath') || ''
    ).trim();
    if (!raw) {
        vscode.window.showWarningMessage(
            'Altium 365: altium365.inputParametersPath is not set — starting from empty.',
        );
        return {};
    }
    let resolved = raw;
    if (!path.isAbsolute(raw)) {
        const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsFolder) {
            resolved = path.join(wsFolder, raw);
        }
    }
    try {
        const buf = await fs.readFile(resolved, 'utf-8');
        const parsed = JSON.parse(buf);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            vscode.window.showWarningMessage(
                `Altium 365: ${resolved} is not a JSON object — starting from empty.`,
            );
            return {};
        }
        return parsed as Record<string, unknown>;
    } catch (e) {
        vscode.window.showWarningMessage(
            `Altium 365: Could not read inputParametersPath: ${(e as Error).message}. Starting from empty.`,
        );
        output.appendLine(
            `[Altium 365] testEvents.create: readSettingsSeed failed (${resolved}): ${(e as Error).message}`,
        );
        return {};
    }
}
