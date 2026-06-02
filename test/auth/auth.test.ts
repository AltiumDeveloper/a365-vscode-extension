import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    decodeIdTokenClaims,
    userLabelFromClaims,
    withExpiry,
    isExpired,
    getStoredTokens,
    clearAllTokens,
    onAuthStateChanged,
    refreshTokens,
    type TokenSet,
} from '../../src/auth';
import { makeExtensionContext } from '../__mocks__/vscode';

// Helper: build a minimal 3-part JWT with the given payload object
function makeJwt(payload: object): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fakesig`;
}

// ── decodeIdTokenClaims ───────────────────────────────────────────

describe('decodeIdTokenClaims', () => {
    it('returns undefined for undefined input', () => {
        expect(decodeIdTokenClaims(undefined)).toBeUndefined();
    });

    it('returns undefined for a 2-part (malformed) JWT', () => {
        expect(decodeIdTokenClaims('header.payload')).toBeUndefined();
    });

    it('returns parsed claims for a valid 3-part JWT', () => {
        const token = makeJwt({ sub: 'user1', email: 'user1@example.com' });
        const claims = decodeIdTokenClaims(token);
        expect(claims).toMatchObject({ sub: 'user1', email: 'user1@example.com' });
    });

    it('returns undefined for a JWT with malformed JSON payload', () => {
        const header = Buffer.from('{}').toString('base64url');
        const badPayload = 'not-valid-json-base64';
        const token = `${header}.${badPayload}.fakesig`;
        // May either fail to base64-decode into valid JSON or produce invalid JSON
        const result = decodeIdTokenClaims(token);
        expect(result).toBeUndefined();
    });
});

// ── userLabelFromClaims ───────────────────────────────────────────

describe('userLabelFromClaims', () => {
    it('returns (signed in) for undefined', () => {
        expect(userLabelFromClaims(undefined)).toBe('(signed in)');
    });

    it('prefers preferred_username', () => {
        expect(userLabelFromClaims({ preferred_username: 'alice' })).toBe('alice');
    });

    it('falls back to email', () => {
        expect(userLabelFromClaims({ email: 'b@example.com' })).toBe('b@example.com');
    });

    it('falls back to name', () => {
        expect(userLabelFromClaims({ name: 'Bob' })).toBe('Bob');
    });

    it('returns (signed in) for empty claims object', () => {
        expect(userLabelFromClaims({})).toBe('(signed in)');
    });
});

// ── withExpiry ────────────────────────────────────────────────────

describe('withExpiry', () => {
    it('sets expires_at when absent', () => {
        const tok: TokenSet = { access_token: 't', expires_in: 3600 };
        const result = withExpiry(tok);
        const expected = Math.floor(Date.now() / 1000) + 3570;
        expect(result.expires_at).toBeGreaterThanOrEqual(expected - 5);
        expect(result.expires_at).toBeLessThanOrEqual(expected + 5);
    });

    it('does not overwrite existing expires_at', () => {
        const tok: TokenSet = { access_token: 't', expires_in: 3600, expires_at: 999 };
        const result = withExpiry(tok);
        expect(result.expires_at).toBe(999);
    });
});

// ── isExpired ─────────────────────────────────────────────────────

describe('isExpired', () => {
    it('returns false when no expires_at', () => {
        expect(isExpired({ access_token: 't' })).toBe(false);
    });

    it('returns false when expires_at is in the future', () => {
        const tok: TokenSet = { access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 100 };
        expect(isExpired(tok)).toBe(false);
    });

    it('returns true when expires_at is in the past', () => {
        const tok: TokenSet = { access_token: 't', expires_at: Math.floor(Date.now() / 1000) - 1 };
        expect(isExpired(tok)).toBe(true);
    });
});

// ── getStoredTokens ───────────────────────────────────────────────

describe('getStoredTokens', () => {
    it('returns undefined when secrets are empty', async () => {
        const ctx = makeExtensionContext();
        expect(await getStoredTokens(ctx)).toBeUndefined();
    });

    it('returns parsed TokenSet when valid JSON is stored', async () => {
        const ctx = makeExtensionContext();
        const stored: TokenSet = { access_token: 'at', refresh_token: 'rt' };
        await ctx.secrets.store('altium365.tokens', JSON.stringify(stored));
        const result = await getStoredTokens(ctx);
        expect(result).toMatchObject({ access_token: 'at', refresh_token: 'rt' });
    });
});

// ── clearAllTokens ────────────────────────────────────────────────

describe('clearAllTokens', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('fires onAuthStateChanged with {signedIn:false}', async () => {
        const ctx = makeExtensionContext();
        const received: any[] = [];
        const d = onAuthStateChanged((s) => received.push(s));
        try {
            await clearAllTokens(ctx);
            expect(received).toContainEqual({ signedIn: false });
        } finally {
            d.dispose();
        }
    });

    it('does NOT fire onAuthStateChanged when silent:true', async () => {
        const ctx = makeExtensionContext();
        const received: any[] = [];
        const d = onAuthStateChanged((s) => received.push(s));
        try {
            // Seed a token so there's something to clear
            await ctx.secrets.store('altium365.tokens', JSON.stringify({ access_token: 'at' }));
            await clearAllTokens(ctx, { silent: true });
            expect(received).toHaveLength(0);
        } finally {
            d.dispose();
        }
    });

    it('clears per-workspace token entries from the index', async () => {
        const ctx = makeExtensionContext();
        // Seed workspace token index
        await ctx.globalState.update('altium365.workspaceTokenIds', ['ws-1', 'ws-2']);
        await ctx.secrets.store('altium365.workspaceTokens.ws-1', 'token1');
        await ctx.secrets.store('altium365.workspaceTokens.ws-2', 'token2');
        await clearAllTokens(ctx, { silent: true });
        expect(await ctx.secrets.get('altium365.workspaceTokens.ws-1')).toBeUndefined();
        expect(await ctx.secrets.get('altium365.workspaceTokens.ws-2')).toBeUndefined();
    });
});

// ── refreshTokens ─────────────────────────────────────────────────

describe('refreshTokens', () => {
    const cfg = {
        clientId: 'test-client',
        authEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        scopes: 'openid offline_access',
        actionWaitEndpoint: 'https://auth.example.com/wait',
        redirectUri: 'http://localhost/callback',
    };

    afterEach(() => vi.unstubAllGlobals());

    it('returns undefined when no stored tokens', async () => {
        const ctx = makeExtensionContext();
        vi.stubGlobal('fetch', vi.fn());
        expect(await refreshTokens(ctx, cfg)).toBeUndefined();
    });

    it('returns undefined when stored token has no refresh_token', async () => {
        const ctx = makeExtensionContext();
        vi.stubGlobal('fetch', vi.fn());
        await ctx.secrets.store('altium365.tokens', JSON.stringify({ access_token: 'old' }));
        expect(await refreshTokens(ctx, cfg)).toBeUndefined();
    });

    it('stores refreshed token and returns it on success', async () => {
        const ctx = makeExtensionContext();
        await ctx.secrets.store('altium365.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'rt' }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ access_token: 'new_at', expires_in: 3600 }),
        }));
        const result = await refreshTokens(ctx, cfg);
        expect(result?.access_token).toBe('new_at');
        // Token should now be in storage
        const stored = await getStoredTokens(ctx);
        expect(stored?.access_token).toBe('new_at');
    });

    it('preserves original refresh_token when rotation not returned', async () => {
        const ctx = makeExtensionContext();
        await ctx.secrets.store('altium365.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'original-rt' }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ access_token: 'new_at', expires_in: 3600 }),
        }));
        const result = await refreshTokens(ctx, cfg);
        expect(result?.refresh_token).toBe('original-rt');
    });
});

/*
 * SKIPPED (D-08): VS Code-heavy or Node-HTTP-heavy functions
 * ──────────────────────────────────────────────────────────────────
 * signIn(ctx, cfg):
 *   Requires vscode.env.openExternal + Node https mechanics via
 *   pollActionWait. High mock complexity, low isolated test value.
 *
 * pollActionWait(endpoint, token, signal, timeoutMs):
 *   Uses Node http.request abort/timeout mechanics. Not worth
 *   simulating at this layer.
 *
 * readOAuthConfig():
 *   Simple vscode.workspace.getConfiguration accessor.
 *   Low value — just reads named keys.
 *
 * getBaseAccessToken / ensureWorkspaceToken:
 *   These orchestrate the above primitives and the mutex. The
 *   observable outcomes (cache hit/miss) are better verified via
 *   integration testing once a live-workspace environment is available.
 */
