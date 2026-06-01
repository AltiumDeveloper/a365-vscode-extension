import { describe, it, expect } from 'vitest';
import { buildEventUri, parseEventUri } from '../../src/testEvents/eventFs';

function makeUri(scheme: string, path: string): any {
    return { scheme, path, authority: '', query: '', fragment: '', fsPath: path, toString: () => `${scheme}:${path}` };
}

// ── buildEventUri ─────────────────────────────────────────────────

describe('buildEventUri', () => {
    it('returns a URI with altium365-event scheme', () => {
        const uri = buildEventUri('my-identity', 'run1');
        expect(uri.scheme).toBe('altium365-event');
    });

    it('path starts with /', () => {
        const uri = buildEventUri('my-identity', 'run1');
        expect(uri.path.startsWith('/')).toBe(true);
    });
});

// ── parseEventUri ─────────────────────────────────────────────────

describe('parseEventUri', () => {
    it('parses a valid altium365-event URI', () => {
        const uri = makeUri('altium365-event', '/my-identity/run1.json');
        const result = parseEventUri(uri);
        expect(result).toMatchObject({ identity: 'my-identity', eventName: 'run1' });
    });

    it('returns undefined for wrong scheme', () => {
        const uri = makeUri('file', '/some/path');
        expect(parseEventUri(uri)).toBeUndefined();
    });

    it('returns undefined when path has no slash separator', () => {
        // A single segment with no second slash
        const uri = makeUri('altium365-event', '/no-slash-here');
        expect(parseEventUri(uri)).toBeUndefined();
    });

    it('returns undefined when path does not end with .json', () => {
        const uri = makeUri('altium365-event', '/identity/event.txt');
        expect(parseEventUri(uri)).toBeUndefined();
    });

    it('returns undefined when eventName is empty', () => {
        const uri = makeUri('altium365-event', '/identity/.json');
        expect(parseEventUri(uri)).toBeUndefined();
    });
});

// ── round-trip tests ──────────────────────────────────────────────

describe('buildEventUri → parseEventUri round-trip', () => {
    it('round-trip with UUID-style identity', () => {
        const identity = '550e8400-e29b-41d4-a716-446655440000';
        const eventName = 'my run';
        const uri = buildEventUri(identity, eventName);
        const result = parseEventUri(uri);
        expect(result).toMatchObject({ identity, eventName });
    });

    it('round-trip with Windows path identity containing backslash', () => {
        const identity = 'C:\\Users\\test\\script.py';
        const eventName = 'run1';
        const uri = buildEventUri(identity, eventName);
        const result = parseEventUri(uri);
        expect(result).toMatchObject({ identity, eventName });
    });

    it('round-trip with identity containing colons', () => {
        const identity = 'local:/some/path:extra';
        const eventName = 'test event';
        const uri = buildEventUri(identity, eventName);
        const result = parseEventUri(uri);
        expect(result).toMatchObject({ identity, eventName });
    });
});

/*
 * SKIPPED (D-08): TestEventFs.readFile / writeFile
 * ──────────────────────────────────────────────────────────────────
 * These methods require ExtensionContext + OutputChannel + schema injection.
 * URI building/parsing contract above covers the testable surface.
 */
