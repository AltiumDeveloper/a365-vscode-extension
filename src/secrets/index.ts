import * as vscode from 'vscode';
import * as fs from 'fs';
import { getScriptSecrets } from '../workspace';
import type { ScriptIdentity } from '../testEvents/identity';

const KEY_PREFIX = 'altium365.localSecrets.';
const GET_SECRET_CALL = /\bget_secret\(\s*(['"])([^'"\\]+)\1\s*\)/g;

export type LocalSecrets = Record<string, string>;

/** Local secret values for a workspace, stored in SecretStorage as one JSON map. */
export async function readLocalSecrets(
    context: vscode.ExtensionContext,
    workspaceId: string
): Promise<LocalSecrets> {
    const raw = await context.secrets.get(KEY_PREFIX + workspaceId);
    if (!raw) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as LocalSecrets)
            : {};
    } catch {
        return {};
    }
}

export async function writeLocalSecrets(
    context: vscode.ExtensionContext,
    workspaceId: string,
    values: LocalSecrets
): Promise<void> {
    if (Object.keys(values).length === 0) {
        await context.secrets.delete(KEY_PREFIX + workspaceId);
        return;
    }
    await context.secrets.store(KEY_PREFIX + workspaceId, JSON.stringify(values));
}

/** Names passed as string literals to `get_secret(...)` in a script's source. */
export function scanSecretNames(source: string): string[] {
    return [...new Set([...source.matchAll(GET_SECRET_CALL)].map((m) => m[2]))];
}

export function promptSecretValue(name: string, workspaceName: string): Thenable<string | undefined> {
    return vscode.window.showInputBox({
        title: `Local value for secret "${name}"`,
        prompt: `Used by local runs in ${workspaceName}. Stored in VS Code secret storage.`,
        password: true,
        ignoreFocusOut: true,
    });
}

interface RunSecretsArgs {
    identity: ScriptIdentity;
    scriptPath: string;
    workspace: { workspaceId: string; name: string };
    endpoint: string;
    token: string;
}

/**
 * Secret values to deliver to one local run, prompting for any the script needs that have no
 * local value. Returns undefined when the user cancels a prompt.
 */
export async function resolveRunSecrets(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    args: RunSecretsArgs
): Promise<LocalSecrets | undefined> {
    const workspaceId = args.workspace.workspaceId;
    const needed = await neededSecretNames(output, args);
    let stored = await readLocalSecrets(context, workspaceId);

    for (const name of needed.names) {
        if (name in stored) {
            continue;
        }
        const value = await promptSecretValue(name, args.workspace.name);
        if (value === undefined) {
            return undefined;
        }
        stored = await setLocalSecret(context, workspaceId, name, value);
    }

    if (needed.passAllStored) {
        return stored;
    }
    return Object.fromEntries(needed.names.map((name) => [name, stored[name]]));
}

/** Saves one value over a fresh read, so concurrent prompts for other names are not lost. */
export async function setLocalSecret(
    context: vscode.ExtensionContext,
    workspaceId: string,
    name: string,
    value: string
): Promise<LocalSecrets> {
    const values = { ...(await readLocalSecrets(context, workspaceId)), [name]: value };
    await writeLocalSecrets(context, workspaceId, values);
    return values;
}

async function neededSecretNames(
    output: vscode.OutputChannel,
    args: RunSecretsArgs
): Promise<{ names: string[]; passAllStored: boolean }> {
    const scanned = () => scanSecretNames(fs.readFileSync(args.scriptPath, 'utf-8'));
    if (args.identity.kind === 'local') {
        return { names: scanned(), passAllStored: true };
    }
    let declared;
    try {
        declared = await getScriptSecrets(args.endpoint, args.token, args.identity.identity);
    } catch (e) {
        output.appendLine(
            `[Altium 365] Could not read the script's declared secrets (${(e as Error).message}). ` +
                'Passing every local secret stored for this workspace.'
        );
        return { names: scanned(), passAllStored: true };
    }
    for (const s of declared.filter((d) => d.isMissing)) {
        output.appendLine(
            `[Altium 365] Secret "${s.name}" is declared on this script but no longer exists in the workspace, so it is not passed.`
        );
    }
    return { names: declared.filter((d) => !d.isMissing).map((d) => d.name), passAllStored: false };
}
