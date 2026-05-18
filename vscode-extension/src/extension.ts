import * as vscode from 'vscode';
import { OsmService } from './osmService';
import { SessionTreeProvider, SessionItemNode } from './sessionTreeProvider';
import { SessionContentProvider } from './sessionContentProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('osm-vscode is now active!');

    const osmService = new OsmService();
    const sessionTreeProvider = new SessionTreeProvider(osmService);
    const sessionContentProvider = new SessionContentProvider(osmService);

    // Register Providers
    vscode.window.registerTreeDataProvider('osm.sessionsView', sessionTreeProvider);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('osm-session', sessionContentProvider)
    );

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
    const resumeCommand = vscode.commands.registerCommand('osm.resumeSession', (node: SessionItemNode) => {
        if (!node || !node.session) {
            vscode.window.showErrorMessage('No session selected to resume.');
            return;
        }

        const session = node.session;
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get<string>('backend') || 'opencode';

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
    const viewContentCommand = vscode.commands.registerCommand('osm.viewSessionContent', async (node: SessionItemNode) => {
        if (!node || !node.session) return;
        const uri = vscode.Uri.parse(`osm-session:${node.session.sid}.md`);
        const doc = await vscode.workspace.openTextDocument(uri);
        vscode.languages.setTextDocumentLanguage(doc, 'markdown');
        vscode.window.showTextDocument(doc, { preview: true });
    });

    // Command: Delete Session
    const deleteCommand = vscode.commands.registerCommand('osm.deleteSession', async (node: SessionItemNode) => {
        if (!node || !node.session) return;
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete session "${node.session.display_title}"?`,
            { modal: true },
            'Yes'
        );
        if (confirm === 'Yes') {
            await osmService.deleteSession(node.session.sid);
            sessionTreeProvider.refresh();
        }
    });

    // Command: Toggle Pin
    const pinCommand = vscode.commands.registerCommand('osm.togglePin', async (node: any) => {
        if (!node) return;

        let targetId = '';
        let targetType = 'session';
        let willPin = false;

        if (node.session) {
            targetId = node.session.sid;
            willPin = !node.session.is_pinned;
        } else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
            willPin = !node.folderMeta.is_pinned;
        } else {
            return;
        }

        await osmService.pinSession(targetId, willPin, targetType);
        sessionTreeProvider.refresh();
    });

    // Command: Add/Edit Note
    const setNoteCommand = vscode.commands.registerCommand('osm.setNote', async (node: any) => {
        if (!node) return;

        let targetId = '';
        let targetType = 'session';
        let currentNote = '';

        if (node.session) {
            targetId = node.session.sid;
            currentNote = node.session.note || '';
        } else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
            currentNote = node.folderMeta.note || '';
        } else {
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
    const addLabelCommand = vscode.commands.registerCommand('osm.addLabel', async (node: any) => {
        if (!node) return;

        let targetId = '';
        let targetType = 'session';

        if (node.session) {
            targetId = node.session.sid;
        } else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
        } else {
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
    const removeLabelCommand = vscode.commands.registerCommand('osm.removeLabel', async (node: any) => {
        if (!node) return;

        let targetId = '';
        let targetType = 'session';
        let labels: string[] = [];

        if (node.session) {
            targetId = node.session.sid;
            labels = node.session.labels || [];
        } else if (node.folderMeta) {
            targetId = node.folderMeta.workspace_id || node.folderMeta.directory;
            targetType = 'workspace';
            labels = node.folderMeta.labels || [];
        } else {
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

    context.subscriptions.push(
        refreshCommand,
        searchCommand,
        clearSearchCommand,
        setSortCommand,
        resumeCommand,
        viewContentCommand,
        deleteCommand,
        pinCommand,
        setNoteCommand,
        addLabelCommand,
        removeLabelCommand
    );
}

export function deactivate() {}
