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

            this.sessions = await this.service.fetchSessions(this.searchQuery, sortBy, sortOrder);

            if (this.sessions.length === 0) {
                return [];
            }

            if (this.searchQuery) {
                // Flat list for search results
                return this.sessions.map(s => new SessionItemNode(s));
            }

            // Top-Level Nodes
            const topNodes: SessionNode[] = [];

            const pinnedSessions = this.sessions.filter(s => s.is_pinned);
            if (pinnedSessions.length > 0) {
                topNodes.push(new TopLevelCategoryNode('📌 Pinned', pinnedSessions));
            }

            const labeledSessionsMap = new Map<string, ISession[]>();
            for (const session of this.sessions) {
                if (session.labels && session.labels.length > 0) {
                    for (const label of session.labels) {
                        if (label.trim() === '') continue;
                        if (!labeledSessionsMap.has(label)) {
                            labeledSessionsMap.set(label, []);
                        }
                        labeledSessionsMap.get(label)!.push(session);
                    }
                }
            }

            if (labeledSessionsMap.size > 0) {
                const labelNodes: SessionNode[] = [];
                for (const [label, sessions] of labeledSessionsMap.entries()) {
                    labelNodes.push(new TopLevelCategoryNode(`🏷️ ${label}`, sessions));
                }
                labelNodes.sort((a, b) => a.label.localeCompare(b.label));
                topNodes.push(new FolderNode('🏷️ By Label', labelNodes));
            }

            topNodes.push(new FolderNode('📁 All Projects', this.getProjectNodes(this.sessions)));

            return topNodes;
        } else if (element instanceof FolderNode) {
            return element.children;
        } else if (element instanceof TopLevelCategoryNode) {
            return element.sessions.map(s => new SessionItemNode(s));
        }

        return [];
    }

    private getProjectNodes(sessions: ISession[]): SessionNode[] {
        const projectsMap = new Map<string, ISession[]>();
        for (const session of sessions) {
            const dir = session.directory || '(No Directory)';
            if (!projectsMap.has(dir)) {
                projectsMap.set(dir, []);
            }
            projectsMap.get(dir)!.push(session);
        }

        const projectNodes: TopLevelCategoryNode[] = [];
        for (const [dir, projectSessions] of projectsMap.entries()) {
            const folderName = dir === '(No Directory)' ? dir : path.basename(dir);
            const node = new TopLevelCategoryNode(folderName, projectSessions);
            node.description = dir;
            node.tooltip = dir;
            node.iconPath = new vscode.ThemeIcon('folder');
            projectNodes.push(node);
        }

        projectNodes.sort((a, b) => a.label.localeCompare(b.label));
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

export class TopLevelCategoryNode extends SessionNode {
    constructor(
        public readonly label: string,
        public readonly sessions: ISession[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'category';
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
