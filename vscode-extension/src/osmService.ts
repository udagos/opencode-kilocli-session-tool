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
}

export class OsmService {
    constructor() {}

    /**
     * Fetch sessions from the configured osm backend
     */
    public async fetchSessions(): Promise<ISession[]> {
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get<string>('backend') || 'opencode';
        const pythonPath = config.get<string>('pythonPath') || 'python';
        const scriptPath = config.get<string>('scriptPath') || 'osm';

        let command = '';
        if (scriptPath.endsWith('.py')) {
            command = `"${pythonPath}" "${scriptPath}" ${backend} --json`;
        } else {
            command = `"${scriptPath}" ${backend} --json`;
        }

        try {
            // execAsync throws if the command exits with non-zero status
            // which osm.py does (returns 2) when the DB doesn't exist.
            const { stdout, stderr } = await execAsync(command);

            if (stderr) {
                console.warn('osm command stderr:', stderr);
            }

            if (!stdout || stdout.trim() === '') {
                return [];
            }

            const sessions: ISession[] = JSON.parse(stdout.trim());
            return sessions;
        } catch (error: any) {
            // Check if the script still output some JSON in stdout despite the error
            if (error.stdout && error.stdout.trim().startsWith('[')) {
                try {
                    return JSON.parse(error.stdout.trim());
                } catch (e) {
                    // Ignore parse error here, fallback to showing the main error
                }
            }

            console.error('Failed to fetch osm sessions:', error);

            // Provide a more helpful error message specifically for missing DBs
            if (error.message && error.message.includes('No sessions DB found')) {
                vscode.window.showInformationMessage(`No sessions found for backend '${backend}'. Make sure you have used the tool at least once.`);
                return [];
            }

            vscode.window.showErrorMessage(`Failed to fetch sessions. Ensure osm is installed or scriptPath is correct. Error: ${error.message}`);
            return [];
        }
    }
}
