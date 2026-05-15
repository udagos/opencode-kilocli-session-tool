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
    /**
     * Fetch sessions from the configured osm backend
     */
    async fetchSessions() {
        const config = vscode.workspace.getConfiguration('osm');
        const backend = config.get('backend') || 'opencode';
        const pythonPath = config.get('pythonPath') || 'python';
        const scriptPath = config.get('scriptPath') || 'osm';
        // Check if the script path ends with .py
        // If it's a python script, run `python path/to/script.py <backend> --json`
        // If it's the global CLI tool `osm`, just run `osm <backend> --json`
        let command = '';
        if (scriptPath.endsWith('.py')) {
            command = `"${pythonPath}" "${scriptPath}" ${backend} --json`;
        }
        else {
            command = `"${scriptPath}" ${backend} --json`;
        }
        try {
            const { stdout, stderr } = await execAsync(command);
            if (stderr) {
                console.warn('osm command stderr:', stderr);
            }
            if (!stdout || stdout.trim() === '') {
                return [];
            }
            const sessions = JSON.parse(stdout.trim());
            return sessions;
        }
        catch (error) {
            console.error('Failed to fetch osm sessions:', error);
            vscode.window.showErrorMessage(`Failed to fetch sessions. Ensure osm is installed or scriptPath is correct. Error: ${error.message}`);
            return [];
        }
    }
}
exports.OsmService = OsmService;
//# sourceMappingURL=osmService.js.map