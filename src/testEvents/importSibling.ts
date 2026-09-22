import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { readStore, writeStore } from './store';

/**
 * One-shot sibling-import flow.
 *
 * If a local script has a `<name>.params.json` sibling AND no test events
 * are stored AND the user hasn't already declined, surfaces a non-modal
 * 3-button info toast offering Import / Not now / Never. On Import, the
 * file contents become the `imported` event and the marker key is set to
 * the sibling absolute path. On Never, the marker becomes '__declined__'
 * and the prompt never fires again for this identity.
 *
 * The sibling file is NEVER deleted.
 */

const IMPORT_MARKER_PREFIX = 'altium365.scriptParams.importedFrom.';
const DECLINED_MARKER = '__declined__';

export async function maybePromptForSiblingImport(
    ctx: vscode.ExtensionContext,
    identity: string,
    output: vscode.OutputChannel,
): Promise<void> {
    const markerKey = IMPORT_MARKER_PREFIX + identity;
    const existingMarker = ctx.globalState.get<string>(markerKey);
    if (existingMarker) {
        return;
    }
    if (readStore(ctx, identity) !== undefined) {
        return;
    }
    const sibling = path.join(
        path.dirname(identity),
        path.basename(identity, path.extname(identity)) + '.params.json',
    );
    if (!fs.existsSync(sibling)) {
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        `Found ${path.basename(sibling)} next to this script. Import as a test event?`,
        { modal: false },
        'Import',
        'Not now',
        'Never for this file',
    );

    if (choice === 'Never for this file') {
        await ctx.globalState.update(markerKey, DECLINED_MARKER);
        output.appendLine(`[Altium 365] testEvents.importSibling: user declined import of ${sibling}`);
        return;
    }
    if (choice !== 'Import') {
        return;
    }

    try {
        const raw = fs.readFileSync(sibling, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('sibling .params.json must be a JSON object');
        }
        await writeStore(ctx, identity, {
            defaultEventName: 'imported',
            events: { imported: parsed as Record<string, unknown> },
        });
        await ctx.globalState.update(markerKey, sibling);
        output.appendLine(`[Altium 365] testEvents.importSibling: imported ${sibling} as 'imported'`);
    } catch (e) {
        const msg = (e as Error).message;
        vscode.window.showErrorMessage(
            `Altium 365: failed to import ${path.basename(sibling)}: ${msg}`,
        );
        output.appendLine(`[Altium 365] testEvents.importSibling: failed to import ${sibling}: ${msg}`);
    }
}
