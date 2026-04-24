import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, type OpenDialogOptions } from 'electron'
import { getPreloadPath, getRendererUrl, getRuntimeRoot, resolvePreferredCwd } from './runtime'
import { JsonStore } from './services/jsonStore'
import { TerminalDaemonClient } from './services/terminalDaemonClient'
import {
  IPC_CHANNELS,
  createTerminalRequestSchema,
  persistedLayoutSchema,
  terminalClipboardRequestSchema,
  terminalCloseSchema,
  terminalContextMenuSchema,
  terminalSessionSchema,
  terminalResizeSchema,
  terminalWriteSchema,
} from '../shared/ipc'
import type { PersistedAppState } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let hoverFocusInterval: NodeJS.Timeout | null = null
let store: JsonStore
let persistedState: PersistedAppState
let terminalDaemon: TerminalDaemonClient

function isPointInsideBounds(point: Electron.Point, bounds: Electron.Rectangle): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

function startAutoFocusOnHover(window: BrowserWindow): void {
  if (hoverFocusInterval) {
    clearInterval(hoverFocusInterval)
  }

  hoverFocusInterval = setInterval(() => {
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || window.isFocused()) {
      return
    }

    const cursorPoint = screen.getCursorScreenPoint()
    if (isPointInsideBounds(cursorPoint, window.getBounds())) {
      window.focus()
    }
  }, 100)

  window.on('closed', () => {
    if (hoverFocusInterval) {
      clearInterval(hoverFocusInterval)
      hoverFocusInterval = null
    }
  })
}

function createMainWindow(): BrowserWindow {
  const appPath = app.getAppPath()
  const runtimeRoot = getRuntimeRoot(appPath)
  const rendererUrl = getRendererUrl(appPath, process.env.VITE_DEV_SERVER_URL)

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111318',
    title: 'T-CAN',
    webPreferences: {
      preload: getPreloadPath(runtimeRoot),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  startAutoFocusOnHover(window)
  void window.loadURL(rendererUrl)
  return window
}

async function persistTerminalRegistry(): Promise<void> {
  try {
    const registryPath = path.join(app.getPath('userData'), 'terminal-pids.json')
    const sessions = await terminalDaemon.listSessions()
    fs.mkdirSync(path.dirname(registryPath), { recursive: true })
    fs.writeFileSync(registryPath, JSON.stringify({ sessions, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`[T-CAN] Failed to persist terminal registry: ${message}\n`)
  }
}

function formatTimestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function quotePathForTerminal(filePath: string): string {
  return JSON.stringify(filePath.replace(/\\/g, '/'))
}

function saveClipboardImage(rootDirectory: string): string | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return null
  }

  const directory = path.join(rootDirectory, '.tcan-pasted-images')
  fs.mkdirSync(directory, { recursive: true })

  const filePath = path.join(directory, `screenshot-${formatTimestampForFilename()}.png`)
  fs.writeFileSync(filePath, image.toPNG())
  return filePath
}

async function readClipboardForTerminal(sessionId: string, mode: 'clipboard' | 'selection' = 'clipboard'): Promise<string> {
  try {
    const text = clipboard.readText(mode)
    if (text || mode === 'selection') {
      return text
    }
  } catch (error) {
    if (mode === 'selection') {
      return ''
    }
    throw error
  }

  const session = await terminalDaemon.getSession(sessionId)
  const preferredRoot = session?.info.cwd ?? persistedState.workspacePath ?? app.getPath('pictures') ?? app.getPath('home')

  try {
    const imagePath = saveClipboardImage(preferredRoot)
    if (imagePath) {
      return quotePathForTerminal(imagePath)
    }
  } catch (error) {
    const fallbackRoot = path.join(app.getPath('userData'), 'pasted-images')
    const imagePath = saveClipboardImage(fallbackRoot)
    if (imagePath) {
      return quotePathForTerminal(imagePath)
    }
    throw error
  }

  return ''
}

function persistLayout(nextState: PersistedAppState): PersistedAppState {
  persistedState = nextState

  try {
    store.save(persistedState)
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`[T-CAN] Failed to persist app state: ${message}\n`)
  }

  return persistedState
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppState, async () => persistedState)

  ipcMain.handle(IPC_CHANNELS.openWorkspace, async () => {
    const dialogOptions: OpenDialogOptions = {
      title: 'Open workspace',
      defaultPath: persistedState.workspacePath ?? app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open workspace',
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return persistedState.workspacePath
    }

    const workspacePath = result.filePaths[0] ?? null
    persistLayout({
      ...persistedState,
      workspacePath,
    })
    return workspacePath
  })

  ipcMain.handle(IPC_CHANNELS.saveLayout, async (_event, candidate) => {
    const layout = persistedLayoutSchema.parse(candidate)
    return persistLayout({
      ...persistedState,
      layout,
    })
  })

  ipcMain.handle(IPC_CHANNELS.createTerminal, async (_event, candidate) => {
    const request = createTerminalRequestSchema.parse(candidate)
    const cwd = resolvePreferredCwd({
      requestedCwd: request.cwd,
      workspacePath: persistedState.workspacePath,
      homePath: app.getPath('home'),
    })
    const session = await terminalDaemon.createSession({ ...request, cwd })
    void persistTerminalRegistry()
    return session
  })

  ipcMain.handle(IPC_CHANNELS.getTerminalSession, async (_event, candidate) => {
    const request = terminalSessionSchema.parse(candidate)
    return terminalDaemon.getSession(request.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.listTerminals, async () => terminalDaemon.listSessions())

  ipcMain.handle(IPC_CHANNELS.writeTerminal, async (_event, candidate) => {
    const request = terminalWriteSchema.parse(candidate)
    await terminalDaemon.write(request.sessionId, request.data)
  })

  ipcMain.handle(IPC_CHANNELS.resizeTerminal, async (_event, candidate) => {
    const request = terminalResizeSchema.parse(candidate)
    await terminalDaemon.resize(request.sessionId, request.cols, request.rows)
  })

  ipcMain.handle(IPC_CHANNELS.closeTerminal, async (_event, candidate) => {
    const request = terminalCloseSchema.parse(candidate)
    await terminalDaemon.close(request.sessionId)
    void persistTerminalRegistry()
  })

  ipcMain.handle(IPC_CHANNELS.closeAllTerminals, async () => {
    await terminalDaemon.closeAll()
    void persistTerminalRegistry()
  })

  ipcMain.handle(IPC_CHANNELS.readClipboardForTerminal, async (_event, candidate) => {
    const request = terminalClipboardRequestSchema.parse(candidate)
    return readClipboardForTerminal(request.sessionId, request.mode)
  })

  ipcMain.handle(IPC_CHANNELS.showTerminalContextMenu, async (event, candidate) => {
    const request = terminalContextMenuSchema.parse(candidate)
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const menu = Menu.buildFromTemplate([
      {
        label: 'Paste',
        click: () => {
          void readClipboardForTerminal(request.sessionId).then((data) => {
            event.sender.send(IPC_CHANNELS.terminalPaste, {
              sessionId: request.sessionId,
              data,
            })
          })
        },
      },
    ])

    menu.popup({ window })
  })
}

function forwardPtyEvents(): void {
  terminalDaemon.onOutput((event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.terminalOutput, event)
  })
  terminalDaemon.onExit((event) => {
    void persistTerminalRegistry()
    mainWindow?.webContents.send(IPC_CHANNELS.terminalExit, event)
  })
}

app.whenReady().then(() => {
  terminalDaemon = new TerminalDaemonClient({
    daemonPath: path.join(__dirname, 'terminal-daemon.cjs'),
    statePath: path.join(app.getPath('userData'), 'terminal-daemon.json'),
  })
  store = new JsonStore(path.join(app.getPath('userData'), 'app-state.json'))
  persistedState = store.load()
  registerIpcHandlers()
  forwardPtyEvents()
  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  mainWindow = null
})

app.on('before-quit', () => {
  void terminalDaemon.shutdownIfIdle()
  void persistTerminalRegistry()
})
