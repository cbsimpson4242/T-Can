import { execFile } from 'node:child_process'
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
  gitBranchRequestSchema,
  gitCommitRequestSchema,
  gitFileRequestSchema,
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
} from '../shared/ipc'
import type { GitBlameLine, GitBranchSummary, GitCommitSummary, GitDiffLine, GitFileDiff, GitStatusEntry, PersistedAppState, PersistedWorkspace, TerminalSessionInfo, WorkspaceFileEntry, WorkspaceFileMutationResult, WorkspaceFileReadResult, WorkspaceTaskScript } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let hoverFocusInterval: NodeJS.Timeout | null = null
let store: JsonStore
let persistedState: PersistedAppState
let terminalDaemon: TerminalDaemonClient
const workspaceWatchers = new Map<string, ReturnType<typeof fs.watch>>()
const workspaceWatchDebounceTimers = new Map<string, NodeJS.Timeout>()

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

function isSshCommandForTarget(session: TerminalSessionInfo, target: string): boolean {
  const command = session.command?.split(/[\\/]/).pop()?.toLowerCase()
  return (command === 'ssh' || command === 'ssh.exe') && session.args?.[0] === target
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

function listWorkspaceTasks(workspaceId: string): WorkspaceTaskScript[] {
  assertLocalWorkspace(workspaceId)
  const workspace = getWorkspaceOrThrow(workspaceId)
  const packageJsonPath = path.join(workspace.path, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    return []
  }

  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { scripts?: Record<string, string> }
  const scripts = parsed.scripts ?? {}
  const packageManager: WorkspaceTaskScript['packageManager'] = fs.existsSync(path.join(workspace.path, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : fs.existsSync(path.join(workspace.path, 'yarn.lock'))
      ? 'yarn'
      : 'npm'

  return Object.entries(scripts).map(([name, command]) => ({ name, command, packageManager, cwd: workspace.path }))
}

function runGit(workspaceId: string, args: string[]): Promise<string> {
  const workspace = getWorkspaceOrThrow(workspaceId)
  if (workspace.kind === 'ssh') {
    throw new Error('Git integration is not available for SSH workspaces yet')
  }

  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: workspace.path, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout)
    })
  })
}

function parseGitStatus(output: string): GitStatusEntry[] {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const indexStatus = line[0] ?? ' '
    const workTreeStatus = line[1] ?? ' '
    const rawPath = line.slice(3)
    const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath
    return {
      path: filePath,
      indexStatus,
      workTreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      unstaged: workTreeStatus !== ' ',
      untracked: indexStatus === '?' && workTreeStatus === '?',
      conflicted: indexStatus === 'U' || workTreeStatus === 'U' || indexStatus === 'A' && workTreeStatus === 'A' || indexStatus === 'D' && workTreeStatus === 'D',
    }
  })
}

async function getGitBranches(workspaceId: string): Promise<GitBranchSummary> {
  const output = await runGit(workspaceId, ['branch', '--format=%(refname:short)%(if)%(HEAD)%(then) *%(end)'])
  const branches = output.split(/\r?\n/).filter(Boolean)
  const current = branches.find((branch) => branch.endsWith(' *'))?.replace(/ \*$/, '') ?? null
  const summary: GitBranchSummary = { current, branches: branches.map((branch) => branch.replace(/ \*$/, '')) }

  try {
    const upstream = (await runGit(workspaceId, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
    summary.upstream = upstream || null
    if (upstream) {
      const counts = (await runGit(workspaceId, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])).trim().split(/\s+/).map(Number)
      summary.behind = counts[0] ?? 0
      summary.ahead = counts[1] ?? 0
    }
  } catch {
    summary.upstream = null
    summary.ahead = 0
    summary.behind = 0
  }

  try {
    const lastCommit = await runGit(workspaceId, ['log', '-1', '--date=short', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s'])
    summary.lastCommit = parseGitHistory(lastCommit)[0] ?? null
  } catch {
    summary.lastCommit = null
  }

  return summary
}

function parseGitDiff(pathName: string, staged: boolean, raw: string): GitFileDiff {
  const lines: GitDiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let binary = false

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('Binary files')) {
      binary = true
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      lines.push({ type: 'hunk', content: line })
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      lines.push({ type: 'add', content: line, newLine })
      newLine += 1
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      lines.push({ type: 'delete', content: line, oldLine })
      oldLine += 1
      continue
    }
    lines.push({ type: 'context', content: line, oldLine, newLine })
    if (!line.startsWith('diff --git') && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++')) {
      oldLine += 1
      newLine += 1
    }
  }

  return { path: pathName, staged, binary, lines, raw }
}

function parseGitHistory(output: string): GitCommitSummary[] {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash = '', author = '', date = '', subject = ''] = line.split('\u001f')
    return { hash, author, date, subject }
  })
}

function parseGitBlame(output: string): GitBlameLine[] {
  return output.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const [commit = '', author = '', summary = '', content = ''] = line.split('\u001f')
    return { line: index + 1, commit, author, summary, content }
  })
}

function scheduleWorkspaceChanged(workspaceId: string, changedPath?: string): void {
  const existingTimer = workspaceWatchDebounceTimers.get(workspaceId)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  workspaceWatchDebounceTimers.set(workspaceId, setTimeout(() => {
    workspaceWatchDebounceTimers.delete(workspaceId)
    mainWindow?.webContents.send(IPC_CHANNELS.workspaceChanged, { workspaceId, path: changedPath })
  }, 250))
}

function shouldIgnoreWatchedPath(changedPath: string): boolean {
  return changedPath.split(/[\\/]/).some((part) => IGNORED_FILE_TREE_NAMES.has(part))
}

function refreshWorkspaceWatchers(): void {
  const localWorkspaceIds = new Set(
    persistedState.workspaces
      .filter((workspace) => workspace.kind !== 'ssh')
      .map((workspace) => workspace.id),
  )

  for (const [workspaceId, watcher] of workspaceWatchers) {
    if (!localWorkspaceIds.has(workspaceId)) {
      watcher.close()
      workspaceWatchers.delete(workspaceId)
    }
  }

  for (const workspace of persistedState.workspaces) {
    if (workspace.kind === 'ssh' || workspaceWatchers.has(workspace.id) || !fs.existsSync(workspace.path)) {
      continue
    }

    try {
      const watcher = fs.watch(workspace.path, { recursive: true }, (_eventType, filename) => {
        const changedPath = filename?.toString().replace(/\\/g, '/')
        if (changedPath && shouldIgnoreWatchedPath(changedPath)) {
          return
        }
        scheduleWorkspaceChanged(workspace.id, changedPath)
      })
      watcher.on('error', (error) => {
        process.stderr.write(`[T-CAN] Workspace watcher failed for ${workspace.path}: ${error.message}\n`)
        workspaceWatchers.delete(workspace.id)
      })
      workspaceWatchers.set(workspace.id, watcher)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[T-CAN] Unable to watch workspace ${workspace.path}: ${message}\n`)
    }
  }
}

function closeWorkspaceWatchers(): void {
  for (const watcher of workspaceWatchers.values()) {
    watcher.close()
  }
  workspaceWatchers.clear()
  for (const timer of workspaceWatchDebounceTimers.values()) {
    clearTimeout(timer)
  }
  workspaceWatchDebounceTimers.clear()
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

  refreshWorkspaceWatchers()
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

    const closingSessionIds = new Set(
      closingWorkspace.layout.nodes
        .filter((node) => node.type !== 'editor' && node.type !== 'source-control')
        .map((node) => node.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    )

    if (closingWorkspace.kind === 'ssh' && closingWorkspace.sshTarget) {
      const sessions = await terminalDaemon.listSessions()
      for (const session of sessions) {
        if (isSshCommandForTarget(session, closingWorkspace.sshTarget)) {
          closingSessionIds.add(session.sessionId)
        }
      }
    }

    await Promise.allSettled([...closingSessionIds].map((sessionId) => terminalDaemon.close(sessionId)))
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

  ipcMain.handle(IPC_CHANNELS.listWorkspaceTasks, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    return listWorkspaceTasks(request.workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.getGitStatus, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    return parseGitStatus(await runGit(request.workspaceId, ['status', '--porcelain=v1']))
  })

  ipcMain.handle(IPC_CHANNELS.getGitBranches, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    return getGitBranches(request.workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.gitStage, async (_event, candidate) => {
    const request = gitFileRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['add', '--', request.filePath])
  })

  ipcMain.handle(IPC_CHANNELS.gitUnstage, async (_event, candidate) => {
    const request = gitFileRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['restore', '--staged', '--', request.filePath])
  })

  ipcMain.handle(IPC_CHANNELS.gitDiscard, async (_event, candidate) => {
    const request = gitFileRequestSchema.parse(candidate)
    const status = parseGitStatus(await runGit(request.workspaceId, ['status', '--porcelain=v1', '--', request.filePath]))[0]
    if (status?.untracked) {
      fs.rmSync(resolveWorkspacePath(request.workspaceId, request.filePath), { recursive: true, force: true })
      return
    }
    await runGit(request.workspaceId, request.staged ? ['restore', '--staged', '--worktree', '--', request.filePath] : ['restore', '--worktree', '--', request.filePath])
  })

  ipcMain.handle(IPC_CHANNELS.gitDiscardAll, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['reset', '--hard'])
    await runGit(request.workspaceId, ['clean', '-fd'])
  })

  ipcMain.handle(IPC_CHANNELS.gitCommit, async (_event, candidate) => {
    const request = gitCommitRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['commit', '-m', request.message])
  })

  ipcMain.handle(IPC_CHANNELS.gitPush, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['push'])
  })

  ipcMain.handle(IPC_CHANNELS.gitPull, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['pull', '--ff-only'])
  })

  ipcMain.handle(IPC_CHANNELS.gitFetch, async (_event, candidate) => {
    const request = workspaceRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['fetch', '--all', '--prune'])
  })

  ipcMain.handle(IPC_CHANNELS.gitCheckoutBranch, async (_event, candidate) => {
    const request = gitBranchRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['checkout', request.branch])
  })

  ipcMain.handle(IPC_CHANNELS.gitCreateBranch, async (_event, candidate) => {
    const request = gitBranchRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['checkout', '-b', request.branch])
  })

  ipcMain.handle(IPC_CHANNELS.gitDeleteBranch, async (_event, candidate) => {
    const request = gitBranchRequestSchema.parse(candidate)
    await runGit(request.workspaceId, ['branch', '-d', request.branch])
  })

  ipcMain.handle(IPC_CHANNELS.getGitFileDiff, async (_event, candidate) => {
    const request = gitFileRequestSchema.parse(candidate)
    const args = request.staged ? ['diff', '--staged', '--', request.filePath] : ['diff', '--', request.filePath]
    return parseGitDiff(request.filePath, request.staged, await runGit(request.workspaceId, args))
  })

  ipcMain.handle(IPC_CHANNELS.getGitFileHistory, async (_event, candidate) => {
    const request = gitFileRequestSchema.parse(candidate)
    const output = await runGit(request.workspaceId, ['log', '--date=short', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s', '--', request.filePath])
    return parseGitHistory(output)
  })

  ipcMain.handle(IPC_CHANNELS.getGitBlame, async (_event, candidate) => {
    const request = gitFileRequestSchema.parse(candidate)
    const output = await runGit(request.workspaceId, ['blame', '--line-porcelain', '--', request.filePath])
    const lines = output.split(/\r?\n/)
    const compact = lines.flatMap((line, index) => line.startsWith('\t') ? [`${lines[index - 10]?.split(' ')[0] ?? ''}\u001f${lines[index - 4]?.replace('author ', '') ?? ''}\u001f${lines[index - 1]?.replace('summary ', '') ?? ''}\u001f${line.slice(1)}`] : [])
    return parseGitBlame(compact.join('\n'))
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
  refreshWorkspaceWatchers()
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
  closeWorkspaceWatchers()
  void terminalDaemon.shutdownIfIdle()
  void persistTerminalRegistry()
})
