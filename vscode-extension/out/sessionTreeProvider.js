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
exports.SessionItemNode = exports.TopLevelCategoryNode = exports.FolderNode = exports.SessionNode = exports.SessionTreeProvider = void 0;
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
            this.sessions = await this.service.fetchSessions(this.searchQuery, sortBy, sortOrder);
            if (this.sessions.length === 0) {
                return [];
            }
            if (this.searchQuery) {
                // Flat list for search results
                return this.sessions.map(s => new SessionItemNode(s));
            }
            // Top-Level Nodes
            const topNodes = [];
            const pinnedSessions = this.sessions.filter(s => s.is_pinned);
            if (pinnedSessions.length > 0) {
                topNodes.push(new TopLevelCategoryNode('📌 Pinned', pinnedSessions));
            }
            const labeledSessionsMap = new Map();
            for (const session of this.sessions) {
                if (session.labels && session.labels.length > 0) {
                    for (const label of session.labels) {
                        if (label.trim() === '')
                            continue;
                        if (!labeledSessionsMap.has(label)) {
                            labeledSessionsMap.set(label, []);
                        }
                        labeledSessionsMap.get(label).push(session);
                    }
                }
            }
            if (labeledSessionsMap.size > 0) {
                const labelNodes = [];
                for (const [label, sessions] of labeledSessionsMap.entries()) {
                    labelNodes.push(new TopLevelCategoryNode(`🏷️ ${label}`, sessions));
                }
                labelNodes.sort((a, b) => a.label.localeCompare(b.label));
                topNodes.push(new FolderNode('🏷️ By Label', labelNodes));
            }
            topNodes.push(new FolderNode('📁 All Projects', this.getProjectNodes(this.sessions)));
            return topNodes;
        }
        else if (element instanceof FolderNode) {
            return element.children;
        }
        else if (element instanceof TopLevelCategoryNode) {
            return element.sessions.map(s => new SessionItemNode(s));
        }
        return [];
    }
    getProjectNodes(sessions) {
        const projectsMap = new Map();
        for (const session of sessions) {
            const dir = session.directory || '(No Directory)';
            if (!projectsMap.has(dir)) {
                projectsMap.set(dir, []);
            }
            projectsMap.get(dir).push(session);
        }
        const projectNodes = [];
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
class TopLevelCategoryNode extends SessionNode {
    label;
    sessions;
    constructor(label, sessions) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.label = label;
        this.sessions = sessions;
        this.contextValue = 'category';
    }
}
exports.TopLevelCategoryNode = TopLevelCategoryNode;
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