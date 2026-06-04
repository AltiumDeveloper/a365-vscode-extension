import * as vscode from 'vscode';

/** Fields that can be overridden per named environment. */
interface EnvOverride {
    graphqlEndpoint?: string;
    authEndpoint?: string;
    tokenEndpoint?: string;
    actionWaitEndpoint?: string;
    redirectUri?: string;
    scopes?: string;
}

/** Fully resolved runtime configuration. */
export interface ResolvedConfig {
    graphqlEndpoint: string;
    authEndpoint: string;
    tokenEndpoint: string;
    actionWaitEndpoint: string;
    redirectUri: string;
    scopes: string;
    clientId: string;
}

/**
 * Resolve the active configuration by merging the active environment preset
 * over the top-level individual settings.
 *
 * Resolution order (highest → lowest priority):
 *   1. Active named environment (`altium365.environments[activeEnvironment]`)
 *   2. Top-level individual setting  (e.g. `altium365.graphqlEndpoint`)
 *   3. Hard-coded fallback
 *
 * `clientId` is not per-environment and always comes from the top-level setting.
 */
export function resolveConfig(): ResolvedConfig {
    const cfg = vscode.workspace.getConfiguration('altium365');
    const activeEnv = cfg.get<string>('activeEnvironment') ?? '';
    const envs = cfg.get<Record<string, EnvOverride>>('environments') ?? {};
    const env: EnvOverride = (activeEnv ? envs[activeEnv] : undefined) ?? {};

    const pick = (key: keyof EnvOverride, fallback = ''): string =>
        env[key] || cfg.get<string>(key) || fallback;

    return {
        graphqlEndpoint: pick('graphqlEndpoint'),
        authEndpoint: pick('authEndpoint'),
        tokenEndpoint: pick('tokenEndpoint'),
        actionWaitEndpoint: pick('actionWaitEndpoint'),
        redirectUri: pick('redirectUri'),
        scopes: pick('scopes', 'openid profile'),
        clientId: cfg.get<string>('clientId') ?? '',
    };
}
