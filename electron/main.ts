import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { getPreloadPath, getRendererUrl, getRuntimeRoot, resolvePreferredCwd } from './runtime'
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

  void window.loadURL(rendererUrl)
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
    const cwd = resolvePreferredCwd({
      requestedCwd: request.cwd,
      workspacePath: persistedState.workspacePath,
      homePath: app.getPath('home'),
    })
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
