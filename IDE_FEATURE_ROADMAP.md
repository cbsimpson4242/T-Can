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
- [ ] Find/replace
  - [x] Find in current file.
  - [x] Replace in current file.
  - [ ] Search across workspace.
  - [ ] Replace across workspace.
- [x] Editor polish
  - [x] Line numbers, minimap toggle, word wrap toggle.
  - [x] Format document.
  - [x] Go to line.
  - [x] Breadcrumbs.
  - [x] Split editor panes.

Progress note (2026-04-24): Core editor features are implemented in the canvas editor node and explorer. Workspace search/replace and command palette infrastructure were removed by request. Verified with TypeScript build, renderer/electron builds, and Vitest.

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
- [ ] Project-aware indexing
  - [x] Open-file symbol extraction for outline.
  - [ ] Workspace symbol search.
  - [x] Outline view.
  - [x] Jump to class/function/file from outline.
- [ ] Formatting and linting
  - [ ] Prettier/ESLint integration.
  - [x] Per-language formatters via Monaco where available.
  - [x] Show lint/diagnostic counts inline for open files.

Progress note (2026-04-24): Added Monaco-powered TypeScript/JavaScript intelligence actions, inline diagnostics counts, and open-file outline navigation. Workspace symbol search and its top-navigation entry were removed by request; remaining work is true external LSP/DAP-style adapters, workspace-wide symbol indexing, and dedicated Prettier/ESLint wiring.

## Terminal/workspace integration

- [x] Terminal tabs or terminal manager
  - [x] List all terminals.
  - [x] Rename terminal.
  - [x] Duplicate terminal.
  - [x] Restart terminal.
  - [x] Kill individual terminal.
  - [x] Split terminal panes.
- [x] Task runner
  - [x] Detect `package.json` scripts.
  - [x] Run npm/yarn/pnpm scripts from terminal manager.
  - [x] Run build/test/lint commands.
  - [x] Show task output in terminal or output panel.
- [x] Problem matcher
  - [x] Parse terminal output for errors.
  - [x] Click errors to open file/line.
- [x] Persistent terminal layout
  - [x] Remember size, position, shell, workspace, cwd.
  - [x] Restore terminal sessions where possible.

Progress note (2026-04-24): Added terminal manager, task detection/runner, problem matching, per-terminal lifecycle actions, and persisted terminal cwd/task metadata.

## Git integration

- [x] Source control panel
  - [x] Show changed/untracked/staged files.
  - [x] Stage/unstage/discard changes.
  - [x] Commit.
  - [x] Push/pull/fetch.
  - [x] Branch switch/create/delete.
- [x] Diff viewer
  - [x] File diff against HEAD.
  - [x] Inline diff mode.
  - [x] Diff staged vs unstaged.
  - [x] Resolve merge conflicts via conflicted-file status and editor workflow.
- [x] Editor Git decorations
  - [x] Gutter indicators for added/modified/deleted lines.
  - [x] Blame annotation.
  - [x] Open file history.

Progress note (2026-04-24): Added Git IPC, source control panel, branch controls, diff rendering, history/blame actions, and editor gutter decorations for Git changes.

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
  - Removed by request; revisit only if command palette is reintroduced.
- [ ] Keyboard shortcuts
  - Configurable keybindings.
  - Common IDE shortcuts:
    - `Ctrl+P`: quick file open
    - `Ctrl+S`: save
    - `Ctrl+F`: find
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
3. Quick open / recent files.
4. Git diff/source control panel.
5. LSP integration for TypeScript/JavaScript.
6. Problems panel with diagnostics.
7. Task runner for `package.json` scripts.
8. Dockable bottom panel for terminal/output/problems.
9. Settings/keybindings.
10. Non-blocking notifications instead of alerts/prompts.
