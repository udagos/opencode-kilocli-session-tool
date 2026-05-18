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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const osmService_1 = require("./osmService");
const sessionTreeProvider_1 = require("./sessionTreeProvider");
const sessionContentProvider_1 = require("./sessionContentProvider");
function activate(context) {
    console.log('osm-vscode is now active!');
    const osmService = new osmService_1.OsmService();
    const sessionTreeProvider = new sessionTreeProvider_1.SessionTreeProvider(osmService);
    const sessionContentProvider = new sessionContentProvider_1.SessionContentProvider(osmService);
    // Register Providers
    vscode.window.registerTreeDataProvider('osm.sessionsView', sessionTreeProvider);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('osm-session', sessionContentProvider));
    // Command: Refresh
    const refreshCommand = vscode.commands.registerCommand('osm.refresh', () => {
        sessionTreeProvider.refresh();
    });
    // Command: Search
    const searchCommand = vscode.commands.registerCommand('osm.searchSessions', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Search sessions by title or content',
            placeHolder: 'Enter search term...'
        });
        if (query !== undefined) {
            sessionTreeProvider.setSearchQuery(query);
            vscode.commands.executeCommand('setContext', 'osm.searchActive', !!query);
        }
    });
    // Command: Clear Search
    const clearSearchCommand = vscode.commands.registerCommand('osm.clearSearch', () => {
        sessionTreeProvider.setSearchQuery(undefined);
        vscode.commands.executeCommand('setContext', 'osm.searchActive', false);
    });
    // Command: Set Sort
    const setSortCommand = vscode.commands.registerCommand('osm.setSort', async () => {
        const sortOptions = [
            { label: 'Recently Updated', description: 'time_updated DESC' },
            { label: 'Recently Created', description: 'time_created DESC' },
            { label: 'Oldest Updated', description: 'time_updated ASC' },
            { label: 'Title (A-Z)', description: 'title ASC' }
        ];
        const selected = await vscode.window.showQuickPick(sortOptions, {
            placeHolder: 'Select sorting method'
        });
        if (selected) {
            const [sortBy, sortOrder] = selected.description.split(' ');
            const config = vscode.workspace.getConfiguration('osm');
            await config.update('sortBy', sortBy, vscode.ConfigurationTarget.Global);
            await config.update('sortOrder', sortOrder, vscode.ConfigurationTarget.Global);
            sessionTreeProvider.refresh();
        }
    });
    // Command: Resume Session
    const resumeCommand = vscode.commands.registerCommand('osm.resumeSession', (node) => {
        if (!node || !node.session) {
            vscode.window.showErrorMessage('No session selected to resume.');
            return;
        }
        const session = node.session;
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get('backend') || 'opencode';
        const terminal = vscode.window.createTerminal(`OSM: ${session.display_title}`);
        terminal.show();
        if (session.directory && session.directory !== '(No Directory)') {
            terminal.sendText(`cd "${session.directory}"`);
        }
        const resumeCmd = backend === 'kilo'
            ? `kilo resume ${session.sid}`
            : `opencode -s ${session.sid}`;
        terminal.sendText(resumeCmd);
    });
    // Command: View Content
    const viewContentCommand = vscode.commands.registerCommand('osm.viewSessionContent', async (node) => {
        if (!node || !node.session)
            return;
        const uri = vscode.Uri.parse(`osm-session:${node.session.sid}.md`);
        const doc = await vscode.workspace.openTextDocument(uri);
        vscode.languages.setTextDocumentLanguage(doc, 'markdown');
        vscode.window.showTextDocument(doc, { preview: true });
    });
    // Command: Delete Session
    const deleteCommand = vscode.commands.registerCommand('osm.deleteSession', async (node) => {
        if (!node || !node.session)
            return;
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete session "${node.session.display_title}"?`, { modal: true }, 'Yes');
        if (confirm === 'Yes') {
            await osmService.deleteSession(node.session.sid);
            sessionTreeProvider.refresh();
        }
    });
    // Command: Toggle Pin
    const pinCommand = vscode.commands.registerCommand('osm.togglePin', async (node) => {
        if (!node)
            return;
        let targetId = '';
        let targetType = 'session';
        let willPin = false;
        if (node.session) {
            targetId = node.session.sid;
            willPin = !node.session.is_pinned;
        }
        else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
            willPin = !node.folderMeta.is_pinned;
        }
        else {
            return;
        }
        await osmService.pinSession(targetId, willPin, targetType);
        sessionTreeProvider.refresh();
    });
    // Command: Add/Edit Note
    const setNoteCommand = vscode.commands.registerCommand('osm.setNote', async (node) => {
        if (!node)
            return;
        let targetId = '';
        let targetType = 'session';
        let currentNote = '';
        if (node.session) {
            targetId = node.session.sid;
            currentNote = node.session.note || '';
        }
        else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
            currentNote = node.folderMeta.note || '';
        }
        else {
            return;
        }
        const note = await vscode.window.showInputBox({
            prompt: 'Enter a note (leave empty to remove)',
            value: currentNote
        });
        if (note !== undefined) {
            await osmService.setNote(targetId, note, targetType);
            sessionTreeProvider.refresh();
        }
    });
    // Command: Add Label
    const addLabelCommand = vscode.commands.registerCommand('osm.addLabel', async (node) => {
        if (!node)
            return;
        let targetId = '';
        let targetType = 'session';
        if (node.session) {
            targetId = node.session.sid;
        }
        else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
        }
        else {
            return;
        }
        const label = await vscode.window.showInputBox({
            prompt: 'Enter a new label'
        });
        if (label && label.trim().length > 0) {
            await osmService.addLabel(targetId, label.trim(), targetType);
            sessionTreeProvider.refresh();
        }
    });
    // Command: Remove Label
    const removeLabelCommand = vscode.commands.registerCommand('osm.removeLabel', async (node) => {
        if (!node)
            return;
        let targetId = '';
        let targetType = 'session';
        let labels = [];
        if (node.session) {
            targetId = node.session.sid;
            labels = node.session.labels || [];
        }
        else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
            labels = node.folderMeta.labels || [];
        }
        else {
            return;
        }
        if (labels.length === 0) {
            vscode.window.showInformationMessage('No labels to remove.');
            return;
        }
        const label = await vscode.window.showQuickPick(labels, {
            placeHolder: 'Select a label to remove'
        });
        if (label) {
            await osmService.removeLabel(targetId, label, targetType);
            sessionTreeProvider.refresh();
        }
    });
    context.subscriptions.push(refreshCommand, searchCommand, clearSearchCommand, setSortCommand, resumeCommand, viewContentCommand, deleteCommand, pinCommand, setNoteCommand, addLabelCommand, removeLabelCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map