/**
 * Altium 365 Files Service REST client.
 *
 * The Files Service exposes raw script source bytes — GraphQL only carries
 * file *tokens* (UUIDs); the actual byte content flows over a separate REST
 * service whose contract is NOT introspectable. The endpoints, verbs, body
 * shape, and response envelope below are encoded from a live dev1 portal
 * smoke-probe captured by an operator on 2026-05-20. Re-verify if portal
 * traffic visibly changes.
 *
 * Pinned contract (operator-captured 2026-05-20, dev1 portal):
 *
 *   DOWNLOAD (read script body)
 *     - URL:    `${filesServiceUrl}/File/Download?id=${fileToken}`
 *     - Method: GET
 *     - Headers: Authorization: Bearer <workspace-token>
 *     - Response Content-Type: application/octet-stream (raw bytes)
 *
 *   UPLOAD (publish edited script body)
 *     - URL:    `${filesServiceUrl}/File/Upload`
 *     - Method: POST
 *     - Headers: Authorization: Bearer <workspace-token>
 *                Content-Type: multipart/form-data; boundary=... (auto)
 *     - Body:   multipart/form-data with a single part `file`
 *     - Response: text/plain — the new fileToken as a bare UUID string
 *                 (NOT JSON-wrapped). Caller passes this token straight
 *                 into the subsequent `gloScrUpdateScript` mutation.
 *
 *   Auth tier: workspace-scoped (NOT base) — same token used by
 *   per-workspace GraphQL. Resolve via `ensureWorkspaceToken(ctx, ws)` at
 *   every call. NEVER cache tokens in this module.
 *
 *   The ActionWait long-poll uses Node `https` and is unaffected; this module
 *   is allowed to use `globalThis.fetch`, consistent with `graphqlRequest`.
 *
 *   Token hygiene: the bearer token MUST NEVER
 *   appear in any thrown error message or appendLine. Error bodies are
 *   truncated to 500 characters; `Authorization` header is never echoed.
 */

// Pinned smoke-probe constants — operator-captured 2026-05-20 (dev1 portal).
const DOWNLOAD_PATH_PREFIX = '/File/Download'; // `?id=<token>` query string
const UPLOAD_PATH = '/File/Upload';             // multipart POST
const UPLOAD_FORM_FIELD = 'file';               // multipart field name
const UPLOAD_VERB = 'POST' as const;

// fileToken charset: UUID-v4 (hex + dashes only). Tighter than the original
// draft (which permitted dots/slashes/underscores) because the smoke-probe
// confirmed pure UUIDs (e.g. `3038c52a-c406-443e-a88b-18205cf6c938`).
// Path-traversal defence — validate before URL build.
const FILE_TOKEN_CHARSET = /^[A-Za-z0-9-]+$/;

function ensureValidFileToken(fileToken: string): void {
    if (!fileToken || typeof fileToken !== 'string' || !FILE_TOKEN_CHARSET.test(fileToken)) {
        throw new Error(
            `Files Service: invalid fileToken (must match ${FILE_TOKEN_CHARSET.source})`
        );
    }
}

function trimTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * GET the raw script body bytes for a published file token.
 *
 * @param filesServiceUrl Per-workspace Files Service base URL — resolve via
 *   `getWorkspaceFilesUrl(ws)` at every call. Never accept
 *   from untrusted input.
 * @param fileToken Server-issued opaque identifier (UUID-shaped, charset
 *   validated against {@link FILE_TOKEN_CHARSET} before URL construction).
 * @param bearerToken Workspace-scoped bearer — `ensureWorkspaceToken(...)`.
 *   MUST NEVER be logged or echoed in error messages (token hygiene gate).
 */
export async function downloadByToken(
    filesServiceUrl: string,
    fileToken: string,
    bearerToken: string
): Promise<Uint8Array> {
    ensureValidFileToken(fileToken);
    const base = trimTrailingSlash(filesServiceUrl);
    const url = `${base}${DOWNLOAD_PATH_PREFIX}?id=${encodeURIComponent(fileToken)}`;

    const res = await globalThis.fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${bearerToken}`,
            Accept: 'application/octet-stream',
        },
    });
    if (!res.ok) {
        // Read the body once for diagnostic detail; truncate aggressively to
        // avoid accidentally echoing bearer-token-bearing redirect bodies.
        let body = '';
        try {
            body = (await res.text()).slice(0, 500);
        } catch {
            body = '<unreadable body>';
        }
        throw new Error(`Files Service GET HTTP ${res.status}: ${body}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
}

/**
 * POST raw script bytes as a multipart upload; returns the new fileToken
 * the caller must echo into `gloScrUpdateScript`.
 *
 * @param filesServiceUrl Per-workspace Files Service base URL.
 * @param bearerToken Workspace-scoped bearer.
 * @param bytes Raw script source bytes (Uint8Array — typically UTF-8 encoded
 *   text from the editor; the Files Service is content-agnostic).
 * @param opts.filename Optional display name for the multipart `file` part.
 *   Defaults to `'script.py'`. Server uses the body bytes as the new content
 *   regardless of filename.
 * @param opts.contentType Reserved for future content-type negotiation.
 *   Currently ignored — the multipart runtime sets per-part Content-Type to
 *   `application/octet-stream` which the smoke-probe confirmed is accepted.
 */
export async function uploadAndGetToken(
    filesServiceUrl: string,
    bearerToken: string,
    bytes: Uint8Array,
    opts?: { filename?: string; contentType?: string }
): Promise<string> {
    const base = trimTrailingSlash(filesServiceUrl);
    const url = `${base}${UPLOAD_PATH}`;

    const filename = opts?.filename && opts.filename.length > 0 ? opts.filename : 'script.py';

    // Use the Web standard FormData + Blob (available in Node ≥ 18 / VS Code
    // host runtime). Do NOT set Content-Type manually — the runtime appends
    // the correct multipart boundary automatically. Hand-setting Content-Type
    // drops the boundary and the server rejects the upload.
    // Construct from a concrete ArrayBuffer slice so the BlobPart is a clean
    // standalone buffer (not a view that may share underlying memory).
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const blob = new Blob([ab as ArrayBuffer], { type: 'application/octet-stream' });
    const form = new FormData();
    form.append(UPLOAD_FORM_FIELD, blob, filename);

    const res = await globalThis.fetch(url, {
        method: UPLOAD_VERB,
        headers: {
            Authorization: `Bearer ${bearerToken}`,
            Accept: 'text/plain, */*',
        },
        body: form,
    });
    if (!res.ok) {
        let body = '';
        try {
            body = (await res.text()).slice(0, 500);
        } catch {
            body = '<unreadable body>';
        }
        throw new Error(`Files Service POST HTTP ${res.status}: ${body}`);
    }
    const text = (await res.text()).trim();

    // Response is a bare UUID string — validate to fail-fast on schema drift
    // and to prevent us echoing arbitrary HTML/JSON into a downstream
    // `updateScript` mutation as if it were a token.
    if (!FILE_TOKEN_CHARSET.test(text)) {
        throw new Error(
            `Files Service POST: unexpected response shape (expected bare UUID, got ${text.length} chars)`
        );
    }
    return text;
}
