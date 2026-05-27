import * as vscode from 'vscode';
import {
    OAuthConfig,
    ensureWorkspaceToken,
    getBaseAccessToken,
    readOAuthConfig,
} from './auth';
import {
    AssignmentInfo,
    ExtensionPointInfo,
    ProjectInfo,
    ScriptInfo,
    WorkspaceInfo,
    getSelectedWorkspace,
    getWorkspaceApiUrl,
    listExtensionPoints,
    listProjects,
    listScripts,
    listWorkspaces,
} from './workspace';

export const CTX_WORKSPACE_ACTIVE = 'workspaceNode-active';
export const CTX_WORKSPACE_INACTIVE = 'workspaceNode-inactive';
export const CTX_PROJECT = 'projectNode';
export const CTX_SCRIPT = 'scriptNode';
export const CTX_PROJECTS_CATEGORY = 'projectsCategoryNode';
export const CTX_SCRIPTS_CATEGORY = 'scriptsCategoryNode';
export const CTX_EXTENSION_POINTS_CATEGORY = 'extensionPointsCategoryNode';
export const CTX_ENTITY_TYPE_GROUP = 'entityTypeGroupNode';
export const CTX_EP_TYPE_GROUP = 'epTypeGroupNode';
export const CTX_EXTENSION_POINT = 'extensionPointNode';
export const CTX_ASSIGNMENT_SCRIPT = 'assignmentNode-script';
export const CTX_ASSIGNMENT_WORKFLOW = 'assignmentNode-workflow';
export const CTX_ASSIGNMENT_DEFAULT = 'assignmentNode-default';

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
    | {
          kind: 'extensionPointsCategory';
          workspaceId: string;
          workspaceAuthId: string;
          workspaceUrl: string;
          count: number;
      }
    | {
          kind: 'entityTypeGroupNode';
          workspaceId: string;
          workspaceAuthId: string;
          entityType: string;
          epCount: number;
      }
    | {
          kind: 'epTypeGroupNode';
          workspaceId: string;
          workspaceAuthId: string;
          entityType: string;
          epType: string;
          epCount: number;
      }
    | {
          kind: 'extensionPointNode';
          workspaceId: string;
          workspaceAuthId: string;
          extensionPoint: ExtensionPointInfo;
          assignmentCount: number;
      }
    | {
          kind: 'assignmentNode';
          workspaceId: string;
          workspaceAuthId: string;
          workspaceUrl: string;
          assignment: AssignmentInfo;
      }
    | { kind: 'info'; label: string }
    | { kind: 'error'; label: string; parent: A365Node | undefined };

export class A365TreeDataProvider implements vscode.TreeDataProvider<A365Node> {
    private _onDidChange = new vscode.EventEmitter<A365Node | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChange.event;

    private workspacesCache?: A365Node[];
    private projectsCache = new Map<string, A365Node[]>();
    private scriptsCache = new Map<string, A365Node[]>();
    private extensionPointsCache = new Map<string, ExtensionPointInfo[]>();
    private assignmentsCache = new Map<string, Map<string, AssignmentInfo[]>>();

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
            this.extensionPointsCache.clear();
            this.assignmentsCache.clear();
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
        if (node.kind === 'extensionPointsCategory') {
            this.extensionPointsCache.delete(node.workspaceId);
            this.assignmentsCache.delete(node.workspaceId);
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
                // Active-workspace cue (D-08, D-09, D-10): reflects the user's
                // explicit selection via `Altium 365: Select Workspace`
                // (persisted in globalState by `applyWorkspaceSelection`).
                // Icon strategy: active = $(circle-filled), inactive = $(cloud)
                // + descriptionForeground. The `(active)` text suffix has been
                // dropped — the icon swap carries the signal alone.
                // Icon choice rationale (D-10): `circle-filled` is reserved
                // here because future 999.2 workspace-favorites will use
                // `star-full`/`pinned`; the two cues can stack without
                // semantic collision — do not swap this back to a star/pin
                // glyph without first revisiting the favorites design.
                //
                // contextValue (Plan 04-04, D-11/D-12/D-13): split into
                // -active vs -inactive so package.json view/item/context can
                // surface the "Select Workspace" entry ONLY on inactive
                // workspaces (hiding the self-action on the already-active one).
                const selected = getSelectedWorkspace(this.ctx);
                const isActive = selected?.workspaceId === n.info.workspaceId;
                if (isActive) {
                    item.iconPath = new vscode.ThemeIcon('circle-filled');
                    item.contextValue = CTX_WORKSPACE_ACTIVE;
                } else {
                    item.iconPath = new vscode.ThemeIcon(
                        'cloud',
                        new vscode.ThemeColor('descriptionForeground')
                    );
                    item.contextValue = CTX_WORKSPACE_INACTIVE;
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
            case 'extensionPointsCategory': {
                const item = new vscode.TreeItem(
                    `Extension Points (${n.count})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.contextValue = CTX_EXTENSION_POINTS_CATEGORY;
                item.iconPath = new vscode.ThemeIcon('symbol-namespace');
                return item;
            }
            case 'entityTypeGroupNode': {
                const item = new vscode.TreeItem(
                    `${n.entityType} (${n.epCount})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                const iconMap: Record<string, string> = {
                    'Project': 'folder',
                    'BOM': 'list-tree',
                    'Workspace': 'workspace',
                    'Library': 'library',
                };
                item.iconPath = new vscode.ThemeIcon(iconMap[n.entityType] || 'symbol-namespace');
                item.contextValue = CTX_ENTITY_TYPE_GROUP;
                return item;
            }
            case 'epTypeGroupNode': {
                const item = new vscode.TreeItem(
                    `${n.epType} (${n.epCount})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                const iconMap: Record<string, string> = {
                    'UIAction.ContextMenu': 'symbol-method',
                    'Event': 'symbol-event',
                    'Project.ERC': 'checklist',
                    'BOM.Checks': 'checklist',
                };
                item.iconPath = new vscode.ThemeIcon(iconMap[n.epType] || 'symbol-key');
                item.contextValue = CTX_EP_TYPE_GROUP;
                return item;
            }
            case 'extensionPointNode': {
                const item = new vscode.TreeItem(
                    `${n.extensionPoint.name} (${n.assignmentCount})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.iconPath = new vscode.ThemeIcon('symbol-interface');
                item.contextValue = CTX_EXTENSION_POINT;
                item.tooltip = n.extensionPoint.description || n.extensionPoint.name;
                return item;
            }
            case 'assignmentNode': {
                const item = new vscode.TreeItem(
                    n.assignment.name || 'Unnamed Assignment',
                    vscode.TreeItemCollapsibleState.None
                );
                
                if (n.assignment.type === 'SCRIPT') {
                    item.iconPath = new vscode.ThemeIcon('file-code');
                    item.contextValue = CTX_ASSIGNMENT_SCRIPT;
                    item.command = {
                        command: 'altium365.script.edit',
                        title: 'Edit Script',
                        arguments: [n],
                    };
                } else if (n.assignment.type === 'WORKFLOW') {
                    item.iconPath = new vscode.ThemeIcon(
                        'workflow',
                        new vscode.ThemeColor('descriptionForeground')
                    );
                    item.contextValue = CTX_ASSIGNMENT_WORKFLOW;
                } else if (n.assignment.type === 'DEFAULT') {
                    item.iconPath = new vscode.ThemeIcon(
                        'circle-outline',
                        new vscode.ThemeColor('descriptionForeground')
                    );
                    item.contextValue = CTX_ASSIGNMENT_DEFAULT;
                }
                
                const paramsSummary = 'none'; // TODO: Extract from extension point definition when available
                item.tooltip = `${n.assignment.name || 'Unnamed'}\n\nParameters: ${paramsSummary}`;
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
                // D-19 / SC-4: single-click on a script leaf opens the same
                // Edit Script path as the right-click context entry. VS Code
                // honors TreeItem.command on leaf items under the default
                // `workbench.list.openMode: singleClick` (RESEARCH §2.3 —
                // there is no separate double-click event).
                item.command = {
                    command: 'altium365.script.edit',
                    title: 'Edit Script',
                    arguments: [n],
                };
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
            if (element.kind === 'extensionPointsCategory') {
                return this.loadEntityTypeGroups(element);
            }
            if (element.kind === 'entityTypeGroupNode') {
                return this.loadEpTypeGroups(element);
            }
            if (element.kind === 'epTypeGroupNode') {
                return this.loadExtensionPoints(element);
            }
            if (element.kind === 'extensionPointNode') {
                return this.loadAssignments(element);
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
        const [projects, scripts, extensionPointsData] = await Promise.all([
            listProjects(endpoint, wsToken),
            listScripts(endpoint, wsToken),
            listExtensionPoints(endpoint, wsToken),
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
        this.extensionPointsCache.set(workspaceId, extensionPointsData.extensionPoints);
        this.assignmentsCache.set(workspaceId, extensionPointsData.assignments);
        
        // Count only extension points with non-DEFAULT assignments
        const nonEmptyEPCount = extensionPointsData.extensionPoints.filter(ep => {
            const assignments = extensionPointsData.assignments.get(ep.extensionPointId) || [];
            return assignments.some(a => a.type !== 'DEFAULT');
        }).length;
        
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
            {
                kind: 'extensionPointsCategory',
                workspaceId,
                workspaceAuthId: element.info.authId,
                workspaceUrl: element.workspaceUrl,
                count: nonEmptyEPCount,
            },
        ];
    }

    private loadEntityTypeGroups(
        element: Extract<A365Node, { kind: 'extensionPointsCategory' }>
    ): A365Node[] {
        const extensionPoints = this.extensionPointsCache.get(element.workspaceId) || [];
        const workspaceAssignments = this.assignmentsCache.get(element.workspaceId);
        
        const grouped = new Map<string, ExtensionPointInfo[]>();
        for (const ep of extensionPoints) {
            // Only include EPs that have non-DEFAULT assignments
            if (workspaceAssignments) {
                const assignments = workspaceAssignments.get(ep.extensionPointId) || [];
                if (!assignments.some(a => a.type !== 'DEFAULT')) {
                    continue;  // Skip this EP - no non-DEFAULT assignments
                }
            }
            
            const entityType = ep.entityType || 'Other';
            if (!grouped.has(entityType)) {
                grouped.set(entityType, []);
            }
            grouped.get(entityType)!.push(ep);
        }
        
        return Array.from(grouped.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([entityType, eps]): A365Node => ({
                kind: 'entityTypeGroupNode',
                workspaceId: element.workspaceId,
                workspaceAuthId: element.workspaceAuthId,
                entityType,
                epCount: eps.length,
            }));
    }

    private loadEpTypeGroups(
        element: Extract<A365Node, { kind: 'entityTypeGroupNode' }>
    ): A365Node[] {
        const extensionPoints = this.extensionPointsCache.get(element.workspaceId) || [];
        const filtered = extensionPoints.filter(ep => ep.entityType === element.entityType);
        const workspaceAssignments = this.assignmentsCache.get(element.workspaceId);
        
        const grouped = new Map<string, ExtensionPointInfo[]>();
        for (const ep of filtered) {
            // Only include EPs that have non-DEFAULT assignments
            if (workspaceAssignments) {
                const assignments = workspaceAssignments.get(ep.extensionPointId) || [];
                if (!assignments.some(a => a.type !== 'DEFAULT')) {
                    continue;  // Skip this EP - no non-DEFAULT assignments
                }
            }
            
            const epType = ep.type || 'Other';
            if (!grouped.has(epType)) {
                grouped.set(epType, []);
            }
            grouped.get(epType)!.push(ep);
        }
        
        return Array.from(grouped.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([epType, eps]): A365Node => ({
                kind: 'epTypeGroupNode',
                workspaceId: element.workspaceId,
                workspaceAuthId: element.workspaceAuthId,
                entityType: element.entityType,
                epType,
                epCount: eps.length,
            }));
    }

    private loadExtensionPoints(
        element: Extract<A365Node, { kind: 'epTypeGroupNode' }>
    ): A365Node[] {
        const extensionPoints = this.extensionPointsCache.get(element.workspaceId) || [];
        const filtered = extensionPoints.filter(
            ep => ep.entityType === element.entityType && ep.type === element.epType
        );
        
        // Only show extension points that have non-DEFAULT assignments
        const workspaceAssignments = this.assignmentsCache.get(element.workspaceId);
        const nonEmptyEPs = filtered.filter(ep => {
            if (!workspaceAssignments) return false;
            const assignments = workspaceAssignments.get(ep.extensionPointId) || [];
            // Has at least one non-DEFAULT assignment
            return assignments.some(a => a.type !== 'DEFAULT');
        });
        
        return nonEmptyEPs
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ep): A365Node => ({
                kind: 'extensionPointNode',
                workspaceId: element.workspaceId,
                workspaceAuthId: element.workspaceAuthId,
                extensionPoint: ep,
                assignmentCount: ep.assignmentCount || 0,
            }));
    }

    private loadAssignments(
        element: Extract<A365Node, { kind: 'extensionPointNode' }>
    ): A365Node[] {
        const workspaceAssignments = this.assignmentsCache.get(element.workspaceId);
        if (!workspaceAssignments) {
            return [];
        }
        
        const assignments = workspaceAssignments.get(element.extensionPoint.extensionPointId) || [];
        
        // Filter out DEFAULT assignments - they add noise and aren't actionable
        const filteredAssignments = assignments.filter(a => a.type !== 'DEFAULT');
        
        return filteredAssignments
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map((assignment): A365Node => ({
                kind: 'assignmentNode',
                workspaceId: element.workspaceId,
                workspaceAuthId: element.workspaceAuthId,
                workspaceUrl: '',
                assignment,
            }));
    }
}
