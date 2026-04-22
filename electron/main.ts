import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { createNodePtyBackend, PtyManager } from './services/ptyManager'
import { JsonStore } from './services/jsonStore'
import {
  IPC_CHANNELS,
  createTerminalRequestSchema,
  persistedLayoutSchema,
  terminalCloseSchema,
  terminalResizeSchema,
  terminalWriteSchema,
} from '../shared/ipc'
import type { PersistedAppState } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let store: JsonStore
let persistedState: PersistedAppState

const ptyManager = new PtyManager({
  backend: createNodePtyBackend(),
})

function getRuntimeRoot(): string {
  const appPath = app.getAppPath()
  return path.basename(appPath) === 'dist-electron' ? path.resolve(appPath, '..') : appPath
}

function getRendererUrl(): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    return devServerUrl
  }
  return `file://${path.join(getRuntimeRoot(), 'dist', 'index.html')}`
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111318',
    title: 'T-CAN',
    webPreferences: {
      preload: path.join(getRuntimeRoot(), 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.loadURL(getRendererUrl())
  return window
}

function persistLayout(nextState: PersistedAppState): PersistedAppState {
  persistedState = nextState
  store.save(persistedState)
  return persistedState
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppState, async () => persistedState)

  ipcMain.handle(IPC_CHANNELS.openWorkspace, async () => {
    const dialogOptions: OpenDialogOptions = {
      title: 'Open workspace',
      properties: ['openDirectory'],
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
    const cwd = request.cwd ?? persistedState.workspacePath ?? app.getPath('home')
    return ptyManager.createSession({ ...request, cwd })
  })

  ipcMain.handle(IPC_CHANNELS.writeTerminal, async (_event, candidate) => {
    const request = terminalWriteSchema.parse(candidate)
    ptyManager.write(request.sessionId, request.data)
  })

  ipcMain.handle(IPC_CHANNELS.resizeTerminal, async (_event, candidate) => {
    const request = terminalResizeSchema.parse(candidate)
    ptyManager.resize(request.sessionId, request.cols, request.rows)
  })

  ipcMain.handle(IPC_CHANNELS.closeTerminal, async (_event, candidate) => {
    const request = terminalCloseSchema.parse(candidate)
    ptyManager.close(request.sessionId)
  })
}

function forwardPtyEvents(): void {
  ptyManager.onOutput((event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.terminalOutput, event)
  })
  ptyManager.onExit((event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.terminalExit, event)
  })
}

app.whenReady().then(() => {
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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  ptyManager.disposeAll()
})
