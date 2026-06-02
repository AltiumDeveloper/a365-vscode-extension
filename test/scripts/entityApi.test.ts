import { describe, it, expect } from 'vitest';
import { buildScriptUri, parseScriptUri } from '../../src/scripts/remoteFs';

// ── buildScriptUri ↔ parseScriptUri round-trips ────────────────────────────

describe('buildScriptUri / parseScriptUri round-trip', () => {
    const SCRIPT_ID = '550e8400-e29b-41d4-a716-446655440000';

    it('preserves authId, scriptId, and displayName for a simple authId', () => {
        const uri = buildScriptUri('my-team', SCRIPT_ID, 'MyScript');
        const parsed = parseScriptUri(uri);
        expect(parsed.authId).toBe('my-team');
        expect(parsed.scriptId).toBe(SCRIPT_ID);
        expect(parsed.displayName).toBe('MyScript');
    });

    it('preserves authId with hyphens exactly', () => {
        const uri = buildScriptUri('my-long-workspace-name', SCRIPT_ID, 'Script');
        const parsed = parseScriptUri(uri);
        expect(parsed.authId).toBe('my-long-workspace-name');
        expect(parsed.scriptId).toBe(SCRIPT_ID);
    });

    it('preserves scriptName containing spaces', () => {
        const uri = buildScriptUri('team-a', SCRIPT_ID, 'My Script Name');
        const parsed = parseScriptUri(uri);
        expect(parsed.authId).toBe('team-a');
        expect(parsed.scriptId).toBe(SCRIPT_ID);
        expect(parsed.displayName).toBe('My Script Name');
    });

    it('does not throw for scriptName containing slashes (documents actual behaviour)', () => {
        // Slashes are treated as path separators inside the URI path; the
        // displayName after parse captures only the last segment. The important
        // contract is that authId and scriptId are still recovered correctly.
        const uri = buildScriptUri('team-b', SCRIPT_ID, 'scripts/nested');
        expect(() => parseScriptUri(uri)).not.toThrow();
        const parsed = parseScriptUri(uri);
        expect(parsed.authId).toBe('team-b');
        expect(parsed.scriptId).toBe(SCRIPT_ID);
        // displayName may be 'nested' (last path segment) — document as-is
        expect(parsed.displayName).toBeDefined();
    });

    it('multiple distinct round-trips do not bleed into each other', () => {
        const ID_A = '11111111-1111-1111-1111-111111111111';
        const ID_B = '22222222-2222-2222-2222-222222222222';

        const uriA = buildScriptUri('workspace-a', ID_A, 'ScriptA');
        const uriB = buildScriptUri('workspace-b', ID_B, 'ScriptB');

        const parsedA = parseScriptUri(uriA);
        const parsedB = parseScriptUri(uriB);

        expect(parsedA.authId).toBe('workspace-a');
        expect(parsedA.scriptId).toBe(ID_A);
        expect(parsedB.authId).toBe('workspace-b');
        expect(parsedB.scriptId).toBe(ID_B);

        // No cross-bleed
        expect(parsedA.authId).not.toBe(parsedB.authId);
        expect(parsedA.scriptId).not.toBe(parsedB.scriptId);
    });
});
