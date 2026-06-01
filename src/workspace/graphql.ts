/**
 * Typed GraphQL error surfaced by `graphqlRequest` when the response body
 * carries a non-empty `errors[]` array. Mirrors the OAuth-error mapping
 * pattern landed in `doSignIn` (commit `a00dcc0`) — D-11. The legacy
 * full-fidelity JSON blob is preserved as `rawErrors` so callers can append
 * it to OutputChannel for diagnosis without losing the readable message.
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

export async function graphqlRequest(
    endpoint: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>
): Promise<any> {
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
    let payload: any;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error(`GraphQL non-JSON response: ${text.slice(0, 500)}`);
    }
    if (payload.errors) {
        // D-11: typed throw so command-boundary handlers can map well-known
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
