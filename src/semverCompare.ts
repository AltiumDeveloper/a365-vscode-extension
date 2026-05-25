/**
 * Pure SemVer 2.0 comparator for the in-extension self-updater.
 *
 * Implements §10 (build metadata IGNORED in precedence) and §11 (precedence
 * rules: normal > pre-release of same base; numeric < alphanumeric at same
 * pre-release position; longer pre-release wins all-else-equal).
 *
 * Accepts an optional leading `v` because GitHub Release tag names produced by
 * Plan 08-01 are `v$VERSION` — letting the updater pass `release.tag_name` or
 * `release.name` straight in without pre-stripping.
 *
 * Unparseable input returns 0 (treated as equal) so that a malformed remote
 * release name can never trigger a false "update available" prompt.
 *
 * This module intentionally has zero VS Code imports so it can be unit-tested
 * under vitest's node environment without stubbing the `vscode` API (mirrors
 * the convention established by src/logDedup.ts).
 */

export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    pre: Array<number | string>;  // empty array = NOT a pre-release
}

// Optional leading `v?` added vs the §11 reference grammar so callers can pass
// `release.tag_name` (e.g. `v0.1.0-ci.42+a1b2c3d`) directly.
const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v: string): ParsedVersion | null {
    if (typeof v !== 'string') {
        return null;
    }
    const m = RE.exec(v.trim());
    if (!m) {
        return null;
    }
    const pre = m[4]
        ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
        : [];
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        pre,
    };
}

export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    // Safe fallthrough: if either side is unparseable, report equal so the
    // updater never raises a false "newer version available" prompt on a
    // malformed remote release name.
    if (!pa || !pb) {
        return 0;
    }

    // SemVer §11.2 — compare base triple numerically.
    if (pa.major !== pb.major) {
        return pa.major - pb.major;
    }
    if (pa.minor !== pb.minor) {
        return pa.minor - pb.minor;
    }
    if (pa.patch !== pb.patch) {
        return pa.patch - pb.patch;
    }

    // SemVer §11.3 — a normal version has higher precedence than any
    // pre-release of the same base.
    if (pa.pre.length === 0 && pb.pre.length === 0) {
        return 0;
    }
    if (pa.pre.length === 0) {
        return 1;
    }
    if (pb.pre.length === 0) {
        return -1;
    }

    // SemVer §11.4 — compare pre-release identifiers left-to-right.
    const n = Math.min(pa.pre.length, pb.pre.length);
    for (let i = 0; i < n; i++) {
        const x = pa.pre[i];
        const y = pb.pre[i];
        if (x === y) {
            continue;
        }
        const xn = typeof x === 'number';
        const yn = typeof y === 'number';
        if (xn && yn) {
            // §11.4.1 — numeric identifiers compare numerically.
            return (x as number) - (y as number);
        }
        if (xn) {
            // §11.4.3 — numeric identifiers always have lower precedence
            // than alphanumeric identifiers at the same position.
            return -1;
        }
        if (yn) {
            return 1;
        }
        // §11.4.2 — alphanumeric identifiers compare lexically in ASCII order.
        return (x as string) < (y as string) ? -1 : 1;
    }

    // §11.4.4 — all compared identifiers are equal; the larger pre-release
    // array wins.
    return pa.pre.length - pb.pre.length;
}
