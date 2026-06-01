import { describe, it, expect } from 'vitest';
import {
    normalizeLocalScriptKey,
    registerLocalScript,
    getLocalScript,
    findLocalScriptByRemoteId,
} from '../src/scripts/localCache';

// Use unique non-existent paths per test to avoid module-level Map interference

// ── normalizeLocalScriptKey ───────────────────────────────────────

describe('normalizeLocalScriptKey', () => {
    it('does not throw for a non-existent path', () => {
        expect(() => normalizeLocalScriptKey('/does-not-exist-11-05-test-path/file.py')).not.toThrow();
    });

    it('returns a string for a non-existent path (fallback)', () => {
        const result = normalizeLocalScriptKey('/does-not-exist-11-05-fallback/file.py');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns lowercased path on darwin/win32', () => {
        if (process.platform !== 'darwin' && process.platform !== 'win32') {
            return; // skip on linux
        }
        const result = normalizeLocalScriptKey('/SOME/UPPER/PATH.PY');
        expect(result).toBe(result.toLowerCase());
    });
});

// ── registerLocalScript + getLocalScript ─────────────────────────

describe('registerLocalScript / getLocalScript', () => {
    it('returns the registered identity after registerLocalScript', () => {
        const fsPath = '/tmp/test-localcache-11-05-1.py';
        registerLocalScript(fsPath, { scriptId: 'uuid-a', workspaceAuthId: 'ws-a', scriptName: 'ScriptA' });
        const result = getLocalScript(normalizeLocalScriptKey(fsPath));
        expect(result).toMatchObject({ scriptId: 'uuid-a', workspaceAuthId: 'ws-a' });
    });

    it('returns undefined for a path not in the registry', () => {
        expect(getLocalScript('/nonexistent-11-05-not-registered.py')).toBeUndefined();
    });
});

// ── findLocalScriptByRemoteId ─────────────────────────────────────

describe('findLocalScriptByRemoteId', () => {
    it('finds a registered entry by scriptId', () => {
        const fsPath = '/tmp/test-localcache-11-05-find.py';
        registerLocalScript(fsPath, { scriptId: 'find-uuid-b', workspaceAuthId: 'ws-b', scriptName: 'ScriptB' });
        const result = findLocalScriptByRemoteId('find-uuid-b');
        expect(result).toBeDefined();
        expect(result!.identity.scriptId).toBe('find-uuid-b');
    });

    it('returns undefined for an unregistered scriptId', () => {
        expect(findLocalScriptByRemoteId('not-registered-uuid-11-05')).toBeUndefined();
    });
});

/*
 * SKIPPED (D-08):
 * ──────────────────────────────────────────────────────────────────
 * rehydrateLocalScriptCacheFromDisk() — reads readdirSync from tmpdir;
 *   requires a stable tmpdir fixture to test meaningfully. Skip.
 *
 * registerLocalScriptSaveBridge() — requires vscode.workspace.onDidSaveTextDocument
 *   (VS Code API heavy, per D-08). Skip.
 */
