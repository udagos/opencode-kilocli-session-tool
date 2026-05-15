import * as vscode from 'vscode';
import * as path from 'path';
import { OsmService, ISession } from './osmService';

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionNode | undefined | void> = new vscode.EventEmitter<SessionNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionNode | undefined | void> = this._onDidChangeTreeData.event;

    private service: OsmService;
    private sessions: ISession[] = [];

    constructor(service: OsmService) {
        this.service = service;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SessionNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SessionNode): Promise<SessionNode[]> {
        if (!element) {
            // Root level: fetch sessions and group by directory
            this.sessions = await this.service.fetchSessions();

            if (this.sessions.length === 0) {
                return [];
            }

            // Group by directory
            const projectsMap = new Map<string, ISession[]>();
            for (const session of this.sessions) {
                const dir = session.directory || '(No Directory)';
                if (!projectsMap.has(dir)) {
                    projectsMap.set(dir, []);
                }
                projectsMap.get(dir)!.push(session);
            }

            // Create Project nodes
            const projectNodes: ProjectNode[] = [];
            for (const [dir, projectSessions] of projectsMap.entries()) {
                const folderName = dir === '(No Directory)' ? dir : path.basename(dir);
                projectNodes.push(new ProjectNode(folderName, dir, projectSessions));
            }

            // Sort projects alphabetically
            projectNodes.sort((a, b) => a.label.localeCompare(b.label));

            return projectNodes;
        } else if (element instanceof ProjectNode) {
            // Child level: return sessions for this project
            const sessionNodes = element.sessions.map(s => new SessionItemNode(s));
            // Sort sessions by updated_at descending
            sessionNodes.sort((a, b) => {
                const timeA = a.session.updated_at || 0;
                const timeB = b.session.updated_at || 0;
                return timeB - timeA;
            });
            return sessionNodes;
        }

        return [];
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

export class ProjectNode extends SessionNode {
    constructor(
        public readonly label: string,
        public readonly fullPath: string,
        public readonly sessions: ISession[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = this.fullPath;
        this.description = this.fullPath;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'project';
    }
}

export class SessionItemNode extends SessionNode {
    constructor(
        public readonly session: ISession
    ) {
        super(session.display_title, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `ID: ${session.sid}\nLast updated: ${this.formatTime(session.updated_at)}`;
        this.description = this.getHumanTime(session.updated_at);
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.contextValue = 'session';
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
