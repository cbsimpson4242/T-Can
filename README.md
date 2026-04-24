# T-CAN

T-CAN is an Electron + React + TypeScript MVP for arranging multiple live terminal sessions on an infinite canvas.

Current platform support:
- Linux
- Windows
- macOS is not the primary target, but should behave similarly to Linux for shell startup

Features in this MVP:
- open a folder as the active workspace
- create terminal nodes rooted at the workspace path
- automatically choose an appropriate shell per platform
- pan the canvas with middle mouse, and zoom only while the keyboard Ctrl key is held plus the scroll wheel
- drag and resize terminal nodes
- persist workspace path and layout locally between launches
- keep terminal sessions alive across renderer refreshes and app restarts via a local terminal daemon
- reconnect terminal nodes to existing sessions and replay recent terminal output
- explicitly kill one terminal, or use the in-app `KILL ALL` control to stop every T-CAN terminal

Scripts:
- npm run dev
- npm run build
- npm run test
- npm run lint
- npm run start
- npm run kill-terminals

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
- the app no longer relies on rebuilding `node-pty` during install
- invalid saved workspace paths fall back to the user home directory when creating terminals
- packaged renderer paths use proper `file:///` URLs so production startup works on Windows
