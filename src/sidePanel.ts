import * as vscode from 'vscode';
import {
    OAuthConfig,
    ensureWorkspaceToken,
    getBaseAccessToken,
    readOAuthConfig,
} from './auth';
import {
    ProjectInfo,
    ScriptInfo,
    WorkspaceInfo,
    getSelectedWorkspace,
    getWorkspaceApiUrl,
    listProjects,
    listScripts,
    listWorkspaces,
} from './workspace';

export const CTX_WORKSPACE = 'workspaceNode';
export const CTX_PROJECT = 'projectNode';
export const CTX_SCRIPT = 'scriptNode';
export const CTX_PROJECTS_CATEGORY = 'projectsCategoryNode';
export const CTX_SCRIPTS_CATEGORY = 'scriptsCategoryNode';

const OUTPUT_PREFIX = '[Altium 365] tree:';

export type A365Node =
    | { kind: 'workspace'; info: WorkspaceInfo; workspaceUrl: string; url?: string }
    | {
          kind: 'projectsCategory';
          workspaceId: string;
          workspaceAuthId: string;
          count: number;
      }
    | {
          kind: 'scriptsCategory';
          workspaceId: string;
          workspaceAuthId: string;
          workspaceUrl: string;
          count: number;
      }
    | { kind: 'project'; workspaceId: string; project: ProjectInfo; url?: string }
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
    private projectsCache = new Map<string, A365Node[]>();
    private scriptsCache = new Map<string, A365Node[]>();

    constructor(
        private ctx: vscode.ExtensionContext,
        private output: vscode.OutputChannel,
        private getEndpoint: () => string
    ) {}

    refresh(node?: A365Node): void {
        if (!node) {
            this.workspacesCache = undefined;
            this.projectsCache.clear();
            this.scriptsCache.clear();
            this._onDidChange.fire(undefined);
            return;
        }
        if (node.kind === 'workspace') {
            this.projectsCache.delete(node.info.workspaceId);
            this.scriptsCache.delete(node.info.workspaceId);
            this._onDidChange.fire(node);
            return;
        }
        if (node.kind === 'projectsCategory') {
            // WR-03 fix: clearing only the projects cache leaves the parent
            // workspace's category node (with its baked `count`) intact, so
            // the row reads "Projects (3)" while getChildren returns []. Bubble
            // to the parent workspace so loadWorkspaceChildren reruns and
            // rebuilds both category nodes with fresh counts.
            this.projectsCache.delete(node.workspaceId);
            const parent = this.workspacesCache?.find(
                (w): w is Extract<A365Node, { kind: 'workspace' }> =>
                    w.kind === 'workspace' && w.info.workspaceId === node.workspaceId
            );
            this._onDidChange.fire(parent);
            return;
        }
        if (node.kind === 'scriptsCategory') {
            // WR-03 fix: see projectsCategory above — same staleness pattern.
            this.scriptsCache.delete(node.workspaceId);
            const parent = this.workspacesCache?.find(
                (w): w is Extract<A365Node, { kind: 'workspace' }> =>
                    w.kind === 'workspace' && w.info.workspaceId === node.workspaceId
            );
            this._onDidChange.fire(parent);
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
                // Active-workspace cue (D-08, D-09, D-10): reflects the user's
                // explicit selection via `Altium 365: Select Workspace`
                // (persisted in globalState by `pickAndExchangeWorkspace`).
                // Icon strategy: active = $(circle-filled), inactive = $(cloud)
                // + descriptionForeground. The `(active)` text suffix has been
                // dropped — the icon swap carries the signal alone.
                // Icon choice rationale (D-10): `circle-filled` is reserved
                // here because future 999.2 workspace-favorites will use
                // `star-full`/`pinned`; the two cues can stack without
                // semantic collision — do not swap this back to a star/pin
                // glyph without first revisiting the favorites design.
                const selected = getSelectedWorkspace(this.ctx);
                const isActive = selected?.workspaceId === n.info.workspaceId;
                if (isActive) {
                    item.iconPath = new vscode.ThemeIcon('circle-filled');
                } else {
                    item.iconPath = new vscode.ThemeIcon(
                        'cloud',
                        new vscode.ThemeColor('descriptionForeground')
                    );
                }
                return item;
            }
            case 'projectsCategory': {
                const item = new vscode.TreeItem(
                    `Projects (${n.count})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.contextValue = CTX_PROJECTS_CATEGORY;
                item.iconPath = new vscode.ThemeIcon('project');
                return item;
            }
            case 'scriptsCategory': {
                const item = new vscode.TreeItem(
                    `Scripts (${n.count})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.contextValue = CTX_SCRIPTS_CATEGORY;
                item.iconPath = new vscode.ThemeIcon('file-code');
                return item;
            }
            case 'project': {
                const item = new vscode.TreeItem(
                    n.project.name,
                    vscode.TreeItemCollapsibleState.None
                );
                item.contextValue = CTX_PROJECT;
                item.iconPath = new vscode.ThemeIcon('folder');
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
            if (element.kind === 'projectsCategory') {
                return this.projectsCache.get(element.workspaceId) ?? [];
            }
            if (element.kind === 'scriptsCategory') {
                return this.scriptsCache.get(element.workspaceId) ?? [];
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
        const baseToken = await getBaseAccessToken(this.ctx, cfg);
        if (!baseToken) {
            return [];
        }
        const endpoint = this.getEndpoint();
        const list = await listWorkspaces(endpoint, baseToken);
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
            url: info.url,
        }));
        this.workspacesCache = nodes;
        return nodes;
    }

    private async loadWorkspaceChildren(
        element: Extract<A365Node, { kind: 'workspace' }>
    ): Promise<A365Node[]> {
        const workspaceId = element.info.workspaceId;
        const wsToken = await ensureWorkspaceToken(this.ctx, readOAuthConfig(), {
            workspaceId,
            authId: element.info.authId,
        });
        // Phase 02.3 D-19: workspace-scoped queries MUST target the workspace's
        // own apiServiceUrl, not the env-global graphqlEndpoint, since a
        // workspace can live on a different cluster than the env gateway.
        const endpoint = getWorkspaceApiUrl(element.info, this.getEndpoint());
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
            workspaceId,
            project: p,
            url: p.url,
        }));
        const scriptNodes: A365Node[] = sortedScripts.map((s) => ({
            kind: 'script' as const,
            workspaceId,
            workspaceAuthId: element.info.authId,
            workspaceUrl: element.workspaceUrl,
            script: s,
        }));
        this.projectsCache.set(workspaceId, projectNodes);
        this.scriptsCache.set(workspaceId, scriptNodes);
        return [
            {
                kind: 'projectsCategory',
                workspaceId,
                workspaceAuthId: element.info.authId,
                count: projectNodes.length,
            },
            {
                kind: 'scriptsCategory',
                workspaceId,
                workspaceAuthId: element.info.authId,
                workspaceUrl: element.workspaceUrl,
                count: scriptNodes.length,
            },
        ];
    }
}
