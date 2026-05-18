"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionItemNode = exports.ProjectNode = exports.FolderNode = exports.SessionNode = exports.SessionTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
class SessionTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    service;
    sessions = [];
    searchQuery;
    constructor(service) {
        this.service = service;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    setSearchQuery(query) {
        this.searchQuery = query;
        this.refresh();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            // Root level: fetch sessions
            const config = vscode.workspace.getConfiguration('osm');
            const sortBy = config.get('sortBy') || 'time_updated';
            const sortOrder = config.get('sortOrder') || 'DESC';
            const data = await this.service.fetchSessions(this.searchQuery, sortBy, sortOrder);
            // Check if the old structure is returned (array of sessions) or new structure (object with sessions and folders)
            let sessionsData = [];
            let foldersData = [];
            if (Array.isArray(data)) {
                sessionsData = data;
            }
            else if (data && typeof data === 'object') {
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
            const topNodes = [];
            // Pinned Section
            const pinnedSessions = this.sessions.filter(s => s.is_pinned);
            const pinnedFolders = foldersData.filter(f => f.is_pinned);
            if (pinnedSessions.length > 0 || pinnedFolders.length > 0) {
                const pinnedNodes = [];
                if (pinnedFolders.length > 0) {
                    pinnedNodes.push(new FolderNode('📁 Projects', pinnedFolders.map(f => this.createProjectNode(f, this.sessions))));
                }
                if (pinnedSessions.length > 0) {
                    pinnedNodes.push(new FolderNode('💬 Sessions', pinnedSessions.map(s => new SessionItemNode(s))));
                }
                topNodes.push(new FolderNode('📌 Pinned', pinnedNodes));
            }
            // Labels Section
            const allLabels = new Set();
            for (const s of this.sessions) {
                if (s.labels)
                    s.labels.forEach(l => { if (l.trim())
                        allLabels.add(l.trim()); });
            }
            for (const f of foldersData) {
                if (f.labels)
                    f.labels.forEach((l) => { if (l.trim())
                        allLabels.add(l.trim()); });
            }
            if (allLabels.size > 0) {
                const labelNodes = [];
                const sortedLabels = Array.from(allLabels).sort();
                for (const label of sortedLabels) {
                    const sessionsWithLabel = this.sessions.filter(s => s.labels && s.labels.includes(label));
                    const foldersWithLabel = foldersData.filter(f => f.labels && f.labels.includes(label));
                    const labelSubNodes = [];
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
        }
        else if (element instanceof FolderNode || element instanceof ProjectNode) {
            return element.children;
        }
        return [];
    }
    createProjectNode(folderMeta, allSessions) {
        const id = folderMeta.workspace_id || folderMeta.directory;
        const projectSessions = allSessions.filter(s => (s.workspace_id || s.directory) === id);
        const folderName = folderMeta.directory === '(No Directory)' || !folderMeta.directory ? '(No Directory)' : path.basename(folderMeta.directory);
        return new ProjectNode(folderName, projectSessions.map(s => new SessionItemNode(s)), folderMeta);
    }
    getProjectNodes(sessions, foldersData) {
        const projectsMap = new Map();
        for (const session of sessions) {
            const key = session.workspace_id || session.directory || '(No Directory)';
            if (!projectsMap.has(key)) {
                projectsMap.set(key, []);
            }
            projectsMap.get(key).push(session);
        }
        const projectNodes = [];
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
        const sortBy = config.get('sortBy') || 'time_updated';
        const sortOrder = config.get('sortOrder') || 'DESC';
        projectNodes.sort((a, b) => {
            let valA = 0;
            let valB = 0;
            if (sortBy === 'title') {
                valA = a.label;
                valB = b.label;
                if (sortOrder === 'ASC') {
                    return valA.localeCompare(valB);
                }
                else {
                    return valB.localeCompare(valA);
                }
            }
            else if (sortBy === 'time_updated') {
                // Get max updated time from sessions inside this folder
                valA = Math.max(...a.children.map((c) => c.session?.updated_at || 0));
                valB = Math.max(...b.children.map((c) => c.session?.updated_at || 0));
            }
            else if (sortBy === 'time_created') {
                // Get min created time from sessions inside this folder
                valA = Math.max(...a.children.map((c) => c.session?.created_at || 0));
                valB = Math.max(...b.children.map((c) => c.session?.created_at || 0));
            }
            if (sortOrder === 'ASC') {
                return valA > valB ? 1 : -1;
            }
            else {
                return valA < valB ? 1 : -1;
            }
        });
        return projectNodes;
    }
}
exports.SessionTreeProvider = SessionTreeProvider;
class SessionNode extends vscode.TreeItem {
    label;
    collapsibleState;
    constructor(label, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}
exports.SessionNode = SessionNode;
class FolderNode extends SessionNode {
    label;
    children;
    constructor(label, children) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.label = label;
        this.children = children;
        this.contextValue = 'folder';
    }
}
exports.FolderNode = FolderNode;
class ProjectNode extends SessionNode {
    label;
    children;
    folderMeta;
    constructor(label, children, folderMeta) {
        super(folderMeta.is_pinned ? `📌 ${label}` : label, vscode.TreeItemCollapsibleState.Collapsed);
        this.label = label;
        this.children = children;
        this.folderMeta = folderMeta;
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
exports.ProjectNode = ProjectNode;
class SessionItemNode extends SessionNode {
    session;
    constructor(session) {
        super(session.is_pinned ? `📌 ${session.display_title}` : session.display_title, vscode.TreeItemCollapsibleState.None);
        this.session = session;
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
    formatTime(timestamp) {
        if (!timestamp)
            return 'n/a';
        let ms = timestamp;
        if (ms < 10000000000)
            ms = ms * 1000;
        return new Date(ms).toLocaleString();
    }
    getHumanTime(timestamp) {
        if (!timestamp)
            return 'n/a';
        let ms = timestamp;
        if (ms < 10000000000)
            ms = ms * 1000;
        const delta = Math.floor((Date.now() - ms) / 1000);
        if (delta < 60)
            return `${delta}s ago`;
        const minutes = Math.floor(delta / 60);
        if (minutes < 60)
            return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24)
            return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }
}
exports.SessionItemNode = SessionItemNode;
//# sourceMappingURL=sessionTreeProvider.js.map