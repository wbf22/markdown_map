# Markdown Map

A desktop app for visually browsing and editing markdown files on a pannable, zoomable canvas. Built with [Tauri 2](https://v2.tauri.app) and TypeScript.

## Prerequisites

- [Rust](https://rustup.rs) (latest stable)
- [Node.js](https://nodejs.org) 18+
- macOS: [Xcode Command Line Tools](https://developer.apple.com/xcode/) (`xcode-select --install`)

## Setup

```bash
npm install
```

## Development

```bash
npm run tauri dev
```

This starts the Vite dev server and launches the app window with hot-reload.

## Build

```bash
npm run tauri build
```

The release binary is written to `src-tauri/target/release/markdown-map`. On macOS, a `.app` bundle and `.dmg` are also produced in `src-tauri/target/release/bundle/`.

## Usage

- **Pan canvas** — click and drag empty space
- **Zoom** — <kbd>Ctrl</kbd> + scroll, or use the toolbar buttons
- **Drag cards** — click and drag any card to reposition
- **Resize markdown cards** — drag the resize handle (bottom-right corner)
- **Edit a file** — click a card (don't drag) to open the editor panel
- **Create a new file** — click the **New File** button in the top bar
- **Switch directory** — click the directory path in the top bar
- Positions and card sizes are saved automatically to `positions.json` in the working directory.

