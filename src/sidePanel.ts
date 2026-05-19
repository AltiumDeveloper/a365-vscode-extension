import * as vscode from 'vscode';
import {
    OAuthConfig,
    ensureWorkspaceToken,
    getStoredTokens,
    readOAuthConfig,
} from './auth';
import {
    ProjectInfo,
    ScriptInfo,
    WorkspaceInfo,
    listProjects,
    listScripts,
    listWorkspaces,
} from './workspace';

export const CTX_WORKSPACE = 'workspaceNode';
export const CTX_PROJECT = 'projectNode';
export const CTX_SCRIPT = 'scriptNode';

const OUTPUT_PREFIX = '[Altium 365] tree:';

export type A365Node =
    | { kind: 'workspace'; info: WorkspaceInfo; workspaceUrl: string }
    | { kind: 'project'; workspaceId: string; project: ProjectInfo }
    | {
          kind: 'script';
          workspaceId: string;
          workspaceAuthId: string;
          workspaceUrl: string;
          script: ScriptInfo;
      }
    | { kind: 'info'; label: string }
    | { kind: 'error'; label: string; parent: A365Node | undefined };

export class A365TreeDataProvider implements vscode.TreeDataProvider<A365Node> {
    private _onDidChange = new vscode.EventEmitter<A365Node | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChange.event;

    private workspacesCache?: A365Node[];
    private childrenCache = new Map<string, A365Node[]>();

    constructor(
        private ctx: vscode.ExtensionContext,
        private output: vscode.OutputChannel,
        private getEndpoint: () => string
    ) {}

    refresh(node?: A365Node): void {
        if (!node) {
            this.workspacesCache = undefined;
            this.childrenCache.clear();
            this._onDidChange.fire(undefined);
            return;
        }
        if (node.kind === 'workspace') {
            this.childrenCache.delete(node.info.workspaceId);
            this._onDidChange.fire(node);
            return;
        }
        this._onDidChange.fire(node);
    }

    getTreeItem(n: A365Node): vscode.TreeItem {
        switch (n.kind) {
            case 'workspace': {
                const item = new vscode.TreeItem(
                    n.info.name,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.contextValue = CTX_WORKSPACE;
                item.iconPath = new vscode.ThemeIcon('cloud');
                item.description = n.info.workspaceId;
                return item;
            }
            case 'project': {
                const item = new vscode.TreeItem(
                    n.project.name,
                    vscode.TreeItemCollapsibleState.None
                );
                item.contextValue = CTX_PROJECT;
                item.iconPath = new vscode.ThemeIcon('folder');
                item.description = n.project.id;
                return item;
            }
            case 'script': {
                const item = new vscode.TreeItem(
                    n.script.name,
                    vscode.TreeItemCollapsibleState.None
                );
                item.contextValue = CTX_SCRIPT;
                item.iconPath = new vscode.ThemeIcon('file-code');
                item.tooltip = n.script.description ?? n.script.name;
                item.description = n.script.scriptId;
                return item;
            }
            case 'info': {
                const item = new vscode.TreeItem(
                    n.label,
                    vscode.TreeItemCollapsibleState.None
                );
                item.iconPath = new vscode.ThemeIcon('info');
                return item;
            }
            case 'error': {
                const item = new vscode.TreeItem(
                    n.label,
                    vscode.TreeItemCollapsibleState.None
                );
                item.iconPath = new vscode.ThemeIcon('error');
                item.command = {
                    command: 'altium365.tree.retryNode',
                    title: 'Retry',
                    arguments: [n],
                };
                return item;
            }
        }
    }

    async getChildren(element?: A365Node): Promise<A365Node[]> {
        try {
            if (!element) {
                return await this.loadWorkspaces();
            }
            if (element.kind === 'workspace') {
                return await this.loadWorkspaceChildren(element);
            }
            return [];
        } catch (e) {
            const msg = (e as Error).message;
            this.output.appendLine(`${OUTPUT_PREFIX} ${msg}`);
            return [
                {
                    kind: 'error',
                    label: 'Failed: ' + msg,
                    parent: element,
                },
            ];
        }
    }

    private async loadWorkspaces(): Promise<A365Node[]> {
        if (this.workspacesCache) {
            return this.workspacesCache;
        }
        const cfg: OAuthConfig = readOAuthConfig();
        void cfg;
        const base = await getStoredTokens(this.ctx);
        if (!base?.access_token) {
            return [];
        }
        const endpoint = this.getEndpoint();
        const list = await listWorkspaces(endpoint, base.access_token);
        if (list.length === 0) {
            const empty: A365Node[] = [
                { kind: 'info', label: 'No workspaces available for this account' },
            ];
            this.workspacesCache = empty;
            return empty;
        }
        const workspaceUrl = endpoint.replace(/\/api(\/.*)?$/, '') || endpoint;
        const nodes: A365Node[] = list.map((info) => ({
            kind: 'workspace' as const,
            info,
            workspaceUrl,
        }));
        this.workspacesCache = nodes;
        return nodes;
    }

    private async loadWorkspaceChildren(
        element: Extract<A365Node, { kind: 'workspace' }>
    ): Promise<A365Node[]> {
        const key = element.info.workspaceId;
        const cached = this.childrenCache.get(key);
        if (cached) {
            return cached;
        }
        const wsToken = await ensureWorkspaceToken(this.ctx, readOAuthConfig(), {
            workspaceId: element.info.workspaceId,
            authId: element.info.authId,
        });
        const endpoint = this.getEndpoint();
        const [projects, scripts] = await Promise.all([
            listProjects(endpoint, wsToken),
            listScripts(endpoint, wsToken),
        ]);
        const sortedProjects = [...projects].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '')
        );
        const sortedScripts = [...scripts].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '')
        );
        const projectNodes: A365Node[] = sortedProjects.map((p) => ({
            kind: 'project' as const,
            workspaceId: element.info.workspaceId,
            project: p,
        }));
        const scriptNodes: A365Node[] = sortedScripts.map((s) => ({
            kind: 'script' as const,
            workspaceId: element.info.workspaceId,
            workspaceAuthId: element.info.authId,
            workspaceUrl: element.workspaceUrl,
            script: s,
        }));
        const combined = [...projectNodes, ...scriptNodes];
        this.childrenCache.set(key, combined);
        return combined;
    }
}
