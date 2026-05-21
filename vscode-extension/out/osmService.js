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
exports.OsmService = void 0;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class OsmService {
    constructor() { }
    getBaseCommand(backend) {
        const config = vscode.workspace.getConfiguration('osm');
        const pythonPath = config.get('pythonPath') || 'python';
        const scriptPath = config.get('scriptPath') || 'osm';
        if (scriptPath.endsWith('.py')) {
            // Check if pythonPath is already a composite command like "uv run python"
            if (pythonPath.includes(' ')) {
                return `${pythonPath} "${scriptPath}" ${backend}`;
            }
            return `"${pythonPath}" "${scriptPath}" ${backend}`;
        }
        return `"${scriptPath}" ${backend}`;
    }
    async executeBackend(args) {
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get('backend') || 'opencode';
        const baseCmd = this.getBaseCommand(backend);
        const command = `${baseCmd} ${args}`;
        try {
            const { stdout, stderr } = await execAsync(command);
            if (stderr) {
                console.warn('osm command stderr:', stderr);
            }
            if (!stdout || stdout.trim() === '') {
                return null;
            }
            return JSON.parse(stdout.trim());
        }
        catch (error) {
            // Check if stdout has JSON despite error
            if (error.stdout && error.stdout.trim().startsWith('[')) {
                try {
                    return JSON.parse(error.stdout.trim());
                }
                catch (e) { }
            }
            if (error.message && error.message.includes('No sessions DB found')) {
                vscode.window.showInformationMessage(`No sessions found for backend '${backend}'. Make sure you have used the tool at least once.`);
                return null;
            }
            throw error;
        }
    }
    async fetchSessions(searchQuery, sortBy = 'time_updated', sortOrder = 'DESC') {
        let args = `--json --sort-by ${sortBy} --sort-order ${sortOrder}`;
        if (searchQuery) {
            // safely quote the search query
            const safeQuery = searchQuery.replace(/"/g, '\\"');
            args += ` --search "${safeQuery}"`;
        }
        try {
            const sessions = await this.executeBackend(args);
            return sessions || [];
        }
        catch (error) {
            console.error('Failed to fetch osm sessions:', error);
            vscode.window.showErrorMessage(`Failed to fetch sessions. Ensure osm is installed or scriptPath is correct. Error: ${error.message}`);
            return [];
        }
    }
    async fetchSessionContent(sid) {
        try {
            const messages = await this.executeBackend(`--view "${sid}"`);
            return messages || [];
        }
        catch (error) {
            console.error('Failed to fetch session content:', error);
            vscode.window.showErrorMessage(`Failed to fetch session content. Error: ${error.message}`);
            return [];
        }
    }
    async deleteSession(sid) {
        try {
            const result = await this.executeBackend(`--json --delete "${sid}"`);
            if (result && result.status === 'error') {
                vscode.window.showErrorMessage(`Error deleting session: ${result.message}`);
            }
        }
        catch (error) {
            console.error('Failed to delete session:', error);
            vscode.window.showErrorMessage(`Failed to delete session. Error: ${error.message}`);
        }
    }
    async pinSession(sid, pin, type = 'session') {
        const flag = pin ? '--pin' : '--unpin';
        try {
            await this.executeBackend(`--json ${flag} "${sid}" --type ${type}`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to pin/unpin. Error: ${error.message}`);
        }
    }
    async setNote(sid, note, type = 'session') {
        const safeNote = note.replace(/"/g, '\\"');
        try {
            await this.executeBackend(`--json --set-note "${sid}" "${safeNote}" --type ${type}`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to set note. Error: ${error.message}`);
        }
    }
    async addLabel(sid, label, type = 'session') {
        const safeLabel = label.replace(/"/g, '\\"');
        try {
            await this.executeBackend(`--json --add-label "${sid}" "${safeLabel}" --type ${type}`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to add label. Error: ${error.message}`);
        }
    }
    async removeLabel(sid, label, type = 'session') {
        const safeLabel = label.replace(/"/g, '\\"');
        try {
            await this.executeBackend(`--json --remove-label "${sid}" "${safeLabel}" --type ${type}`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to remove label. Error: ${error.message}`);
        }
    }
}
exports.OsmService = OsmService;
//# sourceMappingURL=osmService.js.map