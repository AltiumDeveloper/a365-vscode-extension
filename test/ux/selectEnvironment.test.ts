import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { onAuthStateChanged, readOAuthConfig, type AuthState } from '../../src/auth';
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

async function keepSessionSwitchTo(target: string): Promise<AuthState[]> {
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
    const received: AuthState[] = [];
    const d = onAuthStateChanged((s) => received.push(s));
    try {
        await doSelectEnvironment(ctx, { appendLine: vi.fn() } as unknown as vscode.OutputChannel);
    } finally {
        d.dispose();
    }
    return received;
}

describe('doSelectEnvironment with Keep session', () => {
    it('reports signed out in an environment with a different auth server', async () => {
        expect(await keepSessionSwitchTo('Dev')).toEqual([{ signedIn: false, environment: 'Dev' }]);
    });

    it('keeps the session in an environment sharing the auth server', async () => {
        expect(await keepSessionSwitchTo('ProdUs')).toEqual([
            { signedIn: true, environment: 'ProdUs' },
        ]);
    });
});
