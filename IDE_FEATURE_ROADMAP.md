# IDE Feature Roadmap

A saved checklist of features that would make T-CAN work more like a full IDE.

## Core editor features

- [x] Tabbed editor area
  - [x] Open multiple files in tabs.
  - [x] Close, pin, reorder, split, and restore tabs.
  - [x] Show dirty/unsaved indicators.
- [x] File creation/rename/delete
  - [x] New file/folder from explorer.
  - [x] Rename files/folders.
  - [x] Delete with confirmation.
  - [x] Duplicate/copy path/reveal in system explorer.
- [x] Save workflow
  - [x] `Ctrl+S` save active file.
  - [x] Save all.
  - [x] Auto-save option.
  - [x] Unsaved-change prompts when closing files/workspaces.
- [x] Find/replace
  - [x] Find in current file.
  - [x] Replace in current file.
  - [x] Search across workspace.
  - [x] Replace across workspace.
- [x] Editor polish
  - [x] Line numbers, minimap toggle, word wrap toggle.
  - [x] Format document.
  - [x] Go to line.
  - [x] Breadcrumbs.
  - [x] Split editor panes.

Progress note (2026-04-24): Core editor features are implemented in the canvas editor node, explorer, preload/main IPC, and workspace search UI. Verified with TypeScript build, renderer/electron builds, and Vitest.

## Language intelligence

- [ ] Language Server Protocol integration
  - [x] TypeScript/JavaScript Monaco language intelligence enabled.
  - [ ] Python, Rust, Go external LSP adapters.
  - [x] Autocomplete.
  - [x] Hover documentation.
  - [x] Go to definition.
  - [x] Find references.
  - [x] Rename symbol.
  - [x] Diagnostics/errors/warnings.
  - [x] Code actions/quick fixes.
- [x] Project-aware indexing
  - [x] Symbol search.
  - [x] Workspace symbol search.
  - [x] Outline view.
  - [x] Jump to class/function/file.
- [ ] Formatting and linting
  - [ ] Prettier/ESLint integration.
  - [x] Per-language formatters via Monaco where available.
  - [x] Show lint/diagnostic counts inline for open files.

Progress note (2026-04-24): Added Monaco-powered TypeScript/JavaScript intelligence actions, inline diagnostics counts, file outline, and workspace symbol indexing/search for TS/JS/Python/Rust/Go-style symbols. Remaining work is true external LSP/DAP-style adapters and dedicated Prettier/ESLint wiring.

## Terminal/workspace integration

- [ ] Terminal tabs or terminal manager
  - List all terminals.
  - Rename terminal.
  - Duplicate terminal.
  - Restart terminal.
  - Kill individual terminal.
  - Split terminal panes.
- [ ] Task runner
  - Detect `package.json` scripts.
  - Run npm/yarn/pnpm scripts from command palette.
  - Run build/test/lint commands.
  - Show task output in terminal or output panel.
- [ ] Problem matcher
  - Parse terminal output for errors.
  - Click errors to open file/line.
- [ ] Persistent terminal layout
  - Remember size, position, shell, workspace, cwd.
  - Restore terminal sessions where possible.

## Git integration

- [ ] Source control panel
  - Show changed/untracked/staged files.
  - Stage/unstage/discard changes.
  - Commit.
  - Push/pull/fetch.
  - Branch switch/create/delete.
- [ ] Diff viewer
  - File diff against HEAD.
  - Inline and side-by-side diff modes.
  - Diff staged vs unstaged.
  - Resolve merge conflicts.
- [ ] Editor Git decorations
  - Gutter indicators for added/modified/deleted lines.
  - Blame annotation.
  - Open file history.

## Debugging

- [ ] Debugger support
  - Breakpoints.
  - Step over/into/out.
  - Variables/watch/call stack panels.
  - Debug console.
  - Launch configurations.
- [ ] Debug Adapter Protocol integration
  - Node.js.
  - Python.
  - Browser.
  - Other language adapters later.

## UI/layout features

- [ ] Dockable panels
  - Explorer, search, source control, problems, output, terminal, debug.
  - Collapse/resize sidebars and bottom panels.
  - Save layout per workspace.
- [ ] Command palette expansion
  - More commands.
  - Recent files.
  - Go to file.
  - Run task.
  - Switch terminal.
  - Toggle panels.
- [ ] Keyboard shortcuts
  - Configurable keybindings.
  - Common IDE shortcuts:
    - `Ctrl+P`: quick file open
    - `Ctrl+Shift+P`: command palette
    - `Ctrl+S`: save
    - `Ctrl+F`: find
    - `Ctrl+Shift+F`: workspace search
    - ``Ctrl+` ``: terminal
    - `Ctrl+B`: sidebar toggle
- [ ] Settings
  - User settings.
  - Workspace settings.
  - Theme settings.
  - Font size/family.
  - Shell selection.
  - Autosave.

## Project/workspace features

- [ ] Better workspace model
  - Multiple root folders.
  - Workspace file like `.code-workspace`.
  - Recent workspaces.
  - Trusted workspace mode if executing commands.
- [ ] File watching
  - Auto-refresh explorer on external changes.
  - Detect deleted/renamed files.
  - Conflict handling for externally modified open files.
- [ ] Project detection
  - Detect Node/Python/Rust/etc.
  - Show recommended tasks.
  - Auto-detect package managers.

## Problems/output panels

- [ ] Problems panel
  - Show diagnostics from LSP/linter/build.
  - Click to navigate.
- [ ] Output panel
  - Dedicated logs for extensions/tasks/LSP/Git.
  - Selectable output channels.
- [ ] Notifications
  - Non-blocking toast notifications instead of `alert()`.
  - Action buttons in notifications.

## Extensions/customization

- [ ] Plugin/extension system
  - Add commands.
  - Add panels.
  - Add language support.
  - Add themes.
  - Add task providers.
  - Add custom terminal/tool integrations.
- [ ] Theme support
  - Light/dark themes.
  - Syntax theme selection.
  - Custom CSS variables.

## AI-specific IDE features

- [ ] Agent session manager
  - Track AI coding agent terminals separately.
  - Rename sessions by task.
  - Show status: running, waiting, failed, complete.
  - Kill/restart agent.
- [ ] Agent output summarization
  - Summarize terminal activity.
  - Detect when an agent asks for input.
  - Detect build/test failures.
- [ ] Code review assistant
  - Review current diff.
  - Explain selected code.
  - Generate tests for file/function.
  - Refactor selected code.
- [ ] Patch preview
  - When an agent edits files, show a diff before accepting.
  - Accept/reject chunks.
- [ ] Multi-agent workspace
  - Assign separate terminals/tasks to agents.
  - Monitor all agents from one dashboard.

## Highest-impact next features

1. File explorer write operations: create, rename, delete files/folders.
2. Save shortcuts and dirty-file safety.
3. Workspace search / quick open.
4. Git diff/source control panel.
5. LSP integration for TypeScript/JavaScript.
6. Problems panel with diagnostics.
7. Task runner for `package.json` scripts.
8. Dockable bottom panel for terminal/output/problems.
9. Settings/keybindings.
10. Non-blocking notifications instead of alerts/prompts.
