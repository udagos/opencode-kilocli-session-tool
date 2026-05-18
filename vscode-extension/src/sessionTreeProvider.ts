import * as vscode from 'vscode';
import * as path from 'path';
import { OsmService, ISession } from './osmService';

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionNode | undefined | void> = new vscode.EventEmitter<SessionNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionNode | undefined | void> = this._onDidChangeTreeData.event;

    private service: OsmService;
    private sessions: ISession[] = [];
    private searchQuery: string | undefined;

    constructor(service: OsmService) {
        this.service = service;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setSearchQuery(query: string | undefined): void {
        this.searchQuery = query;
        this.refresh();
    }

    getTreeItem(element: SessionNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SessionNode): Promise<SessionNode[]> {
        if (!element) {
            // Root level: fetch sessions
            const config = vscode.workspace.getConfiguration('osm');
            const sortBy = config.get<string>('sortBy') || 'time_updated';
            const sortOrder = config.get<string>('sortOrder') || 'DESC';

            const data: any = await this.service.fetchSessions(this.searchQuery, sortBy, sortOrder);

            // Check if the old structure is returned (array of sessions) or new structure (object with sessions and folders)
            let sessionsData: ISession[] = [];
            let foldersData: any[] = [];

            if (Array.isArray(data)) {
                sessionsData = data;
            } else if (data && typeof data === 'object') {
                sessionsData = data.sessions || [];
                foldersData = data.folders || [];
            }

            this.sessions = sessionsData;

            if (this.sessions.length === 0 && foldersData.length === 0) {
                return [];
            }

            if (this.searchQuery) {
                // Flat list for search results
                return this.sessions.map(s => new SessionItemNode(s));
            }

            // Top-Level Nodes
            const topNodes: SessionNode[] = [];

            // Pinned Section
            const pinnedSessions = this.sessions.filter(s => s.is_pinned);
            const pinnedFolders = foldersData.filter(f => f.is_pinned);

            if (pinnedSessions.length > 0 || pinnedFolders.length > 0) {
                const pinnedNodes: SessionNode[] = [];
                if (pinnedFolders.length > 0) {
                    pinnedNodes.push(new FolderNode('📁 Projects', pinnedFolders.map(f => this.createProjectNode(f, this.sessions))));
                }
                if (pinnedSessions.length > 0) {
                    pinnedNodes.push(new FolderNode('💬 Sessions', pinnedSessions.map(s => new SessionItemNode(s))));
                }
                topNodes.push(new FolderNode('📌 Pinned', pinnedNodes));
            }

            // Labels Section
            const allLabels = new Set<string>();
            for (const s of this.sessions) {
                if (s.labels) s.labels.forEach(l => { if(l.trim()) allLabels.add(l.trim()); });
            }
            for (const f of foldersData) {
                if (f.labels) f.labels.forEach((l: string) => { if(l.trim()) allLabels.add(l.trim()); });
            }

            if (allLabels.size > 0) {
                const labelNodes: SessionNode[] = [];
                const sortedLabels = Array.from(allLabels).sort();

                for (const label of sortedLabels) {
                    const sessionsWithLabel = this.sessions.filter(s => s.labels && s.labels.includes(label));
                    const foldersWithLabel = foldersData.filter(f => f.labels && f.labels.includes(label));

                    const labelSubNodes: SessionNode[] = [];
                    if (foldersWithLabel.length > 0) {
                        labelSubNodes.push(new FolderNode('📁 Projects', foldersWithLabel.map(f => this.createProjectNode(f, this.sessions))));
                    }
                    if (sessionsWithLabel.length > 0) {
                        labelSubNodes.push(new FolderNode('💬 Sessions', sessionsWithLabel.map(s => new SessionItemNode(s))));
                    }

                    labelNodes.push(new FolderNode(`🏷️ ${label}`, labelSubNodes));
                }
                topNodes.push(new FolderNode('🏷️ By Label', labelNodes));
            }

            // All Projects Section
            topNodes.push(new FolderNode('📁 All Projects', this.getProjectNodes(this.sessions, foldersData)));

            return topNodes;
        } else if (element instanceof FolderNode || element instanceof ProjectNode) {
            return element.children;
        }

        return [];
    }

    private createProjectNode(folderMeta: any, allSessions: ISession[]): ProjectNode {
        const id = folderMeta.workspace_id || folderMeta.directory;
        const projectSessions = allSessions.filter(s => (s.workspace_id || s.directory) === id);
        const folderName = folderMeta.directory === '(No Directory)' || !folderMeta.directory ? '(No Directory)' : path.basename(folderMeta.directory);

        return new ProjectNode(
            folderName,
            projectSessions.map(s => new SessionItemNode(s)),
            folderMeta
        );
    }

    private getProjectNodes(sessions: ISession[], foldersData: any[]): SessionNode[] {
        const projectsMap = new Map<string, ISession[]>();
        for (const session of sessions) {
            const key = session.workspace_id || session.directory || '(No Directory)';
            if (!projectsMap.has(key)) {
                projectsMap.set(key, []);
            }
            projectsMap.get(key)!.push(session);
        }

        const projectNodes: ProjectNode[] = [];
        for (const [key, projectSessions] of projectsMap.entries()) {
            const folderMeta = foldersData.find(f => (f.workspace_id || f.directory) === key) || {
                workspace_id: projectSessions[0]?.workspace_id || null,
                directory: projectSessions[0]?.directory || key,
                is_pinned: false,
                note: null,
                labels: []
            };

            const dir = folderMeta.directory || '(No Directory)';
            const folderName = dir === '(No Directory)' ? dir : path.basename(dir);
            projectNodes.push(new ProjectNode(folderName, projectSessions.map(s => new SessionItemNode(s)), folderMeta));
        }

        // Apply same sorting to folders
        const config = vscode.workspace.getConfiguration('osm');
        const sortBy = config.get<string>('sortBy') || 'time_updated';
        const sortOrder = config.get<string>('sortOrder') || 'DESC';

        projectNodes.sort((a, b) => {
            let valA: any = 0;
            let valB: any = 0;

            if (sortBy === 'title') {
                valA = a.label;
                valB = b.label;
                if (sortOrder === 'ASC') {
                    return valA.localeCompare(valB);
                } else {
                    return valB.localeCompare(valA);
                }
            } else if (sortBy === 'time_updated') {
                // Get max updated time from sessions inside this folder
                valA = Math.max(...a.children.map((c: any) => c.session?.updated_at || 0));
                valB = Math.max(...b.children.map((c: any) => c.session?.updated_at || 0));
            } else if (sortBy === 'time_created') {
                // Get min created time from sessions inside this folder
                valA = Math.max(...a.children.map((c: any) => c.session?.created_at || 0));
                valB = Math.max(...b.children.map((c: any) => c.session?.created_at || 0));
            }

            if (sortOrder === 'ASC') {
                return valA > valB ? 1 : -1;
            } else {
                return valA < valB ? 1 : -1;
            }
        });

        return projectNodes;
    }
}

export abstract class SessionNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

export class FolderNode extends SessionNode {
    constructor(
        public readonly label: string,
        public readonly children: SessionNode[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'folder';
    }
}

export class ProjectNode extends SessionNode {
    constructor(
        public readonly label: string,
        public readonly children: SessionNode[],
        public readonly folderMeta: any
    ) {
        super(folderMeta.is_pinned ? `📌 ${label}` : label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = folderMeta.is_pinned ? 'project_pinned' : 'project';

        let tooltipText = `Directory: ${folderMeta.directory}`;
        if (folderMeta.labels && folderMeta.labels.length > 0) {
            tooltipText += `\nLabels: ${folderMeta.labels.join(', ')}`;
        }
        if (folderMeta.note) {
            tooltipText += `\nNote: ${folderMeta.note}`;
        }
        this.tooltip = tooltipText;

        let desc = folderMeta.directory;
        if (folderMeta.note) {
            desc += ` - 📝 ${folderMeta.note}`;
        }
        this.description = desc;
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

export class SessionItemNode extends SessionNode {
    constructor(
        public readonly session: ISession
    ) {
        super(session.is_pinned ? `📌 ${session.display_title}` : session.display_title, vscode.TreeItemCollapsibleState.None);

        let tooltipText = `ID: ${session.sid}\nLast updated: ${this.formatTime(session.updated_at)}`;
        if (session.labels && session.labels.length > 0) {
            tooltipText += `\nLabels: ${session.labels.join(', ')}`;
        }
        if (session.note) {
            tooltipText += `\nNote: ${session.note}`;
        }
        this.tooltip = tooltipText;

        let desc = this.getHumanTime(session.updated_at);
        if (session.note) {
            desc += ` - 📝 ${session.note}`;
        }
        this.description = desc;

        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.contextValue = session.is_pinned ? 'session_pinned' : 'session';
    }

    private formatTime(timestamp: number | null): string {
        if (!timestamp) return 'n/a';
        let ms = timestamp;
        if (ms < 10000000000) ms = ms * 1000;
        return new Date(ms).toLocaleString();
    }

    private getHumanTime(timestamp: number | null): string {
        if (!timestamp) return 'n/a';
        let ms = timestamp;
        if (ms < 10000000000) ms = ms * 1000;

        const delta = Math.floor((Date.now() - ms) / 1000);
        if (delta < 60) return `${delta}s ago`;
        const minutes = Math.floor(delta / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }
}
