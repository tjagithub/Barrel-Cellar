import * as vscode from "vscode";
import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const extensionPriority = [".ts", ".tsx", ".d.ts", ".patch.ts"];

// Source file cache: file path -> ts.SourceFile
const sourceFileCache = new Map<string, ts.SourceFile>();

function cacheSourceFile(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    sourceFileCache.set(filePath, sourceFile);
  } catch {
    // File might not exist or be readable
    sourceFileCache.delete(filePath);
  }
}

function removeSourceFileFromCache(filePath: string) {
  sourceFileCache.delete(filePath);
}

function scanAndCacheSourceFiles(dir: string) {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        scanAndCacheSourceFiles(fullPath);
      } else if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
        cacheSourceFile(fullPath);
      }
    }
  } catch {
    // Intentionally left empty
  }
}

export interface Folder {
  name: string;
  files: string[];
}
type BarrelTreeData = TreeItem | undefined | void;

// Returns { value: number[], type: number[] } where each array contains the count of symbols per export statement
const getExportSymbolCounts = (filePath: string) => {
  const sourceFile = sourceFileCache.get(filePath);
  if (!sourceFile) {
    return { value: [], type: [] };
  }
  const value: number[] = [];
  const type: number[] = [];
  function countExports(node: ts.Node) {
    if (ts.isExportDeclaration(node)) {
      handleExportDeclaration(node);
    } else if (ts.isExportAssignment(node)) {
      value.push(1);
    } else if (
      ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      handleExportKeyword(node);
    }
    ts.forEachChild(node, countExports);
  }

  function handleExportDeclaration(node: ts.ExportDeclaration) {
    const isType = !!node.isTypeOnly;
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      const count = node.exportClause.elements.length;
      if (isType) {
        type.push(count);
      } else {
        value.push(count);
      }
    } else if (isType) {
      // export * from 'x'
      type.push(1);
    } else {
      value.push(1);
    }
  }

  function handleExportKeyword(node: ts.Node) {
    if (ts.isEnumDeclaration(node)) {
      value.push(1);
    } else if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node)
    ) {
      type.push(1);
    } else {
      value.push(1);
    }
  }
  countExports(sourceFile);
  return { value, type };
};

class TreeItem extends vscode.TreeItem {
  public readonly directory: string;
  public readonly isBarrel: boolean = false;
  private readonly name: string;
  constructor(directory: string, isDirectory: boolean, isBarrel?: boolean) {
    super(
      directory,
      isDirectory || isBarrel
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.directory = directory;
    this.name = path.basename(this.directory);
    this.isBarrel = isBarrel ?? false;
    let icon: string;
    if (isBarrel) {
      icon = "output-view-icon";
    } else if (isDirectory) {
      icon = "folder";
    } else {
      icon = "file";
    }
    const labelName = isBarrel ? `Barrel: ${this.name}` : this.name;
    const id = this.name + Math.random().toString(36).substring(2, 15);
    this.label = labelName;
    this.id = id;
    this.contextValue = isDirectory ? "folder" : "file";
    this.iconPath = new vscode.ThemeIcon(icon);
    this.accessibilityInformation = {
      label: `${isDirectory ? "Folder" : "File"}: ${this.directory}`,
      role: "treeitem",
    };
    if (isDirectory) {
      this.description = "";
      this.tooltip = path.basename(this.directory);
    } else {
      const expCounts = getExportSymbolCounts(directory);
      const exportSymbolCount =
        expCounts.value.reduce((a, b) => a + b, 0) +
        expCounts.type.reduce((a, b) => a + b, 0);
      const valueExportCount = expCounts.value.length;
      const typeExportCount = expCounts.type.length;
      const importSymbolCount =
        getNumberOfImports(directory, false) +
        getNumberOfImports(directory, true);
      const valueImportCount = getNumberOfImports(directory, false);
      const typeImportCount = getNumberOfImports(directory, true);
      this.description = `⏫${exportSymbolCount} 🔼${valueExportCount} 🧩${typeExportCount} ↔ ⏬${importSymbolCount} 🔽${valueImportCount} 🧩${typeImportCount}`;
      this.tooltip = `Exports: ${exportSymbolCount}, symbols: ${valueExportCount}, type: ${typeExportCount}; Imports: ${importSymbolCount}, symbols: ${valueImportCount}, types: ${typeImportCount}`;
    }
    this.collapsibleState =
      isDirectory || isBarrel
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
    this.resourceUri = vscode.Uri.file(this.directory);
    if (!isDirectory) {
      this.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [vscode.Uri.file(directory)],
      };
    }
  }
}

export class BarrelViewProvider implements vscode.TreeDataProvider<TreeItem> {
  private readonly workspacePath: string | undefined;
  private readonly _onDidChangeTreeData: vscode.EventEmitter<BarrelTreeData> =
    new vscode.EventEmitter<BarrelTreeData>();
  readonly onDidChangeTreeData: vscode.Event<BarrelTreeData> =
    this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx}");
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      return;
    }
    this.workspacePath = workspace.uri.fsPath;

    // Initial scan and cache
    scanAndCacheSourceFiles(this.workspacePath);

    watcher.onDidChange((uri) => {
      cacheSourceFile(uri.fsPath);
      this.refresh();
    });
    watcher.onDidCreate((uri) => {
      cacheSourceFile(uri.fsPath);
      this.refresh();
    });
    watcher.onDidDelete((uri) => {
      removeSourceFileFromCache(uri.fsPath);
      this.refresh();
    });

    context.subscriptions.push(watcher);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
    if (!(this.context && this.workspacePath)) {
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
        fs.readFileSync(element.directory, "utf-8"),
        ts.ScriptTarget.Latest,
        true,
      );
      ts.forEachChild(sourceFile, (node) => {
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          let exportPath = node.moduleSpecifier.getText().replace(/['"]/g, "");
          if (!(exportPath.endsWith(".ts") || exportPath.endsWith(".tsx"))) {
            for (const ext of extensionPriority) {
              if (
                fs.existsSync(
                  path.join(path.dirname(element.directory), exportPath + ext),
                )
              ) {
                exportPath += ext;
                break;
              }
            }
          }
          const exportFilePath = path.resolve(
            path.dirname(element.directory),
            exportPath,
          );
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
      files = fs.readdirSync(directory).filter((file) => {
        const filePath = path.join(directory, file);
        const hasIndex =
          fs.existsSync(path.join(filePath, "index.ts")) &&
          getNumberOfExports(path.join(filePath, "index.ts")) > 0;
        return (
          file !== "node_modules" &&
          !file.startsWith(".") &&
          (fs.statSync(filePath).isFile() || hasIndex)
        );
      });
    } catch {
      return Promise.resolve([]);
    }

    const items: TreeItem[] = files
      .filter(
        (file) =>
          fs.existsSync(path.join(directory, file)) &&
          fs.statSync(path.join(directory, file)).isDirectory(),
      )
      .map((file) => new TreeItem(path.join(directory, file), true, false))
      .filter((item): item is TreeItem => !!item)
      .concat(
        fs.existsSync(path.join(directory, "index.ts")) &&
          checkBarrelFile(path.join(directory, "index.ts"))
          ? [new TreeItem(path.join(directory, "index.ts"), false, true)]
          : [],
      )
      .sort((a, b) =>
        typeof a.label === "string" && typeof b.label === "string"
          ? a.label.localeCompare(b.label)
          : 0,
      );
    console.log(items);
    return Promise.resolve(items);
  }
  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }
}

// Singleton output channel for BarrelProvider logs
let barrelOutputChannel: vscode.OutputChannel | undefined;
function getBarrelOutputChannel(): vscode.OutputChannel {
  if (!barrelOutputChannel) {
    barrelOutputChannel = vscode.window.createOutputChannel("BarrelProvider");
  }
  return barrelOutputChannel;
}

const checkBarrelFile = (filePath: string): boolean => {
  const sourceFile = sourceFileCache.get(filePath);
  if (sourceFile) {
    console.log(`[CACHE HIT] checkBarrelFile: ${filePath}`);
  } else {
    console.log(`[CACHE MISS] checkBarrelFile: ${filePath}`);
  }
  if (!sourceFile) {
    return false;
  }
  let isBarrelFile = false;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isExportDeclaration(node)) {
      isBarrelFile = true;
    }
  });
  return isBarrelFile;
};

const getNumberOfExports = (filePath: string, typeOnly = false): number => {
  const sourceFile = sourceFileCache.get(filePath);
  if (sourceFile) {
    console.log(
      `[CACHE HIT] getNumberOfExports: ${filePath} (typeOnly: ${typeOnly})`,
    );
  } else {
    console.log(
      `[CACHE MISS] getNumberOfExports: ${filePath} (typeOnly: ${typeOnly})`,
    );
  }
  if (!sourceFile) {
    return 0;
  }
  let exportCount = 0;
  function countExports(node: ts.Node) {
    if (ts.isExportDeclaration(node)) {
      const isType = !!node.isTypeOnly;
      if (typeOnly ? isType : !isType) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          exportCount += node.exportClause.elements.length;
        } else {
          // export * from 'x'
          exportCount++;
        }
      }
    } else if (ts.isExportAssignment(node)) {
      if (!typeOnly) {
        exportCount++;
      }
    } else if (
      ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      // For type-only, check if it's a type declaration
      const isType =
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node);
      if (typeOnly ? isType : !isType) {
        exportCount++;
      }
    }
    ts.forEachChild(node, countExports);
  }
  countExports(sourceFile);
  return exportCount;
};

const getNumberOfImports = (filePath: string, typeOnly = false): number => {
  const sourceFile = sourceFileCache.get(filePath);
  const logger = getBarrelOutputChannel();
  if (sourceFile) {
    logger.appendLine(
      `[CACHE HIT] getNumberOfImports: ${filePath} (typeOnly: ${typeOnly})`,
    );
  } else {
    logger.appendLine(
      `[CACHE MISS] getNumberOfImports: ${filePath} (typeOnly: ${typeOnly})`,
    );
  }
  if (!sourceFile) {
    return 0;
  }
  let importCount = 0;
  function countImports(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const isType = !!node.importClause && !!node.importClause.isTypeOnly;
      if (typeOnly ? isType : !isType) {
        importCount++;
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      // import x = require('y') is never type-only
      if (!typeOnly) {
        importCount++;
      }
    }
    ts.forEachChild(node, countImports);
  }
  countImports(sourceFile);
  return importCount;
};
