import * as vscode from "vscode";
import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const extensionPriority = ['.ts', '.tsx', '.d.ts', '.patch.ts'];
const pathCache = new Map<string, string | undefined>();

export interface Folder {
    name: string;
    files: string[];
}
type BarrelTreeData = TreeItem | undefined | void;

class TreeItem extends vscode.TreeItem {
    public readonly isBarrel: boolean = false;
    private readonly name: string;
    constructor(public readonly directory: string, isDirectory: boolean, isBarrel?: boolean) {
        super(directory, isDirectory || isBarrel ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        this.name = path.basename(this.directory);
        this.isBarrel = isBarrel ?? false;
        const icon = isBarrel ? 'output-view-icon' : isDirectory ? 'folder' : 'file';
        const labelName = isBarrel ? 'Barrel: ' + this.name : this.name;
        const id =  this.name + Math.random().toString(36).substring(2, 15);
        this.label = labelName;
        this.id = id;
        this.contextValue = isDirectory ? 'folder' : 'file';
        this.iconPath = new vscode.ThemeIcon(icon);
        this.accessibilityInformation = {
            label: `${isDirectory ? 'Folder' : 'File'}: ${this.directory}`,
            role: 'treeitem',
        };
        if (!isDirectory) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(directory)],
            };
        }
        this.description = !isDirectory ? `Exports: ${getNumberOfExports(directory)}; Imports: ${getNumberOfImports(directory)}` : '';
        this.collapsibleState = isDirectory || isBarrel ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
        this.resourceUri = vscode.Uri.file(this.directory);
        this.tooltip = path.basename(this.directory);
    }
}

export class BarrelViewProvider implements vscode.TreeDataProvider<TreeItem> {
    private readonly workspacePath: string | undefined;
    private readonly _onDidChangeTreeData: vscode.EventEmitter<BarrelTreeData> = new vscode.EventEmitter<BarrelTreeData>();
    readonly onDidChangeTreeData: vscode.Event<BarrelTreeData> = this._onDidChangeTreeData.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        const watcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx}");
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            return;
        }
        this.workspacePath = workspace.uri.fsPath;

        watcher.onDidChange(() => this.refresh());
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());

        context.subscriptions.push(watcher);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
        if (!this.context || !this.workspacePath) {
            return Promise.resolve([]);
        }
        // Add the workspace path to the cache if it doesn't exist
        if (!element) {
            const rootItem = new TreeItem(this.workspacePath, true, false);
            rootItem.label = path.basename(this.workspacePath);
            return Promise.resolve([rootItem]);
        }
        // If element is a barrel file, return its exports as children (non-expandable)
        if (element?.isBarrel) {
            const items: TreeItem[] = [];
            const sourceFile = ts.createSourceFile(
                element.directory,
                fs.readFileSync(element.directory, 'utf-8'),
                ts.ScriptTarget.Latest,
                true
            );
            ts.forEachChild(sourceFile, node => {
                if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
                    let exportPath = node.moduleSpecifier.getText().replace(/['"]/g, '');
                    if (!exportPath.endsWith('.ts') && !exportPath.endsWith('.tsx')) {
                        for (const ext of extensionPriority) {
                            if (fs.existsSync(path.join(path.dirname(element.directory), exportPath + ext))) {
                                exportPath += ext;
                                break;
                            }
                        }
                    }
                    const exportFilePath = path.resolve(path.dirname(element.directory), exportPath);
                    if (fs.existsSync(exportFilePath)) {
                        // Non-expandable child
                        items.push(new TreeItem(exportFilePath, false, false));
                    }
                }
            });
            return Promise.resolve(items);
        }
        // Otherwise, element is a directory (or root)
        const directory = element ? element.directory : this.workspacePath;
        let files: string[];
        try {
            files = fs.readdirSync(directory)
            .filter(file => {
                const filePath = path.join(directory, file);
                const hasIndex = fs.existsSync(path.join(filePath, 'index.ts')) && getNumberOfExports(path.join(filePath, 'index.ts')) > 0;
                return file !== 'node_modules' && !file.startsWith('.') && (fs.statSync(filePath).isFile() || hasIndex);
            });
        } catch {
            return Promise.resolve([]);
        }
        const items: TreeItem[] = [];
        for (const file of files) {
            const filePath = path.join(directory, file);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(filePath);
            } catch {
                continue;
            }
            if (stat.isDirectory()) {
                items.push(new TreeItem(filePath, true, false));
            }
        }
        // Only show barrel file and its exports
        const barrelPath = path.join(directory, 'index.ts');
        if (fs.existsSync(barrelPath) && checkBarrelFile(barrelPath)) {
            // Add the barrel file itself (expandable)
            items.push(new TreeItem(barrelPath, false, true));
        }
    
        items.sort((a, b) => (typeof a.label === 'string' && typeof b.label === 'string' ? a.label.localeCompare(b.label) : 0));
        console.log(items);
        return Promise.resolve(items);
    }
    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }
}


const checkBarrelFile = (filePath: string): boolean => {
    const sourceFile = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf-8'), ts.ScriptTarget.Latest, true);
    let isBarrelFile = false;
    ts.forEachChild(sourceFile, node => {
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            isBarrelFile = true;
        }
    });
    return isBarrelFile;
};

const getNumberOfExports = (filePath: string): number => {
    const sourceFile = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf-8'), ts.ScriptTarget.Latest, true);
    let exportCount = 0;
    ts.forEachChild(sourceFile, node => {
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            exportCount++;
        }
    });
    return exportCount;
}

const getNumberOfImports = (filePath: string): number => {
    const sourceFile = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf-8'), ts.ScriptTarget.Latest, true);
    let importCount = 0;
    ts.forEachChild(sourceFile, node => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
            importCount++;
        }
    });
    return importCount;
}