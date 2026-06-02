import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    collectAllPages,
    getWorkspaceApiUrl,
    getWorkspaceFilesUrl,
    GraphQLError,
    graphqlRequest,
    type ConnectionPage,
    type WorkspaceInfo,
} from '../../src/workspace';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(response: object) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response));
}

// ── getWorkspaceApiUrl ────────────────────────────────────────────

describe('getWorkspaceApiUrl', () => {
    it('returns envGlobalEndpoint when ws is undefined', () => {
        expect(getWorkspaceApiUrl(undefined, 'https://global.api')).toBe('https://global.api');
    });

    it('returns ws.location.apiServiceUrl when set', () => {
        const ws: WorkspaceInfo = { name: 'ws', workspaceId: '', authId: '', location: { apiServiceUrl: 'https://ws.api' } };
        expect(getWorkspaceApiUrl(ws, 'https://global.api')).toBe('https://ws.api');
    });

    it('returns envGlobalEndpoint when apiServiceUrl is whitespace only', () => {
        const ws: WorkspaceInfo = { name: 'ws', workspaceId: '', authId: '', location: { apiServiceUrl: '  ' } };
        expect(getWorkspaceApiUrl(ws, 'https://global.api')).toBe('https://global.api');
    });

    it('returns envGlobalEndpoint when ws has no location property', () => {
        const ws: WorkspaceInfo = { name: 'ws', workspaceId: '', authId: '' };
        expect(getWorkspaceApiUrl(ws, 'https://global.api')).toBe('https://global.api');
    });
});

// ── getWorkspaceFilesUrl ──────────────────────────────────────────

describe('getWorkspaceFilesUrl', () => {
    it('returns fallback when ws is undefined and fallback is provided', () => {
        expect(getWorkspaceFilesUrl(undefined, 'https://files.fallback')).toBe('https://files.fallback');
    });

    it('returns ws.location.filesServiceUrl when set', () => {
        const ws: WorkspaceInfo = { name: 'ws', workspaceId: '', authId: '', location: { filesServiceUrl: 'https://ws.files' } };
        expect(getWorkspaceFilesUrl(ws)).toBe('https://ws.files');
    });

    it('throws when ws is undefined and no fallback', () => {
        expect(() => getWorkspaceFilesUrl(undefined, undefined)).toThrow(/filesServiceUrl unavailable/);
    });

    it('throws when ws is undefined and fallback is empty string', () => {
        expect(() => getWorkspaceFilesUrl(undefined, '')).toThrow(/filesServiceUrl unavailable/);
    });
});

// ── GraphQLError ──────────────────────────────────────────────────

describe('GraphQLError', () => {
    it('message is set correctly', () => {
        const err = new GraphQLError('msg', { rawErrors: [] });
        expect(err.message).toBe('msg');
    });

    it('code is set when provided', () => {
        const err = new GraphQLError('msg', { code: 'NOT_FOUND', rawErrors: [] });
        expect(err.code).toBe('NOT_FOUND');
    });

    it('name is GraphQLError', () => {
        const err = new GraphQLError('msg', { rawErrors: [] });
        expect(err.name).toBe('GraphQLError');
    });

    it('is instanceof GraphQLError', () => {
        const err = new GraphQLError('msg', { rawErrors: [] });
        expect(err instanceof GraphQLError).toBe(true);
    });

    it('is instanceof Error', () => {
        const err = new GraphQLError('msg', { rawErrors: [] });
        expect(err instanceof Error).toBe(true);
    });
});

// ── graphqlRequest ────────────────────────────────────────────────

describe('graphqlRequest', () => {
    it('returns data for a successful 200 response', async () => {
        mockFetch({ ok: true, text: async () => JSON.stringify({ data: { items: ['a'] } }) });
        const result = await graphqlRequest('https://api', 'tok', '{ query }');
        expect(result).toEqual({ items: ['a'] });
    });

    it('throws GraphQLError for a 200 response with errors array', async () => {
        mockFetch({ ok: true, text: async () => JSON.stringify({ errors: [{ message: 'Not found', extensions: { code: 'NOT_FOUND' } }] }) });
        await expect(graphqlRequest('https://api', 'tok', '{ query }')).rejects.toBeInstanceOf(GraphQLError);
        try {
            mockFetch({ ok: true, text: async () => JSON.stringify({ errors: [{ message: 'Not found', extensions: { code: 'NOT_FOUND' } }] }) });
            await graphqlRequest('https://api', 'tok', '{ query }');
        } catch (e) {
            expect(e instanceof GraphQLError).toBe(true);
            expect((e as GraphQLError).message).toContain('Not found');
            expect((e as GraphQLError).code).toBe('NOT_FOUND');
        }
    });

    it('throws GraphQLError when errors array is present even with data', async () => {
        mockFetch({ ok: true, text: async () => JSON.stringify({ errors: [{ message: 'oops' }], data: {} }) });
        await expect(graphqlRequest('https://api', 'tok', '{ query }')).rejects.toBeInstanceOf(GraphQLError);
    });

    it('throws plain Error for HTTP 4xx', async () => {
        mockFetch({ ok: false, status: 403, text: async () => 'Forbidden' });
        await expect(graphqlRequest('https://api', 'tok', '{ query }')).rejects.toThrow('403');
    });

    it('throws Error for non-JSON response body', async () => {
        mockFetch({ ok: true, text: async () => 'this is not json' });
        await expect(graphqlRequest('https://api', 'tok', '{ query }')).rejects.toThrow();
    });

    it('uses message from first error in array when multiple errors present', async () => {
        mockFetch({ ok: true, text: async () => JSON.stringify({ errors: [{ message: 'first error' }, { message: 'second error' }] }) });
        try {
            await graphqlRequest('https://api', 'tok', '{ query }');
        } catch (e) {
            expect((e as GraphQLError).message).toBe('first error');
        }
    });
});

// ── collectAllPages ──────────────────────────────────────────────

describe('collectAllPages', () => {
    it('returns single page when hasNextPage is false', async () => {
        const fetchPage = vi.fn(async (after: string | null): Promise<ConnectionPage<number>> => {
            expect(after).toBeNull();
            return { nodes: [1, 2, 3], endCursor: 'c1', hasNextPage: false };
        });
        const result = await collectAllPages(fetchPage);
        expect(result).toEqual([1, 2, 3]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('follows endCursor across multiple pages until hasNextPage false', async () => {
        const pages: ConnectionPage<number>[] = [
            { nodes: [1, 2], endCursor: 'c1', hasNextPage: true },
            { nodes: [3, 4], endCursor: 'c2', hasNextPage: true },
            { nodes: [5], endCursor: 'c3', hasNextPage: false },
        ];
        const seen: (string | null)[] = [];
        const fetchPage = vi.fn(async (after: string | null) => {
            seen.push(after);
            return pages.shift()!;
        });
        const result = await collectAllPages(fetchPage);
        expect(result).toEqual([1, 2, 3, 4, 5]);
        expect(seen).toEqual([null, 'c1', 'c2']);
    });

    it('terminates when endCursor is null even if hasNextPage is true', async () => {
        const fetchPage = vi.fn(async () => ({ nodes: [9], endCursor: null, hasNextPage: true }));
        const result = await collectAllPages(fetchPage);
        expect(result).toEqual([9]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('terminates when endCursor does not advance (defensive)', async () => {
        const fetchPage = vi.fn(async () => ({ nodes: [1], endCursor: 'stuck', hasNextPage: true }));
        const result = await collectAllPages(fetchPage);
        expect(result).toEqual([1, 1]); // first page + one more, then stuck-cursor guard fires
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it('honors maxPages safety cap', async () => {
        let i = 0;
        const fetchPage = vi.fn(async () => ({
            nodes: [i],
            endCursor: `c${i++}`,
            hasNextPage: true,
        }));
        const result = await collectAllPages(fetchPage, { maxPages: 3 });
        expect(result).toHaveLength(3);
        expect(fetchPage).toHaveBeenCalledTimes(3);
    });

    it('tolerates non-array nodes in a page', async () => {
        const fetchPage = vi.fn(async () => ({
            nodes: undefined as unknown as number[],
            endCursor: null,
            hasNextPage: false,
        }));
        const result = await collectAllPages(fetchPage);
        expect(result).toEqual([]);
    });
});

/*
 * SKIPPED (D-08): Higher-level workspace functions
 * ──────────────────────────────────────────────────────────────────
 * listWorkspaces / listProjects / listScripts / listExtensionPoints —
 *   require full auth token + vscode.ExtensionContext chain plus
 *   deep GraphQL response shape mocking.
 *
 * pickWorkspace — requires vscode.window.showQuickPick (D-08 UI skip).
 */
