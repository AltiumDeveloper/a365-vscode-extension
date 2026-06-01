import { describe, it, expect } from 'vitest';
import { stringifyEvent } from '../../src/testEvents/resolver';

describe('stringifyEvent', () => {
    it('returns undefined for an empty object', () => {
        expect(stringifyEvent({})).toBeUndefined();
    });

    it('returns key-value pair for a simple string value', () => {
        expect(stringifyEvent({ key: 'value' })).toEqual([{ key: 'key', value: 'value' }]);
    });

    it('filters null values', () => {
        expect(stringifyEvent({ a: null, b: 'ok' })).toEqual([{ key: 'b', value: 'ok' }]);
    });

    it('filters undefined values and stringifies numbers', () => {
        expect(stringifyEvent({ a: undefined, b: 42 })).toEqual([{ key: 'b', value: '42' }]);
    });

    it('stringifies boolean values', () => {
        const result = stringifyEvent({ x: true, y: false });
        expect(result).toEqual(expect.arrayContaining([
            { key: 'x', value: 'true' },
            { key: 'y', value: 'false' },
        ]));
        expect(result).toHaveLength(2);
    });

    it('returns undefined when all values are null or undefined', () => {
        expect(stringifyEvent({ a: null, b: undefined })).toBeUndefined();
    });
});

/*
 * SKIPPED (D-08): resolveScriptParameters full function
 * ──────────────────────────────────────────────────────────────────
 * resolveScriptParameters orchestrates vscode.commands.executeCommand,
 * AsyncMutex, OutputChannel, and sibling import. High mock complexity.
 * The pure stringifyEvent helper is tested above.
 */
