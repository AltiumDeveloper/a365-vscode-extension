import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    decodeIdTokenClaims,
    userLabelFromClaims,
    isExpired,
    getStoredTokens,
    clearAllTokens,
    onAuthStateChanged,
    refreshTokens,
    ensureWorkspaceToken,
    readOAuthConfig,
    signIn,
    stampUnstampedTokens,
    type AuthState,
    type TokenSet,
} from '../../src/auth';
import type * as AltiumAuth from '@altium-developer/altium-auth';
import { makeExtensionContext } from '../__mocks__/vscode';

vi.mock('@altium-developer/altium-auth', async (orig) => ({
    ...(await orig<typeof AltiumAuth>()),
    signIn: vi.fn(async () => ({ access_token: 'at', refresh_token: 'rt' })),
}));

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
        const received: AuthState[] = [];
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
        const received: AuthState[] = [];
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

// ── clearAllTokens with revocation ────────────────────────────────

describe('clearAllTokens with revoke', () => {
    const cfg = {
        clientId: 'test-client',
        authEndpoint: 'https://auth.example.com/connect/authorize',
        tokenEndpoint: 'https://auth.example.com/connect/token',
        scopes: 'openid offline_access',
        actionWaitEndpoint: 'https://auth.example.com/wait',
        redirectUri: 'http://localhost/callback',
    };

    afterEach(() => vi.unstubAllGlobals());

    async function seedSignedIn(): Promise<ReturnType<typeof makeExtensionContext>> {
        const ctx = makeExtensionContext();
        await ctx.secrets.store(
            'altium365.tokens',
            JSON.stringify({ access_token: 'at', refresh_token: 'base-rt' })
        );
        await ctx.globalState.update('altium365.workspaceTokenIds', ['ws-1']);
        await ctx.secrets.store(
            'altium365.workspaceTokens.ws-1',
            JSON.stringify({ access_token: 'ws-at', refresh_token: 'ws-rt' })
        );
        return ctx;
    }

    it('revokes the base and workspace refresh tokens before deleting them', async () => {
        const ctx = await seedSignedIn();
        const revoked: string[] = [];
        const stillStored: boolean[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init: { body: string }) => {
                expect(url).toBe('https://auth.example.com/connect/revocation');
                const body = new URLSearchParams(init.body);
                expect(body.get('token_type_hint')).toBe('refresh_token');
                expect(body.get('client_id')).toBe('test-client');
                revoked.push(body.get('token') ?? '');
                stillStored.push(!!(await ctx.secrets.get('altium365.tokens')));
                return { status: 200, text: async () => '' };
            })
        );
        await clearAllTokens(ctx, { silent: true, revokeWith: cfg });
        expect(revoked.sort()).toEqual(['base-rt', 'ws-rt']);
        expect(stillStored).toEqual([true, true]);
        expect(await ctx.secrets.get('altium365.tokens')).toBeUndefined();
        expect(await ctx.secrets.get('altium365.workspaceTokens.ws-1')).toBeUndefined();
    });

    it('finishes every revoke before the first delete', async () => {
        const ctx = await seedSignedIn();
        const deleteSpy = vi.spyOn(ctx.secrets, 'delete');
        const deletesWhenRevokeReturned: number[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                // Defer past the microtask queue: only an awaited revoke can still
                // satisfy the assertion once the response resolves on a later tick.
                await new Promise((resolve) => setTimeout(resolve, 0));
                deletesWhenRevokeReturned.push(deleteSpy.mock.calls.length);
                return { status: 200, text: async () => '' };
            })
        );
        await clearAllTokens(ctx, { silent: true, revokeWith: cfg });
        expect(deletesWhenRevokeReturned).toEqual([0, 0]);
    });

    it('clears local state and fires signedIn:false when revocation fails', async () => {
        const ctx = await seedSignedIn();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        const received: AuthState[] = [];
        const d = onAuthStateChanged((s) => received.push(s));
        try {
            await clearAllTokens(ctx, { revokeWith: cfg });
        } finally {
            d.dispose();
        }
        expect(await ctx.secrets.get('altium365.tokens')).toBeUndefined();
        expect(await ctx.secrets.get('altium365.workspaceTokens.ws-1')).toBeUndefined();
        expect(received).toContainEqual({ signedIn: false });
    });

    it('makes no network call when revokeWith is absent', async () => {
        const ctx = await seedSignedIn();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await clearAllTokens(ctx, { silent: true });
        expect(fetchMock).not.toHaveBeenCalled();
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
            status: 200,
            text: async () => JSON.stringify({ access_token: 'new_at', expires_in: 3600 }),
        }));
        const result = await refreshTokens(ctx, cfg);
        expect(result?.access_token).toBe('new_at');
        // Token should now be in storage
        const stored = await getStoredTokens(ctx, cfg);
        expect(stored?.access_token).toBe('new_at');
    });

    it('records the refreshing config as the token origin', async () => {
        const ctx = makeExtensionContext();
        await ctx.secrets.store('altium365.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'rt' }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 200,
            text: async () => JSON.stringify({ access_token: 'new_at', expires_in: 3600 }),
        }));
        await refreshTokens(ctx, cfg);
        expect(JSON.parse((await ctx.secrets.get('altium365.tokens')) ?? '{}').origin).toEqual(cfg);
    });

    it('preserves original refresh_token when rotation not returned', async () => {
        const ctx = makeExtensionContext();
        await ctx.secrets.store('altium365.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'original-rt' }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 200,
            text: async () => JSON.stringify({ access_token: 'new_at', expires_in: 3600 }),
        }));
        const result = await refreshTokens(ctx, cfg);
        expect(result?.refresh_token).toBe('original-rt');
    });
});

// ── token origin ──────────────────────────────────────────────────

describe('token origin', () => {
    const prod = {
        clientId: 'test-client',
        tokenEndpoint: 'https://auth.prod.example.com/connect/token',
        scopes: 'openid offline_access',
    };
    const dev = { ...prod, tokenEndpoint: 'https://auth.dev.example.com/connect/token' };

    afterEach(() => vi.unstubAllGlobals());

    async function seedBase(origin?: typeof prod): Promise<ReturnType<typeof makeExtensionContext>> {
        const ctx = makeExtensionContext();
        await ctx.secrets.store(
            'altium365.tokens',
            JSON.stringify({ access_token: 'prod-at', refresh_token: 'prod-rt', origin })
        );
        return ctx;
    }

    it('hides a base token minted by another auth server', async () => {
        const ctx = await seedBase(prod);
        expect(await getStoredTokens(ctx, dev)).toBeUndefined();
        expect((await getStoredTokens(ctx, prod))?.access_token).toBe('prod-at');
    });

    it('treats a different clientId as another auth server', async () => {
        const ctx = await seedBase(prod);
        expect(await getStoredTokens(ctx, { ...prod, clientId: 'other' })).toBeUndefined();
    });

    it('adopts a token with no recorded origin into the active config', async () => {
        const ctx = await seedBase();
        expect((await getStoredTokens(ctx, dev))?.access_token).toBe('prod-at');
    });

    it('never sends a foreign refresh token to the active token endpoint', async () => {
        const ctx = await seedBase(prod);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await refreshTokens(ctx, dev)).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await ctx.secrets.get('altium365.tokens')).toContain('prod-rt');
    });

    it('treats a foreign workspace token as a cache miss', async () => {
        const ctx = makeExtensionContext();
        await ctx.secrets.store(
            'altium365.workspaceTokens.ws-1',
            JSON.stringify({ access_token: 'prod-ws-at', origin: prod })
        );
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const workspace = { workspaceId: 'ws-1', authId: 'auth-1' };
        await expect(ensureWorkspaceToken(ctx, dev, workspace)).rejects.toThrow('Sign in first.');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await ensureWorkspaceToken(ctx, prod, workspace)).toBe('prod-ws-at');
    });

    it('records the exchanging config as the workspace token origin', async () => {
        const ctx = await seedBase(prod);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 200,
            text: async () => JSON.stringify({ access_token: 'prod-ws-at', expires_in: 3600 }),
        }));
        await ensureWorkspaceToken(ctx, prod, { workspaceId: 'ws-2', authId: 'auth-2' });
        const raw = await ctx.secrets.get('altium365.workspaceTokens.ws-2');
        expect(JSON.parse(raw ?? '{}').origin).toEqual(prod);
    });

    it('revokes each token at the server that minted it', async () => {
        const ctx = await seedBase(prod);
        await ctx.globalState.update('altium365.workspaceTokenIds', ['ws-1']);
        await ctx.secrets.store(
            'altium365.workspaceTokens.ws-1',
            JSON.stringify({ access_token: 'legacy-at', refresh_token: 'legacy-rt' })
        );
        const revoked: Record<string, string> = {};
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init: { body: string }) => {
                revoked[new URLSearchParams(init.body).get('token') ?? ''] = url;
                return { status: 200, text: async () => '' };
            })
        );
        await clearAllTokens(ctx, { silent: true, revokeWith: dev });
        expect(revoked).toEqual({
            'prod-rt': 'https://auth.prod.example.com/connect/revocation',
            'legacy-rt': 'https://auth.dev.example.com/connect/revocation',
        });
    });

    it('signIn records the signing config as the token origin', async () => {
        const ctx = makeExtensionContext();
        await signIn(ctx, prod);
        expect(JSON.parse((await ctx.secrets.get('altium365.tokens')) ?? '{}').origin).toEqual(prod);
    });

    it('stamps tokens with no origin with the active config, once', async () => {
        const ctx = await seedBase();
        await ctx.globalState.update('altium365.workspaceTokenIds', ['ws-1', 'ws-2']);
        await ctx.secrets.store(
            'altium365.workspaceTokens.ws-1',
            JSON.stringify({ access_token: 'legacy-ws-at' })
        );
        await ctx.secrets.store(
            'altium365.workspaceTokens.ws-2',
            JSON.stringify({ access_token: 'prod-ws-at', origin: prod })
        );
        await stampUnstampedTokens(ctx);
        const originOf = async (key: string) =>
            JSON.parse((await ctx.secrets.get(key)) ?? '{}').origin;
        expect(await originOf('altium365.tokens')).toEqual(readOAuthConfig());
        expect(await originOf('altium365.workspaceTokens.ws-1')).toEqual(readOAuthConfig());
        expect(await originOf('altium365.workspaceTokens.ws-2')).toEqual(prod);
        expect(await getStoredTokens(ctx, dev)).toBeUndefined();
    });
});

/*
 * SKIPPED: VS Code-heavy or Node-HTTP-heavy functions
 * ──────────────────────────────────────────────────────────────────
 * readOAuthConfig():
 *   Simple vscode.workspace.getConfiguration accessor.
 *   Low value — just reads named keys.
 *
 * getBaseAccessToken:
 *   Orchestrates refreshTokens and clearAllTokens. The observable
 *   outcomes are better verified via integration testing once a
 *   live-workspace environment is available.
 */
