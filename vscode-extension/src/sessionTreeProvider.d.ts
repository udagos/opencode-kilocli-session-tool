import * as vscode from 'vscode';
import { OsmService, ISession } from './osmService';
export declare class SessionTreeProvider implements vscode.TreeDataProvider<SessionNode> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<SessionNode | undefined | void>;
    private service;
    private sessions;
    constructor(service: OsmService);
    refresh(): void;
    getTreeItem(element: SessionNode): vscode.TreeItem;
    getChildren(element?: SessionNode): Promise<SessionNode[]>;
}
export declare abstract class SessionNode extends vscode.TreeItem {
    readonly label: string;
    readonly collapsibleState: vscode.TreeItemCollapsibleState;
    constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState);
}
export declare class ProjectNode extends SessionNode {
    readonly label: string;
    readonly fullPath: string;
    readonly sessions: ISession[];
    constructor(label: string, fullPath: string, sessions: ISession[]);
}
export declare class SessionItemNode extends SessionNode {
    readonly session: ISession;
    constructor(session: ISession);
    private formatTime;
    private getHumanTime;
}
//# sourceMappingURL=sessionTreeProvider.d.ts.map