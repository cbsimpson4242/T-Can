import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, shell, type OpenDialogOptions } from 'electron'
import { getPreloadPath, getRendererUrl, getRuntimeRoot, resolvePreferredCwd } from './runtime'
import { DEFAULT_LAYOUT, JsonStore } from './services/jsonStore'
import { TerminalDaemonClient } from './services/terminalDaemonClient'
import {
  IPC_CHANNELS,
  createTerminalRequestSchema,
  persistedLayoutSchema,
  sshWorkspaceRequestSchema,
  terminalClipboardRequestSchema,
  workspaceFileCreateSchema,
  terminalCloseSchema,
  terminalContextMenuSchema,
  terminalSessionSchema,
  terminalResizeSchema,
  terminalWriteSchema,
  workspaceFileRequestSchema,
  workspaceFileSaveSchema,
  workspacePathRenameSchema,
  workspaceRequestSchema,
  workspaceSymbolRequestSchema,
  workspaceTextReplaceSchema,
  workspaceTextSearchSchema,
} from '../shared/ipc'
import { extractFileSymbols } from '../shared/languageIntelligence'
import type { PersistedAppState, PersistedWorkspace, WorkspaceFileEntry, WorkspaceFileMutationResult, WorkspaceFileReadResult, WorkspaceSymbol, WorkspaceTextSearchResult } from '../shared/types'

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
  const preferredRoot = session?.info.cwd ?? getActiveWorkspace()?.path ?? app.getPath('pictures') ?? app.getPath('home')

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

function getActiveWorkspace(): PersistedWorkspace | null {
  return persistedState.workspaces.find((workspace) => workspace.id === persistedState.activeWorkspaceId) ?? null
}

function createWorkspaceId(workspacePath: string): string {
  return workspacePath
}

function createSshWorkspaceId(target: string): string {
  return `ssh://${target}`
}

function containsSshTargetSeparatorOrControlCharacter(value: string): boolean {
  for (const character of value) {
    if (/\s/.test(character)) {
      return true
    }

    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) {
      return true
    }
  }

  return false
}

function normalizeSshTarget(target: string): string {
  const normalized = target.trim()
  if (!normalized || normalized.startsWith('-') || containsSshTargetSeparatorOrControlCharacter(normalized)) {
    throw new Error('Enter a single SSH target such as user@example.com or example.com')
  }
  return normalized
}

function createSshTerminalNode(target: string) {
  return {
    id: crypto.randomUUID(),
    type: 'terminal' as const,
    title: `SSH ${target}`,
    x: 80,
    y: 80,
    width: 680,
    height: 420,
    sshTarget: target,
  }
}

function getWorkspaceOrThrow(workspaceId: string): PersistedWorkspace {
  const workspace = persistedState.workspaces.find((entry) => entry.id === workspaceId)
  if (!workspace) {
    throw new Error('Workspace is not open')
  }
  return workspace
}

function resolveWorkspacePath(workspaceId: string, relativePath = ''): string {
  const workspace = getWorkspaceOrThrow(workspaceId)
  const root = path.resolve(workspace.path)
  const target = path.resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('File path escapes the workspace')
  }
  return target
}

const IGNORED_FILE_TREE_NAMES = new Set(['.git', 'node_modules', 'dist', 'dist-electron'])
const MAX_FILE_TREE_DEPTH = 20

function toRelativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/')
}

function listWorkspaceDirectory(workspaceId: string, relativePath = '', depth = 0): WorkspaceFileEntry[] {
  const workspace = getWorkspaceOrThrow(workspaceId)
  if (workspace.kind === 'ssh') {
    return []
  }

  const workspaceRoot = path.resolve(workspace.path)
  const directoryPath = resolveWorkspacePath(workspaceId, relativePath)
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => !IGNORED_FILE_TREE_NAMES.has(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))

  return entries.map((entry) => {
    const absolutePath = path.join(directoryPath, entry.name)
    const entryRelativePath = toRelativeWorkspacePath(workspaceRoot, absolutePath)
    const type = entry.isDirectory() ? 'directory' : 'file'
    return {
      name: entry.name,
      relativePath: entryRelativePath,
      type,
      ...(entry.isDirectory() && depth < MAX_FILE_TREE_DEPTH ? { children: listWorkspaceDirectory(workspaceId, entryRelativePath, depth + 1) } : {}),
    }
  })
}

function readWorkspaceFile(workspaceId: string, relativePath: string): WorkspaceFileReadResult {
  const filePath = resolveWorkspacePath(workspaceId, relativePath)
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    throw new Error('Workspace path is not a file')
  }
  return {
    relativePath,
    content: fs.readFileSync(filePath, 'utf8'),
    mtimeMs: stat.mtimeMs,
  }
}

function saveWorkspaceFile(workspaceId: string, relativePath: string, content: string): WorkspaceFileReadResult {
  const filePath = resolveWorkspacePath(workspaceId, relativePath)
  fs.writeFileSync(filePath, content, 'utf8')
  return readWorkspaceFile(workspaceId, relativePath)
}

function getWorkspaceFileEntry(workspaceId: string, relativePath: string): WorkspaceFileEntry {
  const filePath = resolveWorkspacePath(workspaceId, relativePath)
  const stat = fs.statSync(filePath)
  return {
    name: path.basename(filePath),
    relativePath: relativePath.replace(/\\/g, '/'),
    type: stat.isDirectory() ? 'directory' : 'file',
    ...(stat.isDirectory() ? { children: listWorkspaceDirectory(workspaceId, relativePath) } : {}),
  }
}

function assertLocalWorkspace(workspaceId: string): void {
  const workspace = getWorkspaceOrThrow(workspaceId)
  if (workspace.kind === 'ssh') {
    throw new Error('Remote SSH file operations are not available yet')
  }
}

function ensurePathDoesNotExist(targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    throw new Error('A file or folder already exists at that path')
  }
}

function createWorkspaceFile(workspaceId: string, relativePath: string, type: 'file' | 'directory'): WorkspaceFileMutationResult {
  assertLocalWorkspace(workspaceId)
  const filePath = resolveWorkspacePath(workspaceId, relativePath)
  ensurePathDoesNotExist(filePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (type === 'directory') {
    fs.mkdirSync(filePath, { recursive: false })
  } else {
    fs.writeFileSync(filePath, '', 'utf8')
  }
  return { relativePath, entry: getWorkspaceFileEntry(workspaceId, relativePath) }
}

function renameWorkspacePath(workspaceId: string, relativePath: string, nextRelativePath: string): WorkspaceFileMutationResult {
  assertLocalWorkspace(workspaceId)
  const sourcePath = resolveWorkspacePath(workspaceId, relativePath)
  const targetPath = resolveWorkspacePath(workspaceId, nextRelativePath)
  ensurePathDoesNotExist(targetPath)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.renameSync(sourcePath, targetPath)
  return { relativePath: nextRelativePath, entry: getWorkspaceFileEntry(workspaceId, nextRelativePath) }
}

function deleteWorkspacePath(workspaceId: string, relativePath: string): void {
  assertLocalWorkspace(workspaceId)
  const filePath = resolveWorkspacePath(workspaceId, relativePath)
  fs.rmSync(filePath, { recursive: true, force: false })
}

function createDuplicatePath(filePath: string): string {
  const directory = path.dirname(filePath)
  const extension = path.extname(filePath)
  const basename = path.basename(filePath, extension)
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`
    const candidate = path.join(directory, `${basename}${suffix}${extension}`)
    if (!fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error('Unable to choose a duplicate path')
}

function duplicateWorkspacePath(workspaceId: string, relativePath: string): WorkspaceFileMutationResult {
  assertLocalWorkspace(workspaceId)
  const workspace = getWorkspaceOrThrow(workspaceId)
  const workspaceRoot = path.resolve(workspace.path)
  const sourcePath = resolveWorkspacePath(workspaceId, relativePath)
  const targetPath = createDuplicatePath(sourcePath)
  fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true })
  const duplicateRelativePath = toRelativeWorkspacePath(workspaceRoot, targetPath)
  return { relativePath: duplicateRelativePath, entry: getWorkspaceFileEntry(workspaceId, duplicateRelativePath) }
}

function isLikelyTextFile(filePath: string): boolean {
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size > 1024 * 1024) {
    return false
  }
  const sample = fs.readFileSync(filePath).subarray(0, 4096)
  return !sample.includes(0)
}

function searchFileText(relativePath: string, content: string, query: string): WorkspaceTextSearchResult | null {
  const matches: WorkspaceTextSearchResult['matches'] = []
  const lines = content.split(/\r?\n/)
  lines.forEach((line, index) => {
    let fromIndex = 0
    while (matches.length < 100) {
      const column = line.indexOf(query, fromIndex)
      if (column === -1) {
        break
      }
      matches.push({
        line: index + 1,
        column: column + 1,
        preview: line.trim().slice(0, 240),
      })
      fromIndex = column + Math.max(query.length, 1)
    }
  })
  return matches.length ? { relativePath, matches } : null
}

function walkWorkspaceTextFiles(workspaceId: string, relativePath = '', results: string[] = []): string[] {
  const directoryPath = resolveWorkspacePath(workspaceId, relativePath)
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (IGNORED_FILE_TREE_NAMES.has(entry.name)) {
      continue
    }
    const childRelativePath = path.posix.join(relativePath.replace(/\\/g, '/'), entry.name)
    const childPath = resolveWorkspacePath(workspaceId, childRelativePath)
    if (entry.isDirectory()) {
      walkWorkspaceTextFiles(workspaceId, childRelativePath, results)
    } else if (isLikelyTextFile(childPath)) {
      results.push(childRelativePath)
    }
  }
  return results
}

function searchWorkspaceText(workspaceId: string, query: string): WorkspaceTextSearchResult[] {
  assertLocalWorkspace(workspaceId)
  if (!query) {
    return []
  }
  const results: WorkspaceTextSearchResult[] = []
  for (const relativePath of walkWorkspaceTextFiles(workspaceId)) {
    const filePath = resolveWorkspacePath(workspaceId, relativePath)
    const result = searchFileText(relativePath, fs.readFileSync(filePath, 'utf8'), query)
    if (result) {
      results.push(result)
    }
    if (results.length >= 200) {
      break
    }
  }
  return results
}

function replaceWorkspaceText(workspaceId: string, query: string, replacement: string): WorkspaceTextSearchResult[] {
  const matches = searchWorkspaceText(workspaceId, query)
  for (const result of matches) {
    const filePath = resolveWorkspacePath(workspaceId, result.relativePath)
    const content = fs.readFileSync(filePath, 'utf8')
    fs.writeFileSync(filePath, content.split(query).join(replacement), 'utf8')
  }
  return matches
}

function listWorkspaceSymbols(workspaceId: string, query = ''): WorkspaceSymbol[] {
  assertLocalWorkspace(workspaceId)
  const normalizedQuery = query.trim().toLowerCase()
  const symbols: WorkspaceSymbol[] = []

  for (const relativePath of walkWorkspaceTextFiles(workspaceId)) {
    const filePath = resolveWorkspacePath(workspaceId, relativePath)
    for (const symbol of extractFileSymbols(relativePath, fs.readFileSync(filePath, 'utf8'))) {
      if (!normalizedQuery || symbol.name.toLowerCase().includes(normalizedQuery) || symbol.relativePath.toLowerCase().includes(normalizedQuery)) {
        symbols.push(symbol)
      }
      if (symbols.length >= 500) {
        return symbols
      }
    }
  }

  return symbols.sort((a, b) => a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath))
}

function persistLayout(nextState: PersistedAppState): PersistedAppState {
  persistedState = {
    activeWorkspaceId: nextState.activeWorkspaceId,
    workspaces: nextState.workspaces,
  }

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
    const activeWorkspace = getActiveWorkspace()
    const dialogOptions: OpenDialogOptions = {
      title: 'Open workspace',
      defaultPath: activeWorkspace?.path ?? app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open workspace',
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return persistedState
    }

    const workspacePath = result.filePaths[0]
    const workspaceId = createWorkspaceId(workspacePath)
    const existingWorkspace = persistedState.workspaces.find((workspace) => workspace.id === workspaceId)
    const workspaces = existingWorkspace
      ? persistedState.workspaces
      : [
          ...persistedState.workspaces,
          {
            id: workspaceId,
            path: workspacePath,
            layout: structuredClone(DEFAULT_LAYOUT),
          },
        ]

    return persistLayout({
      activeWorkspaceId: workspaceId,
      workspaces,
    })
  })

  ipcMain.handle(IPC_CHANNELS.openSshWorkspace, async (_event, candidate) => {
    const request = sshWorkspaceRequestSchema.parse(candidate)
    const target = normalizeSshTarget(request.target)
    const workspaceId = createSshWorkspaceId(target)
    const existingWorkspace = persistedState.workspaces.find((workspace) => workspace.id === workspaceId)
    const workspaces = existingWorkspace
      ? persistedState.workspaces
      : [
          ...persistedState.workspaces,
          {
            id: workspaceId,
            path: workspaceId,
            kind: 'ssh' as const,
            sshTarget: target,
            layout: {
              ...structuredClone(DEFAULT_LAYOUT),
              nodes: [createSshTerminalNode(target)],
            },
          },
        ]

    return persistLayout({
      activeWorkspaceId: workspaceId,
      workspaces,
    })
  })

  ipcMain.handle(IPC_CHANNELS.switchWorkspace, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    const workspace = persistedState.workspaces.find((entry) => entry.id === request.workspaceId)
    if (!workspace) {
      return persistedState
    }

    return persistLayout({
      ...persistedState,
      activeWorkspaceId: workspace.id,
    })
  })

  ipcMain.handle(IPC_CHANNELS.closeWorkspace, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    const closingWorkspace = persistedState.workspaces.find((entry) => entry.id === request.workspaceId)
    if (!closingWorkspace) {
      return persistedState
    }

    const closingSessionIds = closingWorkspace.layout.nodes
      .filter((node) => node.type !== 'editor')
      .map((node) => node.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))

    await Promise.allSettled(closingSessionIds.map((sessionId) => terminalDaemon.close(sessionId)))
    void persistTerminalRegistry()

    const closingIndex = persistedState.workspaces.findIndex((entry) => entry.id === request.workspaceId)
    const workspaces = persistedState.workspaces.filter((entry) => entry.id !== request.workspaceId)
    const activeWorkspaceId =
      persistedState.activeWorkspaceId === request.workspaceId
        ? workspaces[Math.min(closingIndex, workspaces.length - 1)]?.id ?? null
        : persistedState.activeWorkspaceId

    return persistLayout({
      activeWorkspaceId,
      workspaces,
    })
  })

  ipcMain.handle(IPC_CHANNELS.listWorkspaceFiles, async (_event, candidate) => {
    const request = workspaceFileRequestSchema.parse(candidate)
    return listWorkspaceDirectory(request.workspaceId, request.relativePath)
  })

  ipcMain.handle(IPC_CHANNELS.readWorkspaceFile, async (_event, candidate) => {
    const request = workspaceFileRequestSchema.parse(candidate)
    const workspace = getWorkspaceOrThrow(request.workspaceId)
    if (workspace.kind === 'ssh') {
      throw new Error('Remote SSH file browsing is not available yet')
    }
    if (!request.relativePath) {
      throw new Error('Missing file path')
    }
    return readWorkspaceFile(request.workspaceId, request.relativePath)
  })

  ipcMain.handle(IPC_CHANNELS.saveWorkspaceFile, async (_event, candidate) => {
    const request = workspaceFileSaveSchema.parse(candidate)
    const workspace = getWorkspaceOrThrow(request.workspaceId)
    if (workspace.kind === 'ssh') {
      throw new Error('Remote SSH file editing is not available yet')
    }
    return saveWorkspaceFile(request.workspaceId, request.relativePath, request.content)
  })

  ipcMain.handle(IPC_CHANNELS.createWorkspaceFile, async (_event, candidate) => {
    const request = workspaceFileCreateSchema.parse(candidate)
    return createWorkspaceFile(request.workspaceId, request.relativePath, request.type)
  })

  ipcMain.handle(IPC_CHANNELS.renameWorkspacePath, async (_event, candidate) => {
    const request = workspacePathRenameSchema.parse(candidate)
    return renameWorkspacePath(request.workspaceId, request.relativePath, request.nextRelativePath)
  })

  ipcMain.handle(IPC_CHANNELS.deleteWorkspacePath, async (_event, candidate) => {
    const request = workspaceFileRequestSchema.parse(candidate)
    if (!request.relativePath) {
      throw new Error('Missing path to delete')
    }
    deleteWorkspacePath(request.workspaceId, request.relativePath)
  })

  ipcMain.handle(IPC_CHANNELS.duplicateWorkspacePath, async (_event, candidate) => {
    const request = workspaceFileRequestSchema.parse(candidate)
    if (!request.relativePath) {
      throw new Error('Missing path to duplicate')
    }
    return duplicateWorkspacePath(request.workspaceId, request.relativePath)
  })

  ipcMain.handle(IPC_CHANNELS.copyWorkspacePath, async (_event, candidate) => {
    const request = workspaceFileRequestSchema.parse(candidate)
    if (!request.relativePath) {
      throw new Error('Missing path to copy')
    }
    clipboard.writeText(resolveWorkspacePath(request.workspaceId, request.relativePath))
  })

  ipcMain.handle(IPC_CHANNELS.revealWorkspacePath, async (_event, candidate) => {
    const request = workspaceFileRequestSchema.parse(candidate)
    if (!request.relativePath) {
      throw new Error('Missing path to reveal')
    }
    shell.showItemInFolder(resolveWorkspacePath(request.workspaceId, request.relativePath))
  })

  ipcMain.handle(IPC_CHANNELS.searchWorkspaceText, async (_event, candidate) => {
    const request = workspaceTextSearchSchema.parse(candidate)
    return searchWorkspaceText(request.workspaceId, request.query)
  })

  ipcMain.handle(IPC_CHANNELS.replaceWorkspaceText, async (_event, candidate) => {
    const request = workspaceTextReplaceSchema.parse(candidate)
    return replaceWorkspaceText(request.workspaceId, request.query, request.replacement)
  })

  ipcMain.handle(IPC_CHANNELS.listWorkspaceSymbols, async (_event, candidate) => {
    const request = workspaceSymbolRequestSchema.parse(candidate)
    return listWorkspaceSymbols(request.workspaceId, request.query)
  })

  ipcMain.handle(IPC_CHANNELS.saveLayout, async (_event, candidate) => {
    const layout = persistedLayoutSchema.parse(candidate)
    const activeWorkspaceId = persistedState.activeWorkspaceId
    if (!activeWorkspaceId) {
      return persistedState
    }

    return persistLayout({
      ...persistedState,
      workspaces: persistedState.workspaces.map((workspace) =>
        workspace.id === activeWorkspaceId ? { ...workspace, layout } : workspace,
      ),
    })
  })

  ipcMain.handle(IPC_CHANNELS.createTerminal, async (_event, candidate) => {
    const request = createTerminalRequestSchema.parse(candidate)
    const cwd = resolvePreferredCwd({
      requestedCwd: request.cwd,
      workspacePath: getActiveWorkspace()?.path,
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
