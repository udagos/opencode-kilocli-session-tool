import { exec } from 'child_process';
import * as vscode from 'vscode';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ISession {
    sid: string;
    title: string;
    display_title: string;
    directory: string;
    created_at: number | null;
    updated_at: number | null;
    is_pinned: boolean;
    note: string | null;
    labels: string[];
}

export class OsmService {
    constructor() {}

    private getBaseCommand(backend: string): string {
        const config = vscode.workspace.getConfiguration('osm');
        const pythonPath = config.get<string>('pythonPath') || 'python';
        const scriptPath = config.get<string>('scriptPath') || 'osm';

        if (scriptPath.endsWith('.py')) {
            return `"${pythonPath}" "${scriptPath}" ${backend}`;
        }
        return `"${scriptPath}" ${backend}`;
    }

    private async executeBackend(args: string): Promise<any> {
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get<string>('backend') || 'opencode';
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
        } catch (error: any) {
            // Check if stdout has JSON despite error
            if (error.stdout && error.stdout.trim().startsWith('[')) {
                try {
                    return JSON.parse(error.stdout.trim());
                } catch (e) {}
            }

            if (error.message && error.message.includes('No sessions DB found')) {
                vscode.window.showInformationMessage(`No sessions found for backend '${backend}'. Make sure you have used the tool at least once.`);
                return null;
            }
            throw error;
        }
    }

    public async fetchSessions(searchQuery?: string, sortBy: string = 'time_updated', sortOrder: string = 'DESC'): Promise<ISession[]> {
        let args = `--json --sort-by ${sortBy} --sort-order ${sortOrder}`;
        if (searchQuery) {
            // safely quote the search query
            const safeQuery = searchQuery.replace(/"/g, '\\"');
            args += ` --search "${safeQuery}"`;
        }

        try {
            const sessions = await this.executeBackend(args);
            return sessions || [];
        } catch (error: any) {
            console.error('Failed to fetch osm sessions:', error);
            vscode.window.showErrorMessage(`Failed to fetch sessions. Ensure osm is installed or scriptPath is correct. Error: ${error.message}`);
            return [];
        }
    }

    public async fetchSessionContent(sid: string): Promise<any[]> {
        try {
            const messages = await this.executeBackend(`--view "${sid}"`);
            return messages || [];
        } catch (error: any) {
            console.error('Failed to fetch session content:', error);
            vscode.window.showErrorMessage(`Failed to fetch session content. Error: ${error.message}`);
            return [];
        }
    }

    public async deleteSession(sid: string): Promise<void> {
        try {
            const result = await this.executeBackend(`--json --delete "${sid}"`);
            if (result && result.status === 'error') {
                vscode.window.showErrorMessage(`Error deleting session: ${result.message}`);
            }
        } catch (error: any) {
            console.error('Failed to delete session:', error);
            vscode.window.showErrorMessage(`Failed to delete session. Error: ${error.message}`);
        }
    }

    public async pinSession(sid: string, pin: boolean, type: string = 'session'): Promise<void> {
        const flag = pin ? '--pin' : '--unpin';
        try {
            await this.executeBackend(`--json ${flag} "${sid}" --type ${type}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to pin/unpin. Error: ${error.message}`);
        }
    }

    public async setNote(sid: string, note: string, type: string = 'session'): Promise<void> {
        const safeNote = note.replace(/"/g, '\\"');
        try {
            await this.executeBackend(`--json --set-note "${sid}" "${safeNote}" --type ${type}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to set note. Error: ${error.message}`);
        }
    }

    public async addLabel(sid: string, label: string, type: string = 'session'): Promise<void> {
        const safeLabel = label.replace(/"/g, '\\"');
        try {
            await this.executeBackend(`--json --add-label "${sid}" "${safeLabel}" --type ${type}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to add label. Error: ${error.message}`);
        }
    }

    public async removeLabel(sid: string, label: string, type: string = 'session'): Promise<void> {
        const safeLabel = label.replace(/"/g, '\\"');
        try {
            await this.executeBackend(`--json --remove-label "${sid}" "${safeLabel}" --type ${type}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to remove label. Error: ${error.message}`);
        }
    }
}
