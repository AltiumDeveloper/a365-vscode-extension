import * as vscode from 'vscode';
import { AsyncMutex } from '../asyncMutex';
import { ScriptIdentity } from './identity';
import { readStore } from './store';
import { maybePromptForSiblingImport } from './importSibling';

/**
 * Unified script-parameter resolver (Phase 999.3, D-20..D-22; D-09 escape
 * hatch removed in Plan 06 UAT iter 5, 2026-05-25).
 *
 * Single entry point used by BOTH `prepareRun` (local Python runner) and
 * `executeRemoteScript` Block B (remote gloScrExecuteScript). Replaces
 * the three divergent sources Phase 6 D-05 only patched at the surface:
 *   - the never-written workspaceState `altium365.scriptParams.<id>` blob,
 *   - sibling `<name>.params.json` auto-detect (now opt-in via prompt),
 *   - the projectId-prompt fallback (now a no-op; D-22).
 *
 * Resolution priority:
 *   1. Sibling import (D-07/08, local-kind only): one-shot prompt offers
 *      to import `<name>.params.json` as the 'imported' test event.
 *   2. Store read: if a default event is set, return its payload silently
 *      (D-10 — no UI on the happy path).
 *   3. First-run gap (D-11) or stale default → dispatch
 *      `altium365.testEvents.create` / `setDefault` to seed the store.
 *
 * Pitfall 2: nulls/undefined filtered BEFORE String() — identical contract
 * to the legacy remoteExecution.ts:286-294 loop.
 *
 * Pitfall 3: per-identity AsyncMutex ensures concurrent first-run prompts
 * (e.g. side-panel double-click) don't double-fire.
 *
 * CONVENTIONS exception: module-level `resolveMutex` follows the same
 * justification as `asyncMutex.ts` — single-purpose helper with bounded
 * keyspace; not garbage-collected by design.
 */

const resolveMutex = new AsyncMutex();

export interface ResolveOptions {
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
        // (1) Sibling import — D-07/08. Local-kind only, opt-in.
        if (identity.kind === 'local' && promptOnFirstRun) {
            await maybePromptForSiblingImport(ctx, identity.identity, output);
        }

        // (2) Store read.
        const store = readStore(ctx, identity.identity);

        // (3a) First-run gap — D-11. Plan 04: dispatch the create command,
        // which seeds the store and (when autoSetDefault is true OR the
        // store was empty) sets the new event as default. The command
        // returns the new event body so we can route it straight into the
        // run loop without a second store read.
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

        // (3b) Missing default — D-11. Plan 04: dispatch setDefault, then
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

function stringifyEvent(
    obj: Record<string, unknown>,
): Array<{ key: string; value: string }> | undefined {
    const out: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(obj)) {
        // Pitfall 2: filter nulls BEFORE String() — verbatim contract from
        // the legacy remoteExecution.ts:286-294 loop.
        if (value === undefined || value === null) {
            continue;
        }
        out.push({ key, value: String(value) });
    }
    return out.length > 0 ? out : undefined;
}
