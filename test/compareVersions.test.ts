import { describe, it, expect } from 'vitest';
import { compareVersions, parseVersion } from '../src/semverCompare';

describe('compareVersions', () => {
    it('normal > pre-release of same base', () => {
        expect(compareVersions('0.1.0', '0.1.0-ci.42')).toBeGreaterThan(0);
        expect(compareVersions('0.1.0-ci.42', '0.1.0')).toBeLessThan(0);
    });

    it('higher ci.N wins among pre-releases of same base', () => {
        expect(compareVersions('0.1.0-ci.100', '0.1.0-ci.42')).toBeGreaterThan(0);
    });

    it('build metadata ignored in precedence', () => {
        expect(compareVersions('0.1.0-ci.42+abc', '0.1.0-ci.42+def')).toBe(0);
    });

    it('patch bump wins over pre-release suffix', () => {
        expect(compareVersions('0.1.1', '0.1.0-ci.999')).toBeGreaterThan(0);
    });

    it('equal versions return 0', () => {
        expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    });

    it('unparseable input returns 0 (safe — no false update prompt)', () => {
        expect(compareVersions('not-a-version', '0.1.0')).toBe(0);
        expect(compareVersions('0.1.0', 'garbage')).toBe(0);
    });

    it('numeric < alphanumeric pre-release identifier', () => {
        // 'alpha' is alphanumeric, '1' is numeric; per SemVer §11.4.3 numeric < alphanumeric.
        expect(compareVersions('0.1.0-alpha', '0.1.0-1')).toBeGreaterThan(0);
    });
});

describe('parseVersion', () => {
    it('strips leading v from release-tag-style input', () => {
        const parsed = parseVersion('v0.1.0-ci.42+abc');
        expect(parsed).not.toBeNull();
        expect(parsed!.major).toBe(0);
        expect(parsed!.minor).toBe(1);
        expect(parsed!.patch).toBe(0);
        expect(parsed!.pre[0]).toBe('ci');
        expect(parsed!.pre[1]).toBe(42);
    });
});
