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
function activate(context) {
    console.log('osm-vscode is now active!');
    const osmService = new osmService_1.OsmService();
    const sessionTreeProvider = new sessionTreeProvider_1.SessionTreeProvider(osmService);
    // Register the TreeView
    vscode.window.registerTreeDataProvider('osm.sessionsView', sessionTreeProvider);
    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('osm.refresh', () => {
        sessionTreeProvider.refresh();
    });
    // Register resume session command
    const resumeCommand = vscode.commands.registerCommand('osm.resumeSession', (node) => {
        if (!node || !node.session) {
            vscode.window.showErrorMessage('No session selected to resume.');
            return;
        }
        const session = node.session;
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get('backend') || 'opencode';
        // Create a new terminal
        const terminal = vscode.window.createTerminal(`OSM: ${session.display_title}`);
        terminal.show();
        // Navigate to the directory if it exists
        if (session.directory && session.directory !== '(No Directory)') {
            terminal.sendText(`cd "${session.directory}"`);
        }
        // Execute the resume command
        const resumeCmd = backend === 'kilo'
            ? `kilo resume ${session.sid}`
            : `opencode -s ${session.sid}`;
        terminal.sendText(resumeCmd);
    });
    context.subscriptions.push(refreshCommand, resumeCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map