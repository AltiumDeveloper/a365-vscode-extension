import * as vscode from 'vscode';
import {
    refreshToken,
    revokeRefreshToken,
    signIn as signInWithActionWait,
    signIntoWorkspace,
    type OAuthConfig,
    type TokenSet,
} from '@altium-developer/altium-auth';
import { resolveConfig } from '../config';
import { AsyncMutex } from '../shared/asyncMutex';

export type { OAuthConfig, TokenSet };

const SECRET_TOKENS = 'altium365.tokens';
const SECRET_WS_TOKEN_PREFIX = 'altium365.workspaceTokens.';
const GLOBAL_WS_TOKEN_INDEX_KEY = 'altium365.workspaceTokenIds';
const REVOKE_TIMEOUT_MS = 3_000;

export interface AuthState {
    user?: string;
    environment?: string;
    signedIn: boolean;
}

// Module-level: auth-state emitter is a singleton broadcast channel (see CONVENTIONS.md exception).
const authStateEmitter = new vscode.EventEmitter<AuthState>();

/**
 * Module-level: per-workspaceId mutex that serializes ensureWorkspaceToken's
 * cache-miss path (D-07). Closes WR-05 (index RMW race) and dedupes concurrent
 * token-exchange calls for the same workspaceId on cold-start tree expansion.
 * Single-purpose helper — same CONVENTIONS.md exception as authStateEmitter.
 */
const workspaceTokenMutex = new AsyncMutex();
export const onAuthStateChanged: vscode.Event<AuthState> = authStateEmitter.event;
export function fireAuthStateChanged(state: AuthState): void {
    authStateEmitter.fire(state);
}

/** Decode JWT id_token payload claims without verifying signature. Returns undefined on any parse error. */
export function decodeIdTokenClaims(idToken: string | undefined): Record<string, unknown> | undefined {
    if (!idToken) {
        return undefined;
    }
    try {
        const parts = idToken.split('.');
        if (parts.length !== 3) {
            return undefined;
        }
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) {
            b64 += '=';
        }
        const json = Buffer.from(b64, 'base64').toString('utf-8');
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}

export function userLabelFromClaims(claims: Record<string, unknown> | undefined): string {
    if (!claims) {
        return '(signed in)';
    }
    const candidate = claims.preferred_username ?? claims.email ?? claims.name;
    if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
    }
    return '(signed in)';
}

export async function signIn(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    timeoutMs = 180_000,
    signal?: AbortSignal
): Promise<TokenSet> {
    // D-05 / Phase 02.3 D-13 invariant: drain any prior identity's base + per-workspace
    // token cache before starting a new OAuth dance so an account switch can't leave
    // stale per-workspace tokens around. D-06: silent — suppress the transient
    // signedIn:false event the drain would otherwise broadcast mid-sign-in.
    await clearAllTokens(context, { silent: true, revoke: cfg });

    const tok = await signInWithActionWait(cfg, {
        timeoutMs,
        signal,
        openBrowser: async (url) => {
            await vscode.env.openExternal(vscode.Uri.parse(url));
        },
    });

    await context.secrets.store(SECRET_TOKENS, JSON.stringify(tok));
    try {
        const claims = decodeIdTokenClaims(tok.id_token);
        authStateEmitter.fire({ signedIn: true, user: userLabelFromClaims(claims) });
    } catch {
        // emitter failures must not break sign-in
    }
    return tok;
}

export async function exchangeWorkspaceToken(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    workspaceAuthId: string
): Promise<TokenSet> {
    // Route through getBaseAccessToken so an expired base triggers refresh
    // (or welcome-view reset) before we attempt the workspace token exchange.
    // Otherwise the IdP rejects the exchange with 'subject_token expired' and
    // the user sees a confusing error from a workspace-level operation when
    // the actual fix is at the base-token layer.
    const subjectAccess = await getBaseAccessToken(context, cfg);
    if (!subjectAccess) {
        throw new Error('Sign in first.');
    }
    const tok = await signIntoWorkspace(cfg, subjectAccess, workspaceAuthId);

    return tok;
}

/**
 * Returns a fresh access token for the given workspace, using a per-workspace
 * SecretStorage cache keyed by workspaceId. Calls exchangeWorkspaceToken on
 * cache miss or expiry. Maintains an index in globalState so clearAllTokens
 * can enumerate and drain every cached entry on sign-out (D-01, RESEARCH.md
 * §Pattern 4 + §Pitfall 5).
 */
export async function ensureWorkspaceToken(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    workspace: { workspaceId: string; authId: string }
): Promise<string> {
    const key = SECRET_WS_TOKEN_PREFIX + workspace.workspaceId;
    // Fast path (lock-free): uncontended cache hits must not pay mutex cost.
    const raw = await context.secrets.get(key);
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as TokenSet;
            if (parsed.access_token && !isExpired(parsed)) {
                return parsed.access_token;
            }
        } catch {
            // fall through to refresh — malformed cache entry will be overwritten
        }
    }
    // Slow path: serialize per workspaceId so concurrent callers for the same
    // workspace coalesce into a single exchange, and the index RMW is race-free.
    return await workspaceTokenMutex.runExclusive(workspace.workspaceId, async () => {
        // Double-checked locking: a concurrent caller may have populated the
        // cache while this one was queued on the lock.
        const rawAfter = await context.secrets.get(key);
        if (rawAfter) {
            try {
                const parsed = JSON.parse(rawAfter) as TokenSet;
                if (parsed.access_token && !isExpired(parsed)) {
                    return parsed.access_token;
                }
            } catch {
                // fall through — malformed entry will be overwritten below
            }
        }
        const fresh = await exchangeWorkspaceToken(context, cfg, workspace.authId);
        await context.secrets.store(key, JSON.stringify(fresh));
        const index = context.globalState.get<string[]>(GLOBAL_WS_TOKEN_INDEX_KEY, []);
        if (!index.includes(workspace.workspaceId)) {
            const next = [...index, workspace.workspaceId];
            await context.globalState.update(GLOBAL_WS_TOKEN_INDEX_KEY, next);
        }
        return fresh.access_token;
    });
}

export async function refreshTokens(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig
): Promise<TokenSet | undefined> {
    const tok = await getStoredTokens(context);
    if (!tok?.refresh_token) {
        return undefined;
    }
    let refreshed: TokenSet;
    try {
        refreshed = await refreshToken(cfg, tok.refresh_token);
    } catch (e) {
        // Most refresh failures are unrecoverable from the extension side
        // (invalid_grant = revoked / expired refresh_token, invalid_client,
        // etc.). Drain tokens so the caller's catch lands the user on the
        // welcome view instead of an infinite stale-token retry loop.
        // Network/IdP-down errors also clear, which is acceptable: the
        // user will simply Sign In again when connectivity is restored
        // (cheaper than a more nuanced retry classifier).
        await clearAllTokens(context);
        throw e;
    }
    if (!refreshed.refresh_token && tok.refresh_token) {
        refreshed.refresh_token = tok.refresh_token;
    }
    await context.secrets.store(SECRET_TOKENS, JSON.stringify(refreshed));
    return refreshed;
}

export async function getStoredTokens(
    context: vscode.ExtensionContext
): Promise<TokenSet | undefined> {
    const raw = await context.secrets.get(SECRET_TOKENS);
    return raw ? (JSON.parse(raw) as TokenSet) : undefined;
}

function storedRefreshToken(raw: string | undefined): string | undefined {
    if (!raw) {
        return undefined;
    }
    try {
        return (JSON.parse(raw) as TokenSet).refresh_token;
    } catch {
        return undefined;
    }
}

/**
 * Best-effort RFC 7009 revocation of every stored refresh token, under one
 * shared deadline: the library takes no AbortSignal and fetch has no timeout.
 */
async function revokeAll(cfg: OAuthConfig, stored: (string | undefined)[]): Promise<void> {
    const calls = stored
        .map(storedRefreshToken)
        .filter((tok): tok is string => !!tok)
        .map((tok) => revokeRefreshToken(cfg, tok).catch(() => undefined));
    if (calls.length === 0) {
        return;
    }
    let deadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        Promise.all(calls),
        new Promise((resolve) => {
            deadline = setTimeout(resolve, REVOKE_TIMEOUT_MS);
        }),
    ]);
    clearTimeout(deadline);
}

export async function clearAllTokens(
    context: vscode.ExtensionContext,
    options?: { silent?: boolean; revoke?: OAuthConfig }
): Promise<void> {
    const index = context.globalState.get<string[]>(GLOBAL_WS_TOKEN_INDEX_KEY, []);
    const keys = [SECRET_TOKENS, ...index.map((id) => SECRET_WS_TOKEN_PREFIX + id)];
    if (options?.revoke) {
        await revokeAll(
            options.revoke,
            await Promise.all(keys.map((key) => context.secrets.get(key)))
        );
    }
    for (const key of keys) {
        await context.secrets.delete(key);
    }
    await context.globalState.update(GLOBAL_WS_TOKEN_INDEX_KEY, undefined);
    if (!options?.silent) {
        try {
            authStateEmitter.fire({ signedIn: false });
        } catch {
            // emitter failures must not break sign-out
        }
    }
}

/**
 * Returns a display label for the currently signed-in user, derived from the
 * id_token claims (preferred_username, email, or name). Returns '(signed in)'
 * if a token exists but no usable claim is present, or undefined when signed out.
 * Never throws.
 */
export async function getActiveUserLabel(
    context: vscode.ExtensionContext
): Promise<string | undefined> {
    const tok = await getStoredTokens(context);
    if (!tok) {
        return undefined;
    }
    const claims = decodeIdTokenClaims(tok.id_token);
    return userLabelFromClaims(claims);
}

/**
 * @deprecated Removed in Phase 02.1 fix WR-01. The "active workspace" cue now
 * reflects the user's explicit selection via `getSelectedWorkspace` in
 * `workspace.ts`, not the most-recently-exchanged token. Callers should use
 * `getSelectedWorkspace(context)?.workspaceId` from `./workspace`.
 */
export function isExpired(tok: TokenSet): boolean {
    if (!tok.expires_at) {
        return false;
    }
    return Math.floor(Date.now() / 1000) >= tok.expires_at;
}

/**
 * Returns the base (refresh-aware) access token. Refreshes on expiry when a
 * refresh_token is available. When the stored token has expired and we cannot
 * recover (no refresh_token, or refresh failed), drains all tokens via
 * `clearAllTokens` — that fires `signedIn:false`, which the extension's
 * onAuthStateChanged listener turns into `setContext altium365.signedIn=false`
 * + tree refresh, surfacing the viewsWelcome "Sign In" prompt instead of a
 * stale-token 401 error row in the side panel.
 *
 * Use this for base-scope GraphQL callers (e.g., listWorkspaces) that must
 * never receive a workspace-scoped token (WR-05).
 */
export async function getBaseAccessToken(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig
): Promise<string | undefined> {
    let base = await getStoredTokens(context);
    if (!base) {
        return undefined;
    }
    if (isExpired(base)) {
        if (!base.refresh_token) {
            // No refresh path available (legacy sign-in pre-offline_access, or
            // IdP didn't issue one). Drain so the user lands on the welcome
            // view instead of seeing a 401 in the side panel.
            await clearAllTokens(context);
            return undefined;
        }
        try {
            base = await refreshTokens(context, cfg);
        } catch {
            // Refresh failed (revoked / network / IdP misconfig). Drain
            // tokens so the welcome view shows; user re-signs in.
            await clearAllTokens(context);
            return undefined;
        }
    }
    return base?.access_token;
}

export function readOAuthConfig(): OAuthConfig {
    const resolved = resolveConfig();
    return {
        clientId: resolved.clientId,
        authEndpoint: resolved.authEndpoint,
        tokenEndpoint: resolved.tokenEndpoint,
        scopes: resolved.scopes,
        actionWaitEndpoint: resolved.actionWaitEndpoint,
        redirectUri: resolved.redirectUri,
    };
}
