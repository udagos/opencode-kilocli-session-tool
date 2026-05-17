import * as vscode from 'vscode';
import { OsmService } from './osmService';

export class SessionContentProvider implements vscode.TextDocumentContentProvider {
    constructor(private service: OsmService) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // The URI looks like: osm-session:<sid>.md
        // So uri.path will be "<sid>.md"
        const sid = uri.path.replace(/\.md$/, '');

        const messages = await this.service.fetchSessionContent(sid);

        if (!messages || messages.length === 0) {
            return '# Session Content\n\nNo messages found for this session.';
        }

        let markdown = `# Session Content\n\n`;

        for (const msg of messages) {
            const role = msg.role ? msg.role.toUpperCase() : 'UNKNOWN';

            let content = '';
            if (msg.content) {
                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    // Handle array of content blocks (e.g. Anthropic multi-modal format)
                    content = msg.content.map((block: any) => {
                        if (block.type === 'text') return block.text;
                        return JSON.stringify(block, null, 2);
                    }).join('\n\n');
                } else {
                    content = JSON.stringify(msg.content, null, 2);
                }
            } else if (msg.tool_calls) {
                 content = `*Tool Calls:*\n\`\`\`json\n${JSON.stringify(msg.tool_calls, null, 2)}\n\`\`\``;
            } else if (msg.data) {
                 // Fallback for raw internal DB structures
                 content = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data, null, 2);
            } else {
                 content = JSON.stringify(msg, null, 2);
            }

            markdown += `### ${role}\n\n${content}\n\n---\n\n`;
        }

        return markdown;
    }
}
