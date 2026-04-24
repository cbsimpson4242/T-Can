# T-CAN

T-CAN is an Electron + React + TypeScript desktop app for arranging multiple live terminal sessions on an infinite canvas.

Current platform support:
- Linux
- Windows
- macOS is not the primary target, but should behave similarly to Linux for shell startup

Current focus:
- Windows-runnable desktop app
- PowerShell as the default shell on Windows
- live PTY-backed terminal nodes that can launch agent CLIs such as Codex and OpenCode

Features in the current app:
- open a folder as the active workspace
- create terminal nodes rooted at the workspace path
- automatically choose an appropriate shell per platform
- pan the canvas with middle mouse, and zoom only while the keyboard Ctrl key is held plus the scroll wheel
- drag and resize terminal nodes
- persist workspace path and layout locally between launches
- keep terminal sessions alive across renderer refreshes and app restarts via a local terminal daemon
- reconnect terminal nodes to existing sessions and replay recent terminal output
- explicitly kill one terminal, or use the in-app `KILL ALL` control to stop every T-CAN terminal
- default to Windows PowerShell on Windows when available
- extend Windows terminal PATH with common agent CLI install locations such as AppData\Roaming\npm and .opencode\bin

Scripts:
- npm run dev
- npm run build
- npm run test
- npm run lint
- npm run start
- npm run kill-terminals
- npm run dist
- npm run dist:win

Install notes:
- run `npm install` before first launch
- the PTY backend uses a prebuilt native package to avoid a local C++ rebuild on normal installs

Persistent terminal notes:
- Terminal processes are owned by a local T-CAN daemon, not the renderer window.
- Refreshing the frontend or closing/reopening the app reconnects to existing sessions when possible.
- The close button on a terminal intentionally kills that terminal session.
- Use `KILL ALL` in the app to stop all sessions.
- If the UI is unavailable, run `npm run kill-terminals` as an emergency cleanup command.
- The daemon exits automatically when the app quits and no terminal sessions remain.

Windows notes:
- terminal startup prefers PowerShell 7 (`pwsh.exe`), then Windows PowerShell, then `cmd.exe`
- T-CAN augments the spawned terminal PATH with common CLI install folders so npm-global Codex installs and common OpenCode installs are easier to launch from a GUI-started app.
- Expected Windows agent locations include:
  - %APPDATA%\npm
  - %USERPROFILE%\.opencode\bin
  - %LOCALAPPDATA%\Programs\opencode\bin
- the app no longer relies on rebuilding `node-pty` during install
- invalid saved workspace paths fall back to the user home directory when creating terminals
- packaged renderer paths use proper `file:///` URLs so production startup works on Windows
- For best results, install Codex and OpenCode for the same Windows user who runs T-CAN.

Packaging:
- npm run dist builds packaged desktop artifacts for the current host platform
- npm run dist:win targets Windows NSIS + portable builds via electron-builder
- On non-Windows hosts, Windows packaging may require Wine or a real Windows machine
