import * as vscode from 'vscode';
import { getLocalScript, normalizeLocalScriptKey } from '../localScriptCache';

/**
 * Script identity resolver (Phase 999.3, D-04..D-06).
 *
 * Single source of truth for "what identity does this script editor map to?"
 * Branches:
 *   - `altium365://...` URI  → remote, identity = scriptId
 *   - `file://` URI registered in localScriptCache → remote, identity = scriptId
 *   - `file://` URI NOT in cache → local, identity = normalized fsPath
 *   - Any other scheme → undefined (caller treats as unsupported)
 *
 * fsPath fragility (move = orphan) is accepted per D-05.
 *
 * Pure function — no outputChannel, no side effects. Safe to call from
 * activation hot paths and inside loops.
 */

export type ScriptIdentity =
    | { kind: 'remote'; identity: string }
    | { kind: 'local'; identity: string };

// Copied from src/remoteScriptFs.ts (lines 70-71) to avoid pulling FSP
// machinery into this pure module. Keep in sync with the source — both
// must use the same UUID shape for the altium365:// scheme contract.
const UUID_REGEX = /^[0-9a-fA-F-]{36}$/;
const GRID_PATH_REGEX = /^\/grid:workspace:([^:/]+):scripts:script\/([0-9a-fA-F-]{36})(?:\/(.*))?$/;

function parseAltium365Uri(uri: vscode.Uri): string | undefined {
    const m = GRID_PATH_REGEX.exec(uri.path);
    if (!m) {
        return undefined;
    }
    const authId = m[1];
    const scriptId = m[2];
    if (!authId || !UUID_REGEX.test(scriptId)) {
        return undefined;
    }
    return scriptId;
}

export function resolveScriptIdentity(uri: vscode.Uri): ScriptIdentity | undefined {
    if (uri.scheme === 'altium365') {
        const scriptId = parseAltium365Uri(uri);
        if (!scriptId) {
            return undefined;
        }
        return { kind: 'remote', identity: scriptId };
    }
    if (uri.scheme === 'file') {
        const cached = getLocalScript(uri.fsPath);
        if (cached) {
            return { kind: 'remote', identity: cached.scriptId };
        }
        return { kind: 'local', identity: normalizeLocalScriptKey(uri.fsPath) };
    }
    return undefined;
}
