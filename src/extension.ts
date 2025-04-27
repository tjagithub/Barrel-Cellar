// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { BarrelFilesProvider } from './barrel.treeview';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "debarrel" is now active!');
	vscode.window.registerTreeDataProvider('debarrel', new BarrelFilesProvider(context));
}

// This method is called when your extension is deactivated
export async function deactivate() {};