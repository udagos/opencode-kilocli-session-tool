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
exports.SessionItemNode = exports.ProjectNode = exports.SessionNode = exports.SessionTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const osmService_1 = require("./osmService");
class SessionTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    service;
    sessions = [];
    constructor(service) {
        this.service = service;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            // Root level: fetch sessions and group by directory
            this.sessions = await this.service.fetchSessions();
            if (this.sessions.length === 0) {
                return [];
            }
            // Group by directory
            const projectsMap = new Map();
            for (const session of this.sessions) {
                const dir = session.directory || '(No Directory)';
                if (!projectsMap.has(dir)) {
                    projectsMap.set(dir, []);
                }
                projectsMap.get(dir).push(session);
            }
            // Create Project nodes
            const projectNodes = [];
            for (const [dir, projectSessions] of projectsMap.entries()) {
                const folderName = dir === '(No Directory)' ? dir : path.basename(dir);
                projectNodes.push(new ProjectNode(folderName, dir, projectSessions));
            }
            // Sort projects alphabetically
            projectNodes.sort((a, b) => a.label.localeCompare(b.label));
            return projectNodes;
        }
        else if (element instanceof ProjectNode) {
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
class ProjectNode extends SessionNode {
    label;
    fullPath;
    sessions;
    constructor(label, fullPath, sessions) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.label = label;
        this.fullPath = fullPath;
        this.sessions = sessions;
        this.tooltip = this.fullPath;
        this.description = this.fullPath;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'project';
    }
}
exports.ProjectNode = ProjectNode;
class SessionItemNode extends SessionNode {
    session;
    constructor(session) {
        super(session.display_title, vscode.TreeItemCollapsibleState.None);
        this.session = session;
        this.tooltip = `ID: ${session.sid}\nLast updated: ${this.formatTime(session.updated_at)}`;
        this.description = this.getHumanTime(session.updated_at);
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.contextValue = 'session';
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