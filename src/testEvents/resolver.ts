import * as vscode from 'vscode';
import { AsyncMutex } from '../shared/asyncMutex';
import { type ScriptIdentity } from './identity';
import { readStore } from './store';
import { maybePromptForSiblingImport } from './importSibling';

/**
 * Unified script-parameter resolver.
 *
 * Single entry point used by BOTH `prepareRun` (local Python runner) and
 * `executeRemoteScript` Block B (remote gloScrExecuteScript).
 *
 * Resolution priority:
 *   1. Sibling import (local-kind only): a one-shot prompt offers to import
 *      `<name>.params.json` as the 'imported' test event.
 *   2. Store read: if a default event is set, return its payload silently —
 *      no UI on the happy path.
 *   3. First-run gap or stale default → dispatch
 *      `altium365.testEvents.create` / `setDefault` to seed the store.
 *
 * Nulls and undefined are filtered BEFORE String().
 *
 * A per-identity AsyncMutex stops concurrent first-run prompts (e.g. a
 * side-panel double-click) double-firing. Module-level `resolveMutex` is the
 * same single-purpose-helper exception as `asyncMutex.ts`: bounded keyspace,
 * deliberately not garbage-collected.
 */

const resolveMutex = new AsyncMutex();

interface ResolveOptions {
    promptOnFirstRun?: boolean;
}

export async function resolveScriptParameters(
    ctx: vscode.ExtensionContext,
    identity: ScriptIdentity,
    output: vscode.OutputChannel,
    options: ResolveOptions = {},
): Promise<Array<{ key: string; value: string }> | undefined> {
    const promptOnFirstRun = options.promptOnFirstRun !== false;
    const mutexKey = identity.kind + ':' + identity.identity;

    return resolveMutex.runExclusive(mutexKey, async () => {
        // (1) Sibling import. Local-kind only, opt-in.
        if (identity.kind === 'local' && promptOnFirstRun) {
            await maybePromptForSiblingImport(ctx, identity.identity, output);
        }

        // (2) Store read.
        const store = readStore(ctx, identity.identity);

        // (3a) First-run gap: dispatch the create command, which seeds the
        // store and (when autoSetDefault is true OR the store was empty) sets
        // the new event as default. The command returns the new event body so
        // we can route it straight into the run loop without a second read.
        if (!store || Object.keys(store.events).length === 0) {
            if (!promptOnFirstRun) {
                return undefined;
            }
            output.appendLine(
                `[Altium 365] testEvents.resolver: no events for ${identity.identity}; dispatching testEvents.create`,
            );
            const created = await vscode.commands.executeCommand<
                { name: string; body: Record<string, unknown> } | undefined
            >('altium365.testEvents.create', identity, { autoSetDefault: true });
            if (!created) {
                return undefined;
            }
            return stringifyEvent(created.body);
        }

        // (3b) Missing default: dispatch setDefault, then
        // re-read the store and resolve from the new default. Returns
        // undefined if the user cancelled the picker.
        if (!store.defaultEventName || !store.events[store.defaultEventName]) {
            output.appendLine(
                `[Altium 365] testEvents.resolver: no default event for ${identity.identity}; dispatching testEvents.setDefault`,
            );
            await vscode.commands.executeCommand(
                'altium365.testEvents.setDefault',
                identity,
            );
            const refreshed = readStore(ctx, identity.identity);
            if (
                !refreshed ||
                !refreshed.defaultEventName ||
                !refreshed.events[refreshed.defaultEventName]
            ) {
                return undefined;
            }
            return stringifyEvent(refreshed.events[refreshed.defaultEventName]);
        }

        // (4) Happy path — silent default.
        return stringifyEvent(store.events[store.defaultEventName]);
    });
}

export function stringifyEvent(
    obj: Record<string, unknown>,
): Array<{ key: string; value: string }> | undefined {
    const out: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) {
            continue;
        }
        out.push({ key, value: String(value) });
    }
    return out.length > 0 ? out : undefined;
}
