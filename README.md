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
- pan and zoom the canvas
- drag and resize terminal nodes
- persist workspace path and layout locally between launches
- restore terminal layout and recreate fresh PTY sessions on relaunch

Scripts:
- npm run dev
- npm run build
- npm run test
- npm run lint
- npm run start

Install notes:
- run `npm install` before first launch
- the PTY backend uses a prebuilt native package to avoid a local C++ rebuild on normal installs

Windows notes:
- terminal startup prefers PowerShell 7 (`pwsh.exe`), then Windows PowerShell, then `cmd.exe`
- the app no longer relies on rebuilding `node-pty` during install
- invalid saved workspace paths fall back to the user home directory when creating terminals
- packaged renderer paths use proper `file:///` URLs so production startup works on Windows
