import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { getStoredTokens, readOAuthConfig } from '../../src/auth';
import { doSelectEnvironment } from '../../src/ux/commands';
import { makeExtensionContext } from '../__mocks__/vscode';

const prod = {
    graphqlEndpoint: 'https://prod.example.com/graphql',
    authEndpoint: 'https://auth.prod.example.com/connect/authorize',
    tokenEndpoint: 'https://auth.prod.example.com/connect/token',
};
const settings: Record<string, unknown> = {};

beforeEach(() => {
    Object.assign(settings, {
        clientId: 'test-client',
        activeEnvironment: 'Prod',
        environments: {
            Prod: prod,
            ProdUs: { ...prod, graphqlEndpoint: 'https://us.prod.example.com/graphql' },
            Dev: { ...prod, tokenEndpoint: 'https://auth.dev.example.com/connect/token' },
        },
    });
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        () =>
            ({
                get: (key: string, fallback?: unknown) => settings[key] ?? fallback,
                update: async (key: string, value: unknown) => {
                    settings[key] = value;
                },
            }) as unknown as vscode.WorkspaceConfiguration
    );
});

async function keepSessionSwitchTo(target: string): Promise<vscode.ExtensionContext> {
    const ctx = makeExtensionContext();
    await ctx.secrets.store(
        'altium365.tokens',
        JSON.stringify({ access_token: 'prod-at', origin: readOAuthConfig() })
    );
    vi.mocked(vscode.window.showQuickPick).mockImplementation(
        async (items) => (await items).find((i) => i.label === target)
    );
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
        'Keep session' as unknown as vscode.MessageItem
    );
    await doSelectEnvironment(ctx, { appendLine: vi.fn() } as unknown as vscode.OutputChannel);
    return ctx;
}

describe('doSelectEnvironment with Keep session', () => {
    it('hides the kept session in an environment with a different auth server', async () => {
        const ctx = await keepSessionSwitchTo('Dev');
        expect(await getStoredTokens(ctx)).toBeUndefined();
        expect(await ctx.secrets.get('altium365.tokens')).toContain('prod-at');
    });

    it('keeps the session usable in an environment sharing the auth server', async () => {
        const ctx = await keepSessionSwitchTo('ProdUs');
        expect((await getStoredTokens(ctx))?.access_token).toBe('prod-at');
    });
});
