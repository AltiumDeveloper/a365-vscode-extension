import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { URL, URLSearchParams } from 'url';
import { AsyncMutex } from './asyncMutex';

/**
 * Minimal POST helper using Node's http/https module. We CANNOT use
 * globalThis.fetch for ActionWait long-poll because the VS Code Extension
 * Host runtime consumes response bodies before user code can read them
 * (empirically observed: res.bodyUsed === true on the response line, before
 * any .text()/.json() call). See Phase 02.3 D-17 amendment.
 *
 * Honors AbortSignal. Buffers full response into a string.
 */
function postJson(
    endpoint: string,
    bodyObj: unknown,
    signal: AbortSignal
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        let url: URL;
        try {
            url = new URL(endpoint);
        } catch (e) {
            reject(new Error(`Invalid endpoint: ${endpoint}`));
            return;
        }
        const payload = Buffer.from(JSON.stringify(bodyObj), 'utf8');
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const req = lib.request(
            {
                method: 'POST',
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': payload.length,
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode ?? 0,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
                res.on('error', (e) => reject(e));
            }
        );
        req.on('error', (e) => {
            const err = e as NodeJS.ErrnoException;
            if (err.code === 'ABORT_ERR' || signal.aborted) {
                const a = new Error('Aborted');
                (a as any).name = 'AbortError';
                reject(a);
                return;
            }
            reject(e);
        });
        const onAbort = () => req.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        if (signal.aborted) {
            req.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        } else {
            signal.addEventListener('abort', onAbort, { once: true });
        }
        req.write(payload);
        req.end();
    });
}

export interface OAuthConfig {
    clientId: string;
    authEndpoint: string;
    tokenEndpoint: string;
    scopes: string;
    audience?: string;
    actionWaitEndpoint: string;
    redirectUri: string;
}

export interface TokenSet {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
    expires_at?: number; // epoch seconds
    scope?: string;
}

const SECRET_TOKENS = 'altium365.tokens';
const SECRET_WS_TOKEN_PREFIX = 'altium365.workspaceTokens.';
const GLOBAL_WS_TOKEN_INDEX_KEY = 'altium365.workspaceTokenIds';
const GLOBAL_SELECTED_WORKSPACE_KEY = 'altium365.selectedWorkspace';

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
function decodeIdTokenClaims(idToken: string | undefined): Record<string, unknown> | undefined {
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

function userLabelFromClaims(claims: Record<string, unknown> | undefined): string {
    if (!claims) {
        return '(signed in)';
    }
    const candidate = claims.preferred_username ?? claims.email ?? claims.name;
    if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
    }
    return '(signed in)';
}

function b64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair(): { verifier: string; challenge: string } {
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

async function postForm(url: string, form: Record<string, string>): Promise<any> {
    const body = new URLSearchParams(form).toString();
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body,
    });
    const text = await res.text();
    if (!res.ok) {
        // RFC 6749 §5.2 OAuth error response is JSON with `error` (required)
        // and optional `error_description` / `error_uri`. Surface those fields
        // in a structured prefix so the caller (doSignIn) can map well-known
        // codes (invalid_grant, invalid_client, ...) to user-friendly messages
        // while preserving the full body for the OutputChannel.
        let oauthError = '';
        let oauthDesc = '';
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') {
                oauthError = typeof parsed.error === 'string' ? parsed.error : '';
                oauthDesc =
                    typeof parsed.error_description === 'string'
                        ? parsed.error_description
                        : '';
            }
        } catch {
            // Non-JSON body — fall through to legacy error format.
        }
        if (oauthError) {
            const descSuffix = oauthDesc ? ` — ${oauthDesc}` : '';
            throw new Error(
                `Token endpoint ${res.status} ${oauthError}${descSuffix} (body: ${text.slice(0, 500)})`
            );
        }
        throw new Error(`Token endpoint returned ${res.status}: ${text.slice(0, 500)}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Token endpoint returned non-JSON body: ${text.slice(0, 500)}`);
    }
}

function withExpiry(tok: TokenSet): TokenSet {
    if (tok.expires_in && !tok.expires_at) {
        tok.expires_at = Math.floor(Date.now() / 1000) + Number(tok.expires_in) - 30;
    }
    return tok;
}

/**
 * Long-poll Altium's ActionWait service for the OAuth authorization-code callback,
 * replacing the loopback HTTP listener (D-10/D-11). POSTs {token: connectionToken}
 * to the endpoint and treats 200 as completion, 408 as reconnect, 410 as user
 * cancellation, anything else as fatal. Honours an AbortSignal (caller cancellation)
 * and a wall-clock timeoutMs cap simultaneously via an internal AbortController
 * that aggregates both sources (manual wiring rather than AbortSignal.any so we
 * stay portable on the AGENTS.md Node>=18 baseline).
 *
 * Response body shape (D-05, confirmed empirically 2026-05-20): the
 * authorization code and OAuth state are nested under a `data` envelope —
 * `{ data: { code, state, ... } }`.
 *
 * Transport (D-17 amendment, 2026-05-20): uses Node's https module via
 * `postJson` rather than globalThis.fetch. The VS Code Extension Host's fetch
 * implementation consumes response bodies before user code can read them
 * (`res.bodyUsed === true` on arrival), making fetch unusable here.
 */
async function pollActionWait(
    endpoint: string,
    connectionToken: string,
    signal: AbortSignal,
    timeoutMs: number
): Promise<{ code: string; state: string }> {
    const deadline = Date.now() + timeoutMs;
    const internalController = new AbortController();

    // Aggregate caller signal + wall-clock timeout into one signal for fetch.
    if (signal.aborted) {
        internalController.abort();
    } else {
        signal.addEventListener('abort', () => internalController.abort(), { once: true });
    }
    const timeoutHandle = setTimeout(() => internalController.abort(), timeoutMs);

    try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (Date.now() >= deadline) {
                throw new Error(`ActionWait poll exceeded ${timeoutMs}ms wall-clock timeout.`);
            }
            if (signal.aborted) {
                throw new Error('Sign-in cancelled.');
            }

            let res: { status: number; body: string };
            try {
                res = await postJson(
                    endpoint,
                    { token: connectionToken },
                    internalController.signal
                );
            } catch (err) {
                const e = err as Error;
                if (e.name === 'AbortError') {
                    if (signal.aborted) {
                        throw new Error('Sign-in cancelled.');
                    }
                    throw new Error(`ActionWait poll exceeded ${timeoutMs}ms wall-clock timeout.`);
                }
                throw new Error(
                    `ActionWait network error: ${e.message} (${new URL(endpoint).host})`
                );
            }

            if (res.status === 408) {
                // Server-side per-request timeout — reconnect with same connection_token.
                continue;
            }

            if (res.status === 410) {
                throw new Error('Sign-in cancelled.');
            }

            if (res.status === 200) {
                let parsed: any;
                try {
                    parsed = JSON.parse(res.body);
                } catch {
                    throw new Error(
                        `ActionWait returned 200 but body is not JSON: ${res.body.slice(0, 500)}`
                    );
                }
                // D-05 confirmed empirically (2026-05-20): ActionWait wraps the
                // authorization code + state in a `data` envelope.
                const code = parsed?.data?.code;
                const state = parsed?.data?.state;
                if (typeof code !== 'string' || code.length === 0 ||
                    typeof state !== 'string' || state.length === 0) {
                    throw new Error(
                        `ActionWait returned 200 but response body is missing data.code or data.state: ${res.body.slice(0, 500)}`
                    );
                }
                return { code, state };
            }

            throw new Error(`ActionWait returned ${res.status}: ${res.body.slice(0, 500)}`);
        }
    } finally {
        clearTimeout(timeoutHandle);
    }
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
    await clearAllTokens(context, { silent: true });

    const { verifier, challenge } = pkcePair();
    // D-06/D-07: a single connection_token doubles as the OAuth `state` parameter.
    // Unifies the loopback-era separate `state` value with the ActionWait connection id.
    const connectionToken = crypto.randomUUID();

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        scope: cfg.scopes,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: connectionToken,
    });
    if (cfg.audience) {
        params.set('audience', cfg.audience);
    }

    const authUrl = `${cfg.authEndpoint}?${params.toString()}`;

    // Start the long-poll BEFORE opening the browser so a fast UnifiedLogin can't race
    // the listener (D-09). When no caller signal is supplied, hand pollActionWait a
    // never-aborting fallback signal so its parameter can stay non-optional.
    const effectiveSignal = signal ?? new AbortController().signal;
    const pollPromise = pollActionWait(
        cfg.actionWaitEndpoint,
        connectionToken,
        effectiveSignal,
        timeoutMs
    );

    await vscode.env.openExternal(vscode.Uri.parse(authUrl));

    const { code, state } = await pollPromise;

    // D-07 CSRF guard: the state returned via ActionWait MUST match the
    // connectionToken we minted. Reject before attempting token exchange.
    if (state !== connectionToken) {
        throw new Error('State mismatch (possible CSRF).');
    }

    const tok = (await postForm(cfg.tokenEndpoint, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        code_verifier: verifier,
        client_id: cfg.clientId,
    })) as TokenSet;

    const stored = withExpiry(tok);
    await context.secrets.store(SECRET_TOKENS, JSON.stringify(stored));
    try {
        const claims = decodeIdTokenClaims(stored.id_token);
        authStateEmitter.fire({ signedIn: true, user: userLabelFromClaims(claims) });
    } catch {
        // emitter failures must not break sign-in
    }
    return stored;
}

export async function exchangeWorkspaceToken(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    workspaceAuthId: string
): Promise<TokenSet> {
    const base = await getStoredTokens(context);
    if (!base) {
        throw new Error('Sign in first.');
    }
    const requestedScopes = `a365:workspace:${workspaceAuthId} ${cfg.scopes}`.trim();

    const tok = (await postForm(cfg.tokenEndpoint, {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: base.access_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: requestedScopes,
        client_id: cfg.clientId,
    })) as TokenSet;

    const stored = withExpiry(tok);
    return stored;
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
    const refreshed = (await postForm(cfg.tokenEndpoint, {
        grant_type: 'refresh_token',
        refresh_token: tok.refresh_token,
        client_id: cfg.clientId,
    })) as TokenSet;
    if (!refreshed.refresh_token && tok.refresh_token) {
        refreshed.refresh_token = tok.refresh_token;
    }
    const stored = withExpiry(refreshed);
    await context.secrets.store(SECRET_TOKENS, JSON.stringify(stored));
    return stored;
}

export async function getStoredTokens(
    context: vscode.ExtensionContext
): Promise<TokenSet | undefined> {
    const raw = await context.secrets.get(SECRET_TOKENS);
    return raw ? (JSON.parse(raw) as TokenSet) : undefined;
}

export async function clearAllTokens(
    context: vscode.ExtensionContext,
    options?: { silent?: boolean }
): Promise<void> {
    await context.secrets.delete(SECRET_TOKENS);
    const index = context.globalState.get<string[]>(GLOBAL_WS_TOKEN_INDEX_KEY, []);
    for (const id of index) {
        await context.secrets.delete(SECRET_WS_TOKEN_PREFIX + id);
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
function isExpired(tok: TokenSet): boolean {
    if (!tok.expires_at) {
        return false;
    }
    return Math.floor(Date.now() / 1000) >= tok.expires_at;
}

/**
 * Returns the base (refresh-aware) access token. Refreshes on expiry when a
 * refresh_token is available; falls through with the stale token on refresh
 * failure (the caller will see a 401 and the user re-authenticates).
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
    if (isExpired(base) && base.refresh_token) {
        try {
            base = await refreshTokens(context, cfg);
        } catch {
            // fall through; user will be asked to sign in again
        }
    }
    return base?.access_token;
}

/**
 * Returns the best available access token for use by scripts and workspace-scoped
 * callers. Routes by the user's explicit workspace selection (D-02): when a
 * workspace is selected, delegates to ensureWorkspaceToken; otherwise returns the
 * base token via getBaseAccessToken. On exchange failure, falls back to base so
 * the caller has SOMETHING to attempt (existing re-sign-in path in extension.ts
 * handles 401s).
 *
 * NOTE: reads the selected workspace inline from globalState to avoid a
 * circular import with workspace.ts (which already imports from ./auth).
 */
export async function getActiveAccessToken(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig
): Promise<string | undefined> {
    const selected = context.globalState.get<{ workspaceId: string; authId: string }>(
        GLOBAL_SELECTED_WORKSPACE_KEY
    );
    if (selected?.workspaceId && selected?.authId) {
        try {
            return await ensureWorkspaceToken(context, cfg, {
                workspaceId: selected.workspaceId,
                authId: selected.authId,
            });
        } catch {
            return await getBaseAccessToken(context, cfg);
        }
    }
    return await getBaseAccessToken(context, cfg);
}

export function readOAuthConfig(): OAuthConfig {
    const cfg = vscode.workspace.getConfiguration('altium365');
    return {
        clientId: cfg.get<string>('clientId') || '',
        authEndpoint: cfg.get<string>('authEndpoint') || '',
        tokenEndpoint: cfg.get<string>('tokenEndpoint') || '',
        scopes: cfg.get<string>('scopes') || 'openid profile',
        audience: cfg.get<string>('audience') || undefined,
        actionWaitEndpoint: cfg.get<string>('actionWaitEndpoint') || '',
        redirectUri: cfg.get<string>('redirectUri') || '',
    };
}
