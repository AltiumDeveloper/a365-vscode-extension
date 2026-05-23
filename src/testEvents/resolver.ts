import * as vscode from 'vscode';
import * as fs from 'fs';
import { AsyncMutex } from '../asyncMutex';
import { ScriptIdentity } from './identity';
import { readStore } from './store';
import { maybePromptForSiblingImport } from './importSibling';

/**
 * Unified script-parameter resolver (Phase 999.3, D-20..D-22).
 *
 * Single entry point used by BOTH `prepareRun` (local Python runner) and
 * `executeRemoteScript` Block B (remote gloScrExecuteScript). Replaces the
 * three divergent sources Phase 6 D-05 only patched at the surface:
 *   - the never-written workspaceState `altium365.scriptParams.<id>` blob,
 *   - sibling `<name>.params.json` auto-detect (now opt-in via prompt),
 *   - the projectId-prompt fallback (now a no-op; D-22).
 *
 * Resolution priority:
 *   1. Escape hatch (D-09): `altium365.inputParametersPath` setting wins
 *      unconditionally — parses + returns its contents.
 *   2. Sibling import (D-07/08, local-kind only): one-shot prompt offers
 *      to import `<name>.params.json` as the 'imported' test event.
 *   3. Store read: if a default event is set, return its payload silently
 *      (D-10 — no UI on the happy path).
 *   4. First-run gap (D-11) or stale default → stub-log + return undefined
 *      (Plan 04 will replace stubs with command dispatch to
 *      `altium365.testEvents.create` / `setDefault`).
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
        // (1) Escape hatch — D-09. Wins unconditionally.
        const explicit = (
            vscode.workspace.getConfiguration('altium365').get<string>('inputParametersPath') || ''
        ).trim();
        if (explicit) {
            if (!fs.existsSync(explicit)) {
                output.appendLine(
                    `[Altium 365] resolveScriptParameters: inputParametersPath '${explicit}' does not exist; ignoring`,
                );
            } else {
                try {
                    const raw = fs.readFileSync(explicit, 'utf-8');
                    const parsed = JSON.parse(raw);
                    if (!parsed || typeof parsed !== 'object') {
                        output.appendLine(
                            `[Altium 365] resolveScriptParameters: ${explicit} is not a JSON object; ignoring`,
                        );
                        return undefined;
                    }
                    return stringifyEvent(parsed as Record<string, unknown>);
                } catch (e) {
                    output.appendLine(
                        `[Altium 365] resolveScriptParameters: failed to read ${explicit}: ${(e as Error).message}`,
                    );
                    return undefined;
                }
            }
        }

        // (2) Sibling import — D-07/08. Local-kind only, opt-in.
        if (identity.kind === 'local' && promptOnFirstRun) {
            await maybePromptForSiblingImport(ctx, identity.identity, output);
        }

        // (3) Store read.
        const store = readStore(ctx, identity.identity);

        // (4a) First-run gap — D-11.
        if (!store || Object.keys(store.events).length === 0) {
            if (!promptOnFirstRun) {
                return undefined;
            }
            output.appendLine(
                `[Altium 365] resolveScriptParameters: no events for ${identity.identity}; first-run create UI deferred to 999.3-04`,
            );
            // TODO(999.3-04): dispatch vscode.commands.executeCommand('altium365.testEvents.create', identity)
            // and re-read the store; until then, return undefined so the caller sees a clean "no params" path.
            return undefined;
        }

        // (4b) Missing default — D-11.
        if (!store.defaultEventName || !store.events[store.defaultEventName]) {
            output.appendLine(
                `[Altium 365] resolveScriptParameters: no default event for ${identity.identity}; setDefault UI deferred to 999.3-04`,
            );
            // TODO(999.3-04): dispatch vscode.commands.executeCommand('altium365.testEvents.setDefault', identity)
            // and re-read the store; until then, return undefined.
            return undefined;
        }

        // (5) Happy path — silent default.
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
