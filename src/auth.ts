import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';
import { URL, URLSearchParams } from 'url';

export interface OAuthConfig {
    clientId: string;
    authEndpoint: string;
    tokenEndpoint: string;
    scopes: string;
    audience?: string;
    redirectPort: number;
    redirectPath: string;
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
const SECRET_WORKSPACE_TOKENS = 'altium365.workspaceTokens';
const SECRET_WS_TOKEN_PREFIX = 'altium365.workspaceTokens.';
const GLOBAL_WS_TOKEN_INDEX_KEY = 'altium365.workspaceTokenIds';

export interface AuthState {
    user?: string;
    environment?: string;
    signedIn: boolean;
}

// Module-level: auth-state emitter is a singleton broadcast channel (see CONVENTIONS.md exception).
const authStateEmitter = new vscode.EventEmitter<AuthState>();
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
        throw new Error(`Token endpoint returned ${res.status}: ${text}`);
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

async function awaitCallback(
    port: number,
    expectedPath: string,
    expectedState: string,
    timeoutMs: number
): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            try {
                const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
                if (url.pathname !== expectedPath) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found');
                    return;
                }
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                const error = url.searchParams.get('error');
                if (error) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`<html><body><h3>Authentication failed: ${error}</h3></body></html>`);
                    cleanup();
                    reject(new Error(`OAuth error: ${error}`));
                    return;
                }
                if (!code) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Missing code');
                    return;
                }
                if (state !== expectedState) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('State mismatch');
                    cleanup();
                    reject(new Error('State mismatch (possible CSRF).'));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(
                    '<html><body><h3>Authentication complete.</h3>You can close this window.</body></html>'
                );
                cleanup();
                resolve({ code });
            } catch (e) {
                cleanup();
                reject(e as Error);
            }
        });

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for OAuth redirect on port ${port}`));
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timer);
            server.close();
        };

        server.listen(port, '127.0.0.1');
        server.on('error', (err) => {
            cleanup();
            reject(err);
        });
    });
}

export async function signIn(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig,
    timeoutMs = 180_000
): Promise<TokenSet> {
    const { verifier, challenge } = pkcePair();
    const state = b64url(crypto.randomBytes(24));
    const redirectUri = `http://localhost:${cfg.redirectPort}${cfg.redirectPath}`;

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        scope: cfg.scopes,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    });
    if (cfg.audience) {
        params.set('audience', cfg.audience);
    }

    const authUrl = `${cfg.authEndpoint}?${params.toString()}`;

    // Start loopback listener BEFORE opening the browser.
    const callbackPromise = awaitCallback(
        cfg.redirectPort,
        cfg.redirectPath,
        state,
        timeoutMs
    );

    await vscode.env.openExternal(vscode.Uri.parse(authUrl));

    const { code } = await callbackPromise;

    const tok = (await postForm(cfg.tokenEndpoint, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: cfg.clientId,
    })) as TokenSet;

    const stored = withExpiry(tok);
    await context.secrets.store(SECRET_TOKENS, JSON.stringify(stored));
    await context.secrets.delete(SECRET_WORKSPACE_TOKENS);
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
    await context.secrets.store(SECRET_WORKSPACE_TOKENS, JSON.stringify(stored));
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
    const fresh = await exchangeWorkspaceToken(context, cfg, workspace.authId);
    await context.secrets.store(key, JSON.stringify(fresh));
    const index = context.globalState.get<string[]>(GLOBAL_WS_TOKEN_INDEX_KEY, []);
    if (!index.includes(workspace.workspaceId)) {
        const next = [...index, workspace.workspaceId];
        await context.globalState.update(GLOBAL_WS_TOKEN_INDEX_KEY, next);
    }
    return fresh.access_token;
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

export async function getStoredWorkspaceTokens(
    context: vscode.ExtensionContext
): Promise<TokenSet | undefined> {
    const raw = await context.secrets.get(SECRET_WORKSPACE_TOKENS);
    return raw ? (JSON.parse(raw) as TokenSet) : undefined;
}

export async function clearAllTokens(context: vscode.ExtensionContext): Promise<void> {
    await context.secrets.delete(SECRET_TOKENS);
    await context.secrets.delete(SECRET_WORKSPACE_TOKENS);
    const index = context.globalState.get<string[]>(GLOBAL_WS_TOKEN_INDEX_KEY, []);
    for (const id of index) {
        await context.secrets.delete(SECRET_WS_TOKEN_PREFIX + id);
    }
    await context.globalState.update(GLOBAL_WS_TOKEN_INDEX_KEY, undefined);
    try {
        authStateEmitter.fire({ signedIn: false });
    } catch {
        // emitter failures must not break sign-out
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

function isExpired(tok: TokenSet): boolean {
    if (!tok.expires_at) {
        return false;
    }
    return Math.floor(Date.now() / 1000) >= tok.expires_at;
}

/** Returns the best available access token for use by scripts. */
export async function getActiveAccessToken(
    context: vscode.ExtensionContext,
    cfg: OAuthConfig
): Promise<string | undefined> {
    const ws = await getStoredWorkspaceTokens(context);
    if (ws && !isExpired(ws)) {
        return ws.access_token;
    }
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

export function readOAuthConfig(): OAuthConfig {
    const cfg = vscode.workspace.getConfiguration('altium365');
    return {
        clientId: cfg.get<string>('clientId') || '',
        authEndpoint: cfg.get<string>('authEndpoint') || '',
        tokenEndpoint: cfg.get<string>('tokenEndpoint') || '',
        scopes: cfg.get<string>('scopes') || 'openid profile',
        audience: cfg.get<string>('audience') || undefined,
        redirectPort: cfg.get<number>('redirectPort') || 8080,
        redirectPath: cfg.get<string>('redirectPath') || '/oauth/v2/callback',
    };
}
