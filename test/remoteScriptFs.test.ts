import { describe, it, expect } from 'vitest';
import { buildScriptUri, parseScriptUri } from '../src/remoteScriptFs';

const VALID_AUTH_ID = 'my-team';
const VALID_SCRIPT_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeUri(scheme: string, path: string): any {
    return { scheme, path, authority: '', query: '', fragment: '', fsPath: path, toString: () => `${scheme}:${path}` };
}

// ── buildScriptUri ────────────────────────────────────────────────

describe('buildScriptUri', () => {
    it('returns a URI with altium365 scheme containing authId and scriptId', () => {
        const uri = buildScriptUri(VALID_AUTH_ID, VALID_SCRIPT_ID, 'MyScript');
        expect(uri.scheme).toBe('altium365');
        expect(uri.path).toContain(VALID_AUTH_ID);
        expect(uri.path).toContain(VALID_SCRIPT_ID);
        expect(uri.path).toContain('MyScript');
    });

    it('throws when authId contains colon', () => {
        expect(() => buildScriptUri('auth:id', VALID_SCRIPT_ID, 'n')).toThrow();
    });

    it('throws when authId contains slash', () => {
        expect(() => buildScriptUri('auth/id', VALID_SCRIPT_ID, 'n')).toThrow();
    });

    it('throws when authId is empty', () => {
        expect(() => buildScriptUri('', VALID_SCRIPT_ID, 'n')).toThrow();
    });
});

// ── parseScriptUri ────────────────────────────────────────────────

describe('parseScriptUri', () => {
    it('throws for wrong scheme', () => {
        const uri = makeUri('file', '/some/path');
        expect(() => parseScriptUri(uri)).toThrow();
        try {
            parseScriptUri(uri);
        } catch (e) {
            expect(e instanceof Error).toBe(true);
        }
    });

    it('returns parsed components for a valid GRID path', () => {
        const path = `/grid:workspace:${VALID_AUTH_ID}:scripts:script/${VALID_SCRIPT_ID}/MyScript`;
        const uri = makeUri('altium365', path);
        const result = parseScriptUri(uri);
        expect(result.authId).toBe(VALID_AUTH_ID);
        expect(result.scriptId).toBe(VALID_SCRIPT_ID);
        expect(result.displayName).toBe('MyScript');
    });

    it('throws for invalid UUID in path', () => {
        const path = `/grid:workspace:${VALID_AUTH_ID}:scripts:script/not-a-uuid/name`;
        const uri = makeUri('altium365', path);
        expect(() => parseScriptUri(uri)).toThrow();
    });

    it('round-trip: buildScriptUri → parseScriptUri returns original components', () => {
        const uri = buildScriptUri('ws', VALID_SCRIPT_ID, 'Foo');
        const result = parseScriptUri(uri);
        expect(result.authId).toBe('ws');
        expect(result.scriptId).toBe(VALID_SCRIPT_ID);
    });
});

/*
 * SKIPPED (D-08): AltiumRemoteScriptFs.readFile / writeFile
 * ──────────────────────────────────────────────────────────────────
 * These methods require ensureWorkspaceToken + graphqlRequest (network).
 * The URI building/parsing contract above covers the testable surface.
 */
