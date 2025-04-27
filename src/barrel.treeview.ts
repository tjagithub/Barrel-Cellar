import * as vscode from "vscode";
import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const extensionPriority = ['.ts', '.tsx', '.d.ts', '.patch.ts'];
const pathCache = new Map<string, string | undefined>();

interface ExportedModuleInfo {
    label: string;
    path: string;
    directory: string;
    extension: string;
    isTypeOnly: boolean;
    moduleName: string;
    modulePath: string;
}

export interface BarrelFile {
    barrelPath: string;
    exports: ExportedModuleInfo[];
}

// biome-ignore lint/suspicious/noConfusingVoidType: wont fix
type BarrelTreeData = BarrelFile | undefined | void;

export class BarrelFilesProvider implements vscode.TreeDataProvider<BarrelFile> {
    private readonly _onDidChangeTreeData: vscode.EventEmitter<BarrelTreeData> = new vscode.EventEmitter<BarrelTreeData>();
    readonly onDidChangeTreeData: vscode.Event<BarrelTreeData> = this._onDidChangeTreeData.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        const watcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx}");

        watcher.onDidChange(() => this.refresh());
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());

        context.subscriptions.push(watcher);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getChildren(element?: BarrelFile): vscode.ProviderResult<BarrelFile[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return Promise.resolve([]);
        }

        if (element) {
            return element.exports.length === 0
                ? Promise.resolve(this.findFilesUsingBarrel(element.barrelPath).map(filePath => ({ barrelPath: filePath, exports: [] })))
                : Promise.resolve(element.exports.map(exp => ({ barrelPath: exp.path, exports: [] })));
        }

        const barrelFiles: BarrelFile[] = [];

        const collectBarrelFiles = (directory: string) => {
            for (const file of fs.readdirSync(directory)) {
                const filePath = path.join(directory, file);
                if (fs.statSync(filePath).isDirectory()) {
                    collectBarrelFiles(filePath);
                } else if (file.endsWith('index.ts')) {
                    const barrelFile = this.parseBarrel(filePath);
                    if (barrelFile) {
                        barrelFiles.push(barrelFile);
                    }
                }
            }
        };

        for (const folder of workspaceFolders) {
            collectBarrelFiles(folder.uri.fsPath);
        }

        return Promise.resolve(barrelFiles);
    }

    private findFilesUsingBarrel(barrelPath: string): string[] {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const filesUsingBarrel: string[] = [];

        const searchFiles = (directory: string) => {
            for (const file of fs.readdirSync(directory)) {
                const filePath = path.join(directory, file);
                if (fs.statSync(filePath).isDirectory()) {
                    searchFiles(filePath);
                } else if (file.endsWith('.ts')) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    if (content.includes(`'${barrelPath}'`) || content.includes(`"${barrelPath}"`)) {
                        filesUsingBarrel.push(filePath);
                    }
                }
            }
        };

        for (const folder of workspaceFolders) {
            searchFiles(folder.uri.fsPath);
        }

        return filesUsingBarrel;
    }

    private resolveModulePath(baseDir: string, moduleSpecifier: string): string | undefined {
        const cacheKey = path.join(baseDir, moduleSpecifier);
        if (pathCache.has(cacheKey)) {
            return pathCache.get(cacheKey);
        }

        const possiblePaths = extensionPriority.flatMap(ext => [
            path.join(baseDir, moduleSpecifier + ext),
            path.join(baseDir, moduleSpecifier, `index${ext}`)
        ]);

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                pathCache.set(cacheKey, p);
                return p;
            }
        }

        pathCache.set(cacheKey, undefined);
        return undefined;
    }

    private parseBarrel(filePath: string): BarrelFile {
        const sourceText = fs.readFileSync(filePath, 'utf8');
        const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
        const barrelDir = path.dirname(filePath);

        const exports: ExportedModuleInfo[] = [];

        sourceFile.forEachChild(node => {
            if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                const modulePath = node.moduleSpecifier.text;
                const resolvedPath = this.resolveModulePath(barrelDir, modulePath);
                if (resolvedPath) {
                    exports.push({
                        label: path.basename(modulePath),
                        path: resolvedPath,
                        directory: path.dirname(resolvedPath),
                        extension: path.extname(resolvedPath),
                        isTypeOnly: !!node.isTypeOnly,
                        moduleName: modulePath.replace(/\.d\.ts$/, ''),
                        modulePath: resolvedPath.replace(/\.d\.ts$/, '')
                    });
                }
            }
        });

        return { barrelPath: filePath, exports };
    }

    getTreeItem(element: BarrelFile): vscode.TreeItem {
        const isIndexFile = path.basename(element.barrelPath) === 'index.ts';
        const parentFolderName = path.basename(path.dirname(element.barrelPath));

        return {
            id: element.barrelPath,
            label: isIndexFile 
                ? `${parentFolderName} / ${path.basename(element.barrelPath)}`
                : path.basename(element.barrelPath),
            collapsibleState: element.exports.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            accessibilityInformation: {
                label: `Barrel file: ${element.barrelPath}`,
                role: 'treeitem',
            },
            contextValue: 'barrelFile',
            resourceUri: vscode.Uri.file(element.barrelPath),
            command: {
                command: 'vscode.open',
                title: 'Open Barrel File',
                arguments: [vscode.Uri.file(element.barrelPath)],
            },
            tooltip: `Barrel file: ${element.barrelPath}`,
            description: element.exports.length > 0 ? `Exports: ${element.exports.length}` : "Used for barrel file(s)",
            iconPath: {
                light: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'light', isIndexFile ? 'folder.png' : 'file.png'))),
                dark: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'dark', isIndexFile ? 'folder.png' : 'file.png'))),
            },
        };
    }
}