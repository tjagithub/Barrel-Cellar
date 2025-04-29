# Barrel Cellar README

This extension helps developers manage and visualize barrel files in TypeScript projects.

## Overview

Barrel Cellar is a Visual Studio Code extension designed to help developers manage and visualize barrel files in TypeScript projects. Barrel files (e.g., `index.ts`) are commonly used to re-export modules, making imports cleaner and more maintainable. This extension provides a tree view to list barrel files, their exports, and the files that use them.

## Features

- **Barrel File Detection**: Automatically detects `index.ts` files in your workspace.
- **Export Visualization**: Displays the modules exported by each barrel file.
- **Usage Tracking**: Identifies files that import a specific barrel file.
- **Interactive Tree View**: Navigate through barrel files, their exports, and usage directly from the activity bar.

## Requirements

- Visual Studio Code version 1.99.0 or higher.
- TypeScript installed in your project.

## Installation

1. Open the Extensions view in VS Code (`Ctrl+Shift+X` or `Cmd+Shift+X` on macOS).
2. Search for "Barrel Cellar" and click `Install`.
3. Reload VS Code if prompted.

## Usage

1. Open a TypeScript project in VS Code.
2. Navigate to the "Barrel Cellar" view in the activity bar.
3. Explore the tree view to see barrel files, their exports, and usage.

## Extension Settings

This extension does not currently add any custom settings.

## Known Issues

- Large projects with many barrel files may take longer to load.
- Only supports TypeScript files (`.ts`, `.tsx`).

## Release Notes

### 0.0.1

- Initial release with basic barrel file detection and visualization.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests on the [GitHub repository](https://github.com/tjagithub/barrelcellar).

## License

This extension is licensed under the MIT License.
