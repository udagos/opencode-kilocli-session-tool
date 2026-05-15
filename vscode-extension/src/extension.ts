import * as vscode from 'vscode';
import { OsmService } from './osmService';
import { SessionTreeProvider, SessionItemNode } from './sessionTreeProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('osm-vscode is now active!');

    const osmService = new OsmService();
    const sessionTreeProvider = new SessionTreeProvider(osmService);

    // Register the TreeView
    vscode.window.registerTreeDataProvider('osm.sessionsView', sessionTreeProvider);

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('osm.refresh', () => {
        sessionTreeProvider.refresh();
    });

    // Register resume session command
    const resumeCommand = vscode.commands.registerCommand('osm.resumeSession', (node: SessionItemNode) => {
        if (!node || !node.session) {
            vscode.window.showErrorMessage('No session selected to resume.');
            return;
        }

        const session = node.session;
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get<string>('backend') || 'opencode';

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

export function deactivate() {}
