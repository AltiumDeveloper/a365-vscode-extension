/**
 * Typed GraphQL error surfaced by `graphqlRequest` when the response body
 * carries a non-empty `errors[]` array. Mirrors the OAuth-error mapping
 * pattern in `doSignIn`. The full-fidelity JSON blob is preserved as
 * `rawErrors` so callers can append it to OutputChannel for diagnosis
 * without losing the readable message.
 */
export class GraphQLError extends Error {
    public readonly code: string | undefined;
    public readonly path: ReadonlyArray<string | number> | undefined;
    public readonly rawErrors: unknown[];

    constructor(
        message: string,
        opts: {
            code?: string;
            path?: ReadonlyArray<string | number>;
            rawErrors: unknown[];
        }
    ) {
        super(message);
        this.name = 'GraphQLError';
        this.code = opts.code;
        this.path = opts.path;
        this.rawErrors = opts.rawErrors;
    }
}

export async function graphqlRequest<T = unknown>(
    endpoint: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>
): Promise<T | undefined> {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    let payload: { data?: T; errors?: unknown };
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error(`GraphQL non-JSON response: ${text.slice(0, 500)}`);
    }
    if (payload.errors) {
        // Typed throw so command-boundary handlers can map well-known
        // codes to friendly messages while still appending the full body to
        // OutputChannel via `err.rawErrors`. Transport-tier failures (HTTP /
        // non-JSON branches above) remain plain `Error`.
        const rawErrors = Array.isArray(payload.errors) ? payload.errors : [payload.errors];
        const first = (rawErrors[0] ?? {}) as {
            message?: string;
            path?: ReadonlyArray<string | number>;
            extensions?: { code?: string };
        };
        const code = first?.extensions?.code;
        const message =
            typeof first?.message === 'string' && first.message.length > 0
                ? first.message
                : 'GraphQL error';
        throw new GraphQLError(message, {
            code,
            path: first?.path,
            rawErrors,
        });
    }
    return payload.data;
}

/**
 * Page descriptor returned by a `fetchPage` callback. Mirrors the
 * Relay-cursor connection shape used by the Altium 365 GraphQL API
 * (see https://www.altium.com/documentation/altium-developer-center/altium-365/api/pagination).
 */
export interface ConnectionPage<T> {
    nodes: T[];
    endCursor: string | null;
    hasNextPage: boolean;
}

/**
 * Collect all pages of a Relay cursor-paginated connection.
 *
 * Callers supply a `fetchPage(after)` callback that issues the underlying
 * GraphQL query with the appropriate `$first` / `$after` variables and
 * extracts the `nodes` + `pageInfo` from the response. This helper loops
 * forward until `hasNextPage` is false or `endCursor` is missing.
 *
 * `maxPages` is a hard safety cap so a malformed server response that
 * keeps reporting `hasNextPage: true` without advancing the cursor
 * cannot spin forever. Default 100 pages × typical page size 100 =
 * 10,000 items — well above any realistic workspace inventory for v1.
 */
export async function collectAllPages<T>(
    fetchPage: (after: string | null) => Promise<ConnectionPage<T>>,
    opts: { maxPages?: number } = {}
): Promise<T[]> {
    const maxPages = opts.maxPages ?? 100;
    const out: T[] = [];
    let after: string | null = null;
    let seenCursors = 0;
    for (let i = 0; i < maxPages; i++) {
        const page = await fetchPage(after);
        if (Array.isArray(page.nodes)) {
            out.push(...page.nodes);
        }
        if (!page.hasNextPage) {
            return out;
        }
        if (!page.endCursor || page.endCursor === after) {
            // Defensive: server says "more" but didn't advance the cursor.
            // Treat as terminal to avoid an infinite loop.
            return out;
        }
        after = page.endCursor;
        seenCursors++;
    }
    // Hit the safety cap. Return what we have; callers may log a warning.
    void seenCursors;
    return out;
}
