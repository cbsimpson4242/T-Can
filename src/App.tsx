import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent as ReactFormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import './App.css'
import type { CanvasNode, EditorTab, GitBranchSummary, GitFileDiff, GitStatusEntry, NodeResizeDirection, PersistedAppState, PersistedLayout, PersistedWorkspace, ProblemMatch, TerminalNode as TerminalNodeModel, TerminalSessionSnapshot, Viewport, WorkspaceFileEntry, WorkspaceTaskScript } from '../shared/types'
import { EditorNode } from './components/EditorNode'
import { FileExplorer } from './components/FileExplorer'
import { TerminalNode } from './components/TerminalNode'
import {
  clampNodeSize,
  createCanvasRect,
  createEditorNode,
  createSourceControlNode,
  createTerminalNode,
  getNodeCanvasRect,
  getViewportCenterWorldPoint,
  rectanglesIntersect,
  snapCanvasZoomViewport,
} from './lib/layout'

type ActiveNode = CanvasNode

interface SelectionBox {
  x: number
  y: number
  width: number
  height: number
}

interface CanvasContextMenuState {
  x: number
  y: number
}

const DUPLICATE_NODE_OFFSET = 45

interface GitPanelState {
  status: GitStatusEntry[]
  branches: GitBranchSummary | null
  selectedPath: string | null
  selectedDiffStaged: boolean
  diff: GitFileDiff | null
  diffMode: 'inline' | 'side-by-side'
  commitMessage: string
  loading: boolean
  error: string | null
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }
const PROBLEM_PATTERN = /(?<path>(?:[A-Za-z]:)?[^\s:()]+\.[A-Za-z0-9]+)[:(](?<line>\d+)(?::(?<column>\d+))?[):]?\s*(?<message>.*)$/
const SELECTION_DRAG_THRESHOLD = 4
const RESIZE_DIRECTIONS: NodeResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

function getWorkspaceName(workspacePath: string): string {
  if (workspacePath.startsWith('ssh://')) {
    return workspacePath.slice('ssh://'.length)
  }

  return workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
}

function getFileTitle(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function getFileDirectory(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function getFileExtensionBadge(filePath: string): string {
  const title = getFileTitle(filePath)
  const extension = title.includes('.') ? title.split('.').pop() : title.slice(0, 2)
  return (extension || 'file').slice(0, 3).toUpperCase()
}

function createEditorTab(filePath: string): EditorTab {
  return { filePath, title: getFileTitle(filePath) }
}

function joinWorkspacePath(parentPath: string, name: string): string {
  return [parentPath, name].filter(Boolean).join('/').replace(/\\/g, '/')
}

function normalizeProblemPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '')
}

function parseProblemLine(data: string, sessionId?: string): ProblemMatch[] {
  return data.split(/\r?\n/).flatMap((line, index) => {
    const match = PROBLEM_PATTERN.exec(line)
    if (!match?.groups?.path || !match.groups.line) {
      return []
    }
    const message = match.groups.message || line.trim()
    const lowerMessage = message.toLowerCase()
    return [{
      id: `${sessionId ?? 'terminal'}:${Date.now()}:${index}:${match.groups.path}:${match.groups.line}`,
      source: 'terminal',
      message,
      relativePath: normalizeProblemPath(match.groups.path),
      line: Number(match.groups.line),
      column: match.groups.column ? Number(match.groups.column) : undefined,
      severity: lowerMessage.includes('warn') ? 'warning' : lowerMessage.includes('info') ? 'info' : 'error',
      sessionId,
    }]
  })
}

function getActiveWorkspace(state: Pick<PersistedAppState, 'activeWorkspaceId' | 'workspaces'>): PersistedWorkspace | null {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null
}

function getApi() {
  if (!window.tcan) {
    throw new Error('T-CAN preload API is unavailable. Rebuild the Electron bundles and restart the app.')
  }

  return window.tcan
}

function isSshSessionForTarget(session: TerminalSessionSnapshot, target: string): boolean {
  const command = session.info.command?.split(/[\\/]/).pop()?.toLowerCase()
  return (command === 'ssh' || command === 'ssh.exe') && session.info.args?.[0] === target
}

function hasSelectionModifier(event: Pick<PointerEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey
}

function toggleSelection(currentIds: string[], nodeIds: string[]): string[] {
  const nextIds = new Set(currentIds)

  for (const nodeId of nodeIds) {
    if (nextIds.has(nodeId)) {
      nextIds.delete(nodeId)
    } else {
      nextIds.add(nodeId)
    }
  }

  return [...nextIds]
}

function App() {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const isRestoringWorkspaceRef = useRef(false)
  const closingWorkspaceIdsRef = useRef(new Set<string>())
  const [workspaces, setWorkspaces] = useState<PersistedWorkspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  )
  const workspacePath = activeWorkspace?.path ?? null
  const [nodes, setNodes] = useState<ActiveNode[]>([])
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false)
  const [closingWorkspaceId, setClosingWorkspaceId] = useState<string | null>(null)
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false)
  const [isKillingTerminals, setIsKillingTerminals] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [fileEntries, setFileEntries] = useState<WorkspaceFileEntry[]>([])
  const [dirtyEditorPathsByNode, setDirtyEditorPathsByNode] = useState<Record<string, string[]>>({})
  const [saveSignal, setSaveSignal] = useState(0)
  const [saveAllSignal, setSaveAllSignal] = useState(0)
  const [autoSave, setAutoSave] = useState(false)
  const [externalRefreshSignal, setExternalRefreshSignal] = useState(0)
  const [workspaceTasks, setWorkspaceTasks] = useState<WorkspaceTaskScript[]>([])
  const [problems, setProblems] = useState<ProblemMatch[]>([])
  const [isTerminalManagerOpen, setIsTerminalManagerOpen] = useState(false)
  const [gitPanel, setGitPanel] = useState<GitPanelState>({ status: [], branches: null, selectedPath: null, selectedDiffStaged: false, diff: null, diffMode: 'inline', commitMessage: '', loading: false, error: null })
  const [isSshDialogOpen, setIsSshDialogOpen] = useState(false)
  const [sshHostInput, setSshHostInput] = useState('example.com')
  const [sshUsernameInput, setSshUsernameInput] = useState('user')
  const [sshPasswordInput, setSshPasswordInput] = useState('')
  const [sshPasswords, setSshPasswords] = useState<Record<string, string>>({})
  const [isCanvasPanning, setIsCanvasPanning] = useState(false)

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const dirtyEditorPathCount = useMemo(
    () => Object.values(dirtyEditorPathsByNode).reduce((count, paths) => count + paths.length, 0),
    [dirtyEditorPathsByNode],
  )
  const terminalNodes = useMemo(() => nodes.filter((node): node is TerminalNodeModel => node.type === 'terminal'), [nodes])
  const terminalNodeCount = terminalNodes.length

  const layout = useMemo<PersistedLayout>(
    () => ({
      nodes: nodes.map((node) => {
        if (node.type === 'editor') {
          return {
            id: node.id,
            type: node.type,
            title: node.title,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            filePath: node.filePath,
            language: node.language,
            tabs: node.tabs,
            activeFilePath: node.activeFilePath,
          }
        }

        if (node.type === 'source-control') {
          return {
            id: node.id,
            type: node.type,
            title: node.title,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          }
        }

        return {
          id: node.id,
          type: node.type,
          title: node.title,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          sessionId: node.sessionId,
          shell: node.shell,
          sshTarget: node.sshTarget,
          cwd: node.cwd,
          taskName: node.taskName,
        }
      }),
      viewport,
    }),
    [nodes, viewport],
  )

  async function restoreWorkspaceLayout(workspace: PersistedWorkspace | null): Promise<void> {
    isRestoringWorkspaceRef.current = true
    try {
      if (!workspace) {
        setViewport(DEFAULT_VIEWPORT)
        setNodes([])
        setSelectedNodeIds([])
        setDirtyEditorPathsByNode({})
        return
      }

      const api = getApi()
      setViewport(workspace.layout.viewport)
      setSelectedNodeIds([])
      setDirtyEditorPathsByNode({})

      const restoredNodes = await Promise.all(
        workspace.layout.nodes.map(async (node) => {
          if (node.type === 'editor' || node.type === 'source-control') {
            return node
          }

          const sshTarget = workspace.kind === 'ssh' ? node.sshTarget ?? workspace.sshTarget : undefined

          if (node.sessionId) {
            const existingSession = await api.getTerminalSession(node.sessionId)
            if (existingSession) {
              if (!sshTarget || isSshSessionForTarget(existingSession, sshTarget)) {
                return { ...node, shell: existingSession.info.shell, cwd: existingSession.info.cwd }
              }

              await api.closeTerminal(node.sessionId)
            }
          }

          const session = sshTarget
            ? await api.createTerminal({ cwd: null, command: 'ssh', args: [sshTarget] })
            : await api.createTerminal({ cwd: workspace.path })
          return { ...node, type: 'terminal' as const, sessionId: session.sessionId, shell: session.shell, sshTarget, cwd: session.cwd }
        }),
      )

      setNodes(restoredNodes)
    } finally {
      window.setTimeout(() => {
        isRestoringWorkspaceRef.current = false
      })
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const usesCommandModifier = event.ctrlKey || event.metaKey
      if (usesCommandModifier && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (event.shiftKey) {
          setSaveAllSignal((current) => current + 1)
        } else {
          setSaveSignal((current) => current + 1)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyEditorPathCount === 0) {
        return
      }
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirtyEditorPathCount])

  useEffect(() => {
    if (!canvasContextMenu) {
      return
    }

    const closeContextMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.canvas-context-menu')) {
        return
      }
      setCanvasContextMenu(null)
    }

    const closeContextMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCanvasContextMenu(null)
      }
    }

    document.addEventListener('pointerdown', closeContextMenu)
    window.addEventListener('keydown', closeContextMenuOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeContextMenu)
      window.removeEventListener('keydown', closeContextMenuOnEscape)
    }
  }, [canvasContextMenu])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const api = getApi()
        const state = await api.getAppState()
        if (cancelled) {
          return
        }

        setWorkspaces(state.workspaces)
        setActiveWorkspaceId(state.activeWorkspaceId)
        await restoreWorkspaceLayout(getActiveWorkspace(state))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        window.alert(`Unable to initialize T-CAN.\n\n${message}`)
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  async function refreshFileTree(silent = false) {
    if (!activeWorkspaceId || activeWorkspace?.kind === 'ssh') {
      setFileEntries([])
      return
    }

    setIsLoadingFiles(true)
    try {
      const entries = await getApi().listWorkspaceFiles(activeWorkspaceId)
      setFileEntries(entries)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (silent) {
        console.warn(`Unable to load workspace files: ${message}`)
      } else {
        window.alert(`Unable to load workspace files.\n\n${message}`)
      }
    } finally {
      setIsLoadingFiles(false)
    }
  }

  function handleOpenFileFromExplorer(relativePath: string) {
    const existingNode = nodes.find((node) => node.type === 'editor' && (node.filePath === relativePath || node.tabs?.some((tab) => tab.filePath === relativePath)))
    if (existingNode?.type === 'editor') {
      handleEditorTabsChange(existingNode.id, existingNode.tabs ?? [createEditorTab(existingNode.filePath)], relativePath)
      setSelectedNodeIds([existingNode.id])
      return
    }

    const selectedEditor = nodes.find((node) => node.type === 'editor' && selectedNodeIdSet.has(node.id))
    if (selectedEditor?.type === 'editor') {
      const tabs = selectedEditor.tabs ?? [createEditorTab(selectedEditor.filePath)]
      const nextTabs = tabs.some((tab) => tab.filePath === relativePath) ? tabs : [...tabs, createEditorTab(relativePath)]
      handleEditorTabsChange(selectedEditor.id, nextTabs, relativePath)
      return
    }

    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    const node = createEditorNode(getViewportCenterWorldPoint(viewport, bounds), relativePath)
    setNodes((current) => [...current, node])
    setSelectedNodeIds([node.id])
  }

  async function mutateWorkspaceFiles(action: () => Promise<void>) {
    try {
      await action()
      await refreshFileTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Workspace file operation failed.\n\n${message}`)
    }
  }

  function promptForChildPath(parentPath: string, type: 'file' | 'directory'): string | null {
    const label = type === 'directory' ? 'folder' : 'file'
    const name = window.prompt(`New ${label} name`, type === 'directory' ? 'new-folder' : 'new-file.txt')?.trim()
    if (!name) {
      return null
    }
    return joinWorkspacePath(parentPath, name)
  }

  function handleCreateWorkspacePath(parentPath: string, type: 'file' | 'directory') {
    if (!activeWorkspaceId) {
      return
    }
    const relativePath = promptForChildPath(parentPath, type)
    if (!relativePath) {
      return
    }
    void mutateWorkspaceFiles(async () => {
      await getApi().createWorkspaceFile(activeWorkspaceId, relativePath, type)
      if (type === 'file') {
        handleOpenFileFromExplorer(relativePath)
      }
    })
  }

  function handleRenameWorkspacePath(relativePath: string) {
    if (!activeWorkspaceId) {
      return
    }
    const nextRelativePath = window.prompt('Rename path', relativePath)?.trim()
    if (!nextRelativePath || nextRelativePath === relativePath) {
      return
    }
    void mutateWorkspaceFiles(async () => {
      await getApi().renameWorkspacePath(activeWorkspaceId, relativePath, nextRelativePath)
      setNodes((current) => current.map((node) => {
        if (node.type !== 'editor') {
          return node
        }
        const tabs = (node.tabs ?? [createEditorTab(node.filePath)]).map((tab) => (
          tab.filePath === relativePath ? { ...tab, filePath: nextRelativePath, title: getFileTitle(nextRelativePath) } : tab
        ))
        return {
          ...node,
          filePath: node.filePath === relativePath ? nextRelativePath : node.filePath,
          title: node.filePath === relativePath ? getFileTitle(nextRelativePath) : node.title,
          tabs,
          activeFilePath: node.activeFilePath === relativePath ? nextRelativePath : node.activeFilePath,
        }
      }))
    })
  }

  function handleDeleteWorkspacePath(relativePath: string) {
    const hasUnsavedOpenFile = Object.values(dirtyEditorPathsByNode).some((paths) => paths.includes(relativePath))
    if (hasUnsavedOpenFile && !window.confirm(`${relativePath} has unsaved edits in an open editor. Delete it anyway?`)) {
      return
    }
    if (!activeWorkspaceId || !window.confirm(`Delete ${relativePath}? This cannot be undone.`)) {
      return
    }
    void mutateWorkspaceFiles(async () => {
      await getApi().deleteWorkspacePath(activeWorkspaceId, relativePath)
      setNodes((current) => current.filter((node) => node.type !== 'editor' || (node.filePath !== relativePath && !node.tabs?.some((tab) => tab.filePath === relativePath))))
    })
  }

  function handleDuplicateWorkspacePath(relativePath: string) {
    if (!activeWorkspaceId) {
      return
    }
    void mutateWorkspaceFiles(async () => {
      const result = await getApi().duplicateWorkspacePath(activeWorkspaceId, relativePath)
      if (result.entry?.type === 'file') {
        handleOpenFileFromExplorer(result.relativePath)
      }
    })
  }

  function handleCopyWorkspacePath(relativePath: string) {
    if (!activeWorkspaceId) {
      return
    }
    void mutateWorkspaceFiles(async () => {
      await getApi().copyWorkspacePath(activeWorkspaceId, relativePath)
    })
  }

  function handleRevealWorkspacePath(relativePath: string) {
    if (!activeWorkspaceId) {
      return
    }
    void mutateWorkspaceFiles(async () => {
      await getApi().revealWorkspacePath(activeWorkspaceId, relativePath)
    })
  }

  async function refreshWorkspaceTasks() {
    if (!activeWorkspaceId || activeWorkspace?.kind === 'ssh') {
      setWorkspaceTasks([])
      return
    }
    try {
      setWorkspaceTasks(await getApi().listWorkspaceTasks(activeWorkspaceId))
    } catch {
      setWorkspaceTasks([])
    }
  }

  useEffect(() => {
    queueMicrotask(() => void refreshFileTree())
    queueMicrotask(() => void refreshWorkspaceTasks())
    // refreshFileTree/refreshWorkspaceTasks intentionally read the latest active workspace state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!window.tcan?.onWorkspaceChanged || !activeWorkspaceId || activeWorkspace?.kind === 'ssh') {
      return
    }

    let timeoutId: number | null = null
    const hasSourceControlNode = nodes.some((node) => node.type === 'source-control')

    const unsubscribe = window.tcan.onWorkspaceChanged((event) => {
      if (event.workspaceId !== activeWorkspaceId) {
        return
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = null
        setExternalRefreshSignal((current) => current + 1)
        void refreshFileTree(true)
        void refreshWorkspaceTasks()
        if (hasSourceControlNode) {
          void refreshGitPanel()
        }
      }, 300)
    })

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      unsubscribe()
    }
    // Refresh helpers intentionally read the latest active workspace state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, activeWorkspace?.kind, nodes])

  useEffect(() => {
    if (!window.tcan?.onTerminalOutput) {
      return
    }

    return window.tcan.onTerminalOutput(({ sessionId, data }) => {
      const nextProblems = parseProblemLine(data, sessionId)
      if (nextProblems.length === 0) {
        return
      }
      setProblems((current) => [...nextProblems, ...current].slice(0, 300))
    })
  }, [])

  useEffect(() => {
    if (isBootstrapping || isRestoringWorkspaceRef.current || !activeWorkspaceId) {
      return
    }

    setWorkspaces((current) =>
      current.map((workspace) => (workspace.id === activeWorkspaceId ? { ...workspace, layout } : workspace)),
    )
    void getApi().saveLayout(layout)
  }, [activeWorkspaceId, isBootstrapping, layout])

  function confirmDiscardUnsavedChanges(action: string): boolean {
    return dirtyEditorPathCount === 0 || window.confirm(`${action} with ${dirtyEditorPathCount} unsaved file${dirtyEditorPathCount === 1 ? '' : 's'}? Unsaved edits will be discarded.`)
  }

  async function handleOpenWorkspace() {
    if (!confirmDiscardUnsavedChanges('Open another workspace')) {
      return
    }

    setIsOpeningWorkspace(true)
    try {
      if (activeWorkspaceId) {
        await getApi().saveLayout(layout)
      }
      const nextState = await getApi().openWorkspace()
      setWorkspaces(nextState.workspaces)
      setActiveWorkspaceId(nextState.activeWorkspaceId)
      await restoreWorkspaceLayout(getActiveWorkspace(nextState))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to open a workspace.\n\n${message}`)
    } finally {
      setIsOpeningWorkspace(false)
    }
  }

  function openSshDialog() {
    if (isOpeningWorkspace) {
      return
    }

    setIsSshDialogOpen(true)
  }

  function closeSshDialog() {
    if (isOpeningWorkspace) {
      return
    }

    setIsSshDialogOpen(false)
  }

  async function handleSshDialogSubmit(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault()
    const host = sshHostInput.trim()
    const username = sshUsernameInput.trim()
    const target = username ? `${username}@${host}` : host
    if (!host) {
      return
    }

    await handleOpenSshWorkspace(target, sshPasswordInput)
  }

  async function handleOpenSshWorkspace(target: string, password = '') {
    if (!confirmDiscardUnsavedChanges('Open SSH workspace')) {
      return
    }

    setIsOpeningWorkspace(true)
    try {
      if (activeWorkspaceId) {
        await getApi().saveLayout(layout)
      }
      const nextState = await getApi().openSshWorkspace(target)
      if (password) {
        setSshPasswords((current) => ({ ...current, [target]: password }))
      }
      setWorkspaces(nextState.workspaces)
      setActiveWorkspaceId(nextState.activeWorkspaceId)
      setIsSshDialogOpen(false)
      setSshPasswordInput('')
      await restoreWorkspaceLayout(getActiveWorkspace(nextState))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to open SSH workspace.\n\n${message}`)
    } finally {
      setIsOpeningWorkspace(false)
    }
  }

  async function handleSwitchWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) {
      return
    }

    if (!confirmDiscardUnsavedChanges('Switch workspaces')) {
      return
    }

    try {
      if (activeWorkspaceId) {
        await getApi().saveLayout(layout)
      }
      const nextState = await getApi().switchWorkspace(workspaceId)
      setWorkspaces(nextState.workspaces)
      setActiveWorkspaceId(nextState.activeWorkspaceId)
      await restoreWorkspaceLayout(getActiveWorkspace(nextState))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to switch workspace.\n\n${message}`)
    }
  }

  async function handleCloseWorkspace(workspaceId: string) {
    if (closingWorkspaceIdsRef.current.has(workspaceId)) {
      return
    }

    const workspace = workspaces.find((entry) => entry.id === workspaceId)
    if (!workspace) {
      return
    }

    closingWorkspaceIdsRef.current.add(workspaceId)

    try {
      const terminalCount = workspaceId === activeWorkspaceId
        ? terminalNodeCount
        : workspace.layout.nodes.filter((node) => node.type === 'terminal').length
      const message = terminalCount
        ? `Close workspace "${getWorkspaceName(workspace.path)}" and terminate ${terminalCount} terminal${terminalCount === 1 ? '' : 's'}?`
        : `Close workspace "${getWorkspaceName(workspace.path)}"?`

      if (workspaceId === activeWorkspaceId && dirtyEditorPathCount > 0 && !window.confirm(`Close workspace with ${dirtyEditorPathCount} unsaved file${dirtyEditorPathCount === 1 ? '' : 's'}?`)) {
        return
      }

      if (!window.confirm(message)) {
        return
      }

      setClosingWorkspaceId(workspaceId)
      if (activeWorkspaceId) {
        await getApi().saveLayout(layout)
      }
      const nextState = await getApi().closeWorkspace(workspaceId)
      setWorkspaces(nextState.workspaces)
      setActiveWorkspaceId(nextState.activeWorkspaceId)
      await restoreWorkspaceLayout(getActiveWorkspace(nextState))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to close workspace.\n\n${message}`)
    } finally {
      closingWorkspaceIdsRef.current.delete(workspaceId)
      setClosingWorkspaceId(null)
    }
  }

  const handleSshPasswordCaptured = useCallback((target: string, password: string) => {
    setSshPasswords((current) => current[target] === password ? current : { ...current, [target]: password })
  }, [])

  async function createTerminalAtCenter(options: { title?: string; cwd?: string | null; command?: string; args?: string[]; taskName?: string; offset?: { x: number; y: number } } = {}) {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return null
    }

    const position = getViewportCenterWorldPoint(viewport, bounds)
    const node = createTerminalNode({ x: position.x + (options.offset?.x ?? 0), y: position.y + (options.offset?.y ?? 0) })
    const sshTarget = activeWorkspace?.kind === 'ssh' ? activeWorkspace.sshTarget : undefined
    const session = sshTarget
      ? await getApi().createTerminal({ cwd: null, command: 'ssh', args: [sshTarget] })
      : await getApi().createTerminal({ cwd: options.cwd ?? workspacePath, command: options.command, args: options.args })
    const terminalNode = {
      ...node,
      title: options.title ?? (sshTarget ? `SSH ${sshTarget}` : node.title),
      sessionId: session.sessionId,
      shell: session.shell,
      sshTarget,
      cwd: session.cwd,
      taskName: options.taskName,
    }
    setNodes((current) => [...current, terminalNode])
    setSelectedNodeIds([node.id])
    return terminalNode
  }

  async function handleCreateTerminal() {
    setIsCreatingTerminal(true)
    try {
      await createTerminalAtCenter()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to create a terminal.\n\n${message}`)
    } finally {
      setIsCreatingTerminal(false)
    }
  }

  async function handleRunTask(task: WorkspaceTaskScript) {
    try {
      const terminalNode = await createTerminalAtCenter({
        title: `Task ${task.name}`,
        cwd: task.cwd,
        taskName: task.name,
        offset: { x: 30, y: 30 },
      })
      if (terminalNode?.sessionId) {
        await getApi().writeTerminal(terminalNode.sessionId, `${task.packageManager} run ${task.name}\r`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to run task.\n\n${message}`)
    }
  }

  async function handleDuplicateTerminal(node: TerminalNodeModel) {
    try {
      await createTerminalAtCenter({ title: `${node.title} copy`, cwd: node.cwd ?? workspacePath, offset: { x: DUPLICATE_NODE_OFFSET, y: DUPLICATE_NODE_OFFSET } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to duplicate terminal.\n\n${message}`)
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  function stripTerminalControlSequences(input: string): string {
    return input
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
      .replace(/[\b\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  }

  function isWaitingForPassword(output: string): boolean {
    return /(?:password|passphrase)(?:\s+for\s+[^:\r\n]+|[^:\r\n]*)?:\s*$/i.test(stripTerminalControlSequences(output))
  }

  async function launchAgentCommandWhenReady(sessionId: string, agentCommandLine: string, sshTarget?: string): Promise<void> {
    await delay(sshTarget ? 3500 : 350)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const snapshot = await getApi().getTerminalSession(sessionId)
      if (!snapshot) {
        await delay(250)
        continue
      }

      if (!sshTarget || !isWaitingForPassword(snapshot.output)) {
        await getApi().writeTerminal(sessionId, `${agentCommandLine}\r`)
        return
      }

      await delay(750)
    }

    await getApi().writeTerminal(sessionId, `${agentCommandLine}\r`)
  }

  async function createDuplicateTerminalNodes(sourceNodes: TerminalNodeModel[], offset: { x: number; y: number }) {
    const duplicatedNodes: TerminalNodeModel[] = []

    for (const node of sourceNodes) {
      const sourceSession = node.sessionId ? await getApi().getTerminalSession(node.sessionId) : null
      const agentCommandLine = sourceSession?.info.agentCommandLine
      const sshTarget = node.sshTarget ?? (activeWorkspace?.kind === 'ssh' ? activeWorkspace.sshTarget : undefined)
      const session = sshTarget
        ? await getApi().createTerminal({ cwd: null, command: 'ssh', args: [sshTarget] })
        : await getApi().createTerminal({ cwd: node.cwd ?? workspacePath })

      if (agentCommandLine) {
        void launchAgentCommandWhenReady(session.sessionId, agentCommandLine, sshTarget)
      }

      duplicatedNodes.push({
        ...createTerminalNode({ x: node.x + offset.x, y: node.y + offset.y }),
        title: `${node.title} copy`,
        width: node.width,
        height: node.height,
        sessionId: session.sessionId,
        shell: session.shell,
        sshTarget,
        cwd: session.cwd,
        taskName: node.taskName,
      })
    }

    return duplicatedNodes
  }

  async function handleDuplicateSelectedNodes() {
    const sourceNodes = nodes.filter((node) => selectedNodeIdSet.has(node.id) && (node.type === 'editor' || node.type === 'terminal' || !node.type))
    if (!sourceNodes.length) {
      return
    }

    try {
      const editorNodes = sourceNodes.filter((node) => node.type === 'editor')
      const terminalSourceNodes = sourceNodes.filter((node): node is TerminalNodeModel => node.type === 'terminal' || !node.type)
      const duplicatedEditors = editorNodes.map((node) => ({
        ...createEditorNode({ x: node.x + DUPLICATE_NODE_OFFSET, y: node.y + DUPLICATE_NODE_OFFSET }, node.activeFilePath ?? node.filePath),
        title: `${node.title} copy`,
        filePath: node.filePath,
        language: node.language,
        tabs: node.tabs?.map((tab) => ({ ...tab })),
        activeFilePath: node.activeFilePath,
        width: node.width,
        height: node.height,
      }))
      const duplicatedTerminals = await createDuplicateTerminalNodes(terminalSourceNodes, { x: DUPLICATE_NODE_OFFSET, y: DUPLICATE_NODE_OFFSET })
      const duplicatedNodes = [...duplicatedEditors, ...duplicatedTerminals]

      setNodes((current) => [...current, ...duplicatedNodes])
      setSelectedNodeIds(duplicatedNodes.map((node) => node.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to duplicate selected windows.\n\n${message}`)
    }
  }

  async function handleRestartTerminal(node: TerminalNodeModel) {
    if (node.sessionId) {
      await getApi().closeTerminal(node.sessionId)
    }
    const sshTarget = activeWorkspace?.kind === 'ssh' ? node.sshTarget ?? activeWorkspace.sshTarget : undefined
    const session = sshTarget
      ? await getApi().createTerminal({ cwd: null, command: 'ssh', args: [sshTarget] })
      : await getApi().createTerminal({ cwd: node.cwd ?? workspacePath })
    setNodes((current) => current.map((entry) => entry.id === node.id ? { ...node, sessionId: session.sessionId, shell: session.shell, cwd: session.cwd } : entry))
  }

  function handleRenameTerminal(node: TerminalNodeModel) {
    const title = window.prompt('Terminal name', node.title)?.trim()
    if (!title) {
      return
    }
    setNodes((current) => current.map((entry) => entry.id === node.id ? { ...entry, title } : entry))
  }

  function handleEditorDirtyChange(nodeId: string, dirtyPaths: string[]) {
    setDirtyEditorPathsByNode((current) => {
      const currentPaths = current[nodeId] ?? []
      const isUnchanged = currentPaths.length === dirtyPaths.length && currentPaths.every((filePath, index) => filePath === dirtyPaths[index])
      if (isUnchanged) {
        return current
      }
      if (dirtyPaths.length === 0) {
        const next = { ...current }
        delete next[nodeId]
        return next
      }
      return { ...current, [nodeId]: dirtyPaths }
    })
  }

  function handleEditorTabsChange(nodeId: string, tabs: EditorTab[], activeFilePath: string) {
    const activeTab = tabs.find((tab) => tab.filePath === activeFilePath) ?? tabs[0]
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId || node.type !== 'editor') {
        return node
      }
      return {
        ...node,
        title: activeTab?.title ?? node.title,
        filePath: activeTab?.filePath ?? node.filePath,
        language: activeTab?.language ?? node.language,
        tabs,
        activeFilePath: activeTab?.filePath ?? activeFilePath,
      }
    }))
    setSelectedNodeIds([nodeId])
  }

  function handleSplitEditor(filePath: string) {
    const sourceNode = nodes.find((node) => node.type === 'editor' && selectedNodeIdSet.has(node.id))
    const position = sourceNode ? { x: sourceNode.x + 40, y: sourceNode.y + 40 } : null
    const bounds = canvasRef.current?.getBoundingClientRect()
    const node = createEditorNode(position ?? (bounds ? getViewportCenterWorldPoint(viewport, bounds) : { x: 80, y: 80 }), filePath)
    setNodes((current) => [...current, node])
    setSelectedNodeIds([node.id])
  }

  async function removeNode(nodeId: string) {
    const dirtyPaths = dirtyEditorPathsByNode[nodeId] ?? []
    if (dirtyPaths.length > 0 && !window.confirm(`Close editor with ${dirtyPaths.length} unsaved file${dirtyPaths.length === 1 ? '' : 's'}?`)) {
      return
    }

    setNodes((current) => {
      const node = current.find((entry) => entry.id === nodeId)
      if (node && (node.type === 'terminal' || !node.type) && node.sessionId) {
        void getApi().closeTerminal(node.sessionId)
      }
      return current.filter((entry) => entry.id !== nodeId)
    })
    setDirtyEditorPathsByNode((current) => {
      const next = { ...current }
      delete next[nodeId]
      return next
    })
    setSelectedNodeIds((current) => current.filter((entry) => entry !== nodeId))
  }

  async function removeTerminalSelection(clickedNodeId: string) {
    const terminalIdsToClose = nodes
      .filter((node): node is TerminalNodeModel => (node.type === 'terminal' || !node.type) && (selectedNodeIdSet.has(clickedNodeId) ? selectedNodeIdSet.has(node.id) : node.id === clickedNodeId))
      .map((node) => node.id)

    if (terminalIdsToClose.length <= 1) {
      await removeNode(clickedNodeId)
      return
    }

    const terminalIdSet = new Set(terminalIdsToClose)
    setNodes((current) => {
      for (const node of current) {
        if ((node.type === 'terminal' || !node.type) && terminalIdSet.has(node.id) && node.sessionId) {
          void getApi().closeTerminal(node.sessionId)
        }
      }
      return current.filter((node) => !terminalIdSet.has(node.id))
    })
    setSelectedNodeIds((current) => current.filter((nodeId) => !terminalIdSet.has(nodeId)))
  }

  async function handleKillAllTerminals() {
    const terminalNodeIds = nodes.filter((node) => node.type === 'terminal').map((node) => node.id)
    if (!terminalNodeIds.length || !window.confirm('Kill all running T-CAN terminals? This will stop any agents/processes inside them.')) {
      return
    }

    setIsKillingTerminals(true)
    try {
      await getApi().closeAllTerminals()
      setNodes((current) => current.filter((node) => node.type !== 'terminal'))
      setSelectedNodeIds((current) => current.filter((nodeId) => !terminalNodeIds.includes(nodeId)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to kill terminals.\n\n${message}`)
    } finally {
      setIsKillingTerminals(false)
    }
  }

  function getCanvasPoint(clientX: number, clientY: number) {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return null
    }

    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    }
  }

  function getActionNodeIds(nodeId: string): string[] {
    return selectedNodeIdSet.has(nodeId) ? selectedNodeIds : [nodeId]
  }

  function beginCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 1) {
      return
    }

    event.preventDefault()
    setIsCanvasPanning(true)

    const start = { x: event.clientX, y: event.clientY }
    const initialViewport = viewport

    const move = (pointerEvent: PointerEvent) => {
      setViewport({
        ...initialViewport,
        x: initialViewport.x + pointerEvent.clientX - start.x,
        y: initialViewport.y + pointerEvent.clientY - start.y,
      })
    }

    const stop = () => {
      setIsCanvasPanning(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
  }

  function beginCanvasSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    const target = event.target as HTMLElement | null
    if (
      target?.closest('.terminal-node') ||
      target?.closest('.editor-node') ||
      target?.closest('.source-control-node') ||
      target?.closest('.canvas__hud') ||
      target?.closest('button')
    ) {
      return
    }

    const startPoint = getCanvasPoint(event.clientX, event.clientY)
    if (!startPoint) {
      return
    }

    event.preventDefault()
    const modifiedSelection = hasSelectionModifier(event)
    const initialSelection = selectedNodeIds
    const initialViewport = viewport

    const move = (pointerEvent: PointerEvent) => {
      const currentPoint = getCanvasPoint(pointerEvent.clientX, pointerEvent.clientY)
      if (!currentPoint) {
        return
      }

      const rect = createCanvasRect(startPoint, currentPoint)
      setSelectionBox({
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      })
    }

    const stop = (event?: Event) => {
      const pointerEvent = event instanceof PointerEvent ? event : undefined
      const endPoint = pointerEvent ? getCanvasPoint(pointerEvent.clientX, pointerEvent.clientY) ?? startPoint : startPoint
      const rect = createCanvasRect(startPoint, endPoint)
      const width = rect.right - rect.left
      const height = rect.bottom - rect.top

      setSelectionBox(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)

      if (width < SELECTION_DRAG_THRESHOLD && height < SELECTION_DRAG_THRESHOLD) {
        if (!modifiedSelection) {
          setSelectedNodeIds([])
        }
        return
      }

      const intersectedNodeIds = nodes
        .filter((node) => rectanglesIntersect(rect, getNodeCanvasRect(node, initialViewport)))
        .map((node) => node.id)

      setSelectedNodeIds(modifiedSelection ? toggleSelection(initialSelection, intersectedNodeIds) : intersectedNodeIds)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    beginCanvasSelection(event)
  }

  function handleCanvasPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 1) {
      beginCanvasPan(event)
    }
  }

  function handleNodeSelect(nodeId: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return
    }

    const target = event.target as HTMLElement | null
    if (!target?.closest('.terminal-node__body') && !target?.closest('.editor-node__body') && !target?.closest('.source-control-node__body')) {
      return
    }

    if (hasSelectionModifier(event)) {
      setSelectedNodeIds((current) => toggleSelection(current, [nodeId]))
      return
    }

    setSelectedNodeIds([nodeId])
  }

  function beginNodeMove(nodeId: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const actionNodeIds = getActionNodeIds(nodeId)
    const sourceNode = nodes.find((node) => node.id === nodeId)
    const isAltDuplicateDrag = event.altKey && (sourceNode?.type === 'terminal' || !sourceNode?.type)

    if (isAltDuplicateDrag) {
      const sourceTerminals = nodes.filter((node): node is TerminalNodeModel => actionNodeIds.includes(node.id) && (node.type === 'terminal' || !node.type))
      if (sourceTerminals.length === 0) {
        return
      }

      setSelectedNodeIds(sourceTerminals.map((node) => node.id))

      const startX = event.clientX
      const startY = event.clientY
      let previousX = event.clientX
      let previousY = event.clientY
      let latestX = event.clientX
      let latestY = event.clientY
      let duplicateNodeIds: string[] | null = null
      let isCreatingDuplicates = false
      let isDisposed = false

      const moveDuplicateNodes = (pointerEvent: PointerEvent) => {
        latestX = pointerEvent.clientX
        latestY = pointerEvent.clientY

        if (!duplicateNodeIds) {
          const movedX = Math.abs(pointerEvent.clientX - startX)
          const movedY = Math.abs(pointerEvent.clientY - startY)
          if ((movedX < SELECTION_DRAG_THRESHOLD && movedY < SELECTION_DRAG_THRESHOLD) || isCreatingDuplicates) {
            return
          }

          isCreatingDuplicates = true
          void createDuplicateTerminalNodes(sourceTerminals, {
            x: (latestX - startX) / viewport.scale,
            y: (latestY - startY) / viewport.scale,
          }).then((duplicatedNodes) => {
            if (isDisposed) {
              duplicatedNodes.forEach((node) => node.sessionId && void getApi().closeTerminal(node.sessionId))
              return
            }

            duplicateNodeIds = duplicatedNodes.map((node) => node.id)
            previousX = latestX
            previousY = latestY
            setNodes((current) => [...current, ...duplicatedNodes])
            setSelectedNodeIds(duplicateNodeIds)
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            window.alert(`Unable to duplicate selected terminals.\n\n${message}`)
          }).finally(() => {
            isCreatingDuplicates = false
          })
          return
        }

        const deltaX = (pointerEvent.clientX - previousX) / viewport.scale
        const deltaY = (pointerEvent.clientY - previousY) / viewport.scale
        const duplicateNodeIdSet = new Set(duplicateNodeIds)

        setNodes((current) =>
          current.map((node) =>
            duplicateNodeIdSet.has(node.id)
              ? {
                  ...node,
                  x: node.x + deltaX,
                  y: node.y + deltaY,
                }
              : node,
          ),
        )

        previousX = pointerEvent.clientX
        previousY = pointerEvent.clientY
      }

      const stopDuplicateDrag = () => {
        isDisposed = true
        window.removeEventListener('pointermove', moveDuplicateNodes)
        window.removeEventListener('pointerup', stopDuplicateDrag)
        window.removeEventListener('pointercancel', stopDuplicateDrag)
      }

      window.addEventListener('pointermove', moveDuplicateNodes)
      window.addEventListener('pointerup', stopDuplicateDrag)
      window.addEventListener('pointercancel', stopDuplicateDrag)
      return
    }

    const actionNodeIdSet = new Set(actionNodeIds)
    setSelectedNodeIds(actionNodeIds)

    let previousX = event.clientX
    let previousY = event.clientY

    const move = (pointerEvent: PointerEvent) => {
      const deltaX = (pointerEvent.clientX - previousX) / viewport.scale
      const deltaY = (pointerEvent.clientY - previousY) / viewport.scale

      setNodes((current) =>
        current.map((node) =>
          actionNodeIdSet.has(node.id)
            ? {
                ...node,
                x: node.x + deltaX,
                y: node.y + deltaY,
              }
            : node,
        ),
      )

      previousX = pointerEvent.clientX
      previousY = pointerEvent.clientY
    }

    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  function beginNodeResize(nodeId: string, event: ReactPointerEvent<HTMLButtonElement>, direction: NodeResizeDirection) {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const actionNodeIds = getActionNodeIds(nodeId)
    const actionNodeIdSet = new Set(actionNodeIds)
    setSelectedNodeIds(actionNodeIds)

    let previousX = event.clientX
    let previousY = event.clientY

    const move = (pointerEvent: PointerEvent) => {
      const deltaX = (pointerEvent.clientX - previousX) / viewport.scale
      const deltaY = (pointerEvent.clientY - previousY) / viewport.scale

      setNodes((current) =>
        current.map((node) => {
          if (!actionNodeIdSet.has(node.id)) {
            return node
          }

          const widthDelta = direction.includes('e') ? deltaX : direction.includes('w') ? -deltaX : 0
          const heightDelta = direction.includes('s') ? deltaY : direction.includes('n') ? -deltaY : 0
          const size = clampNodeSize({
            width: node.width + widthDelta,
            height: node.height + heightDelta,
          })

          return {
            ...node,
            x: direction.includes('w') ? node.x + node.width - size.width : node.x,
            y: direction.includes('n') ? node.y + node.height - size.height : node.y,
            width: size.width,
            height: size.height,
          }
        }),
      )

      previousX = pointerEvent.clientX
      previousY = pointerEvent.clientY
    }

    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  async function refreshGitPanel(selectedPath = gitPanel.selectedPath, staged = gitPanel.selectedDiffStaged) {
    if (!activeWorkspaceId) {
      return
    }
    setGitPanel((current) => ({ ...current, loading: true, error: null }))
    try {
      const [status, branches] = await Promise.all([getApi().getGitStatus(activeWorkspaceId), getApi().getGitBranches(activeWorkspaceId)])
      const nextSelectedPath = selectedPath ?? status[0]?.path ?? null
      const selectedEntry = status.find((entry) => entry.path === nextSelectedPath)
      const nextStaged = selectedEntry ? Boolean(staged && selectedEntry.staged || selectedEntry.staged && !selectedEntry.unstaged) : false
      const diff = nextSelectedPath ? await getApi().getGitFileDiff(activeWorkspaceId, nextSelectedPath, nextStaged) : null
      setGitPanel((current) => ({ ...current, status, branches, selectedPath: nextSelectedPath, selectedDiffStaged: nextStaged, diff, loading: false, error: null }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setGitPanel((current) => ({ ...current, loading: false, error: message }))
    }
  }

  async function openGitPanel() {
    const existingNode = nodes.find((node) => node.type === 'source-control')
    if (existingNode) {
      setSelectedNodeIds([existingNode.id])
      await refreshGitPanel()
      return
    }

    const bounds = canvasRef.current?.getBoundingClientRect()
    const position = bounds ? getViewportCenterWorldPoint(viewport, bounds) : { x: 80, y: 80 }
    const node = createSourceControlNode({ x: position.x - 460, y: position.y - 310 })
    setNodes((current) => [...current, node])
    setSelectedNodeIds([node.id])
    await refreshGitPanel()
  }

  async function runGitAction(action: () => Promise<void>) {
    try {
      await action()
      await refreshGitPanel()
      await refreshFileTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Git operation failed.\n\n${message}`)
    }
  }

  function handleCanvasContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()

    const target = event.target as HTMLElement | null
    if (target?.closest('.canvas-context-menu')) {
      return
    }

    const point = getCanvasPoint(event.clientX, event.clientY)
    if (!point) {
      return
    }

    setCanvasContextMenu(point)
  }

  function handleSelectedTerminalContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()

    const point = getCanvasPoint(event.clientX, event.clientY)
    if (!point) {
      return
    }

    setCanvasContextMenu(point)
  }

  function runCanvasContextCommand(command: () => void) {
    setCanvasContextMenu(null)
    command()
  }

  const stagedChanges = gitPanel.status.filter((entry) => entry.staged || entry.conflicted)
  const unstagedChanges = gitPanel.status.filter((entry) => entry.unstaged || entry.untracked || entry.conflicted)
  const gitChangeCount = new Set(gitPanel.status.map((entry) => entry.path)).size
  const gitSyncLabel = gitPanel.branches?.upstream
    ? `${gitPanel.branches.upstream} · ↑${gitPanel.branches.ahead ?? 0} ↓${gitPanel.branches.behind ?? 0}`
    : 'No upstream / publish branch'
  const selectedDuplicableNodeCount = nodes.filter((node) => selectedNodeIdSet.has(node.id) && node.type !== 'source-control').length

  function getGitStatusLabel(entry: GitStatusEntry): string {
    if (entry.conflicted) return 'Conflict'
    if (entry.untracked) return 'Untracked'
    const code = `${entry.indexStatus}${entry.workTreeStatus}`.trim()
    if (code.includes('R')) return 'Renamed'
    if (code.includes('A')) return 'Added'
    if (code.includes('D')) return 'Deleted'
    if (code.includes('M')) return 'Modified'
    return code || 'Changed'
  }

  function getGitStatusBadge(entry: GitStatusEntry): string {
    if (entry.untracked) return 'U'
    if (entry.conflicted) return `${entry.indexStatus}${entry.workTreeStatus}`.trim() || '!'
    return `${entry.indexStatus}${entry.workTreeStatus}`.trim() || 'M'
  }

  function renderGitFile(entry: GitStatusEntry, staged: boolean) {
    const active = entry.path === gitPanel.selectedPath && gitPanel.selectedDiffStaged === staged
    const directory = getFileDirectory(entry.path)
    return (
      <button className={active ? 'git-panel__file git-panel__file--active' : 'git-panel__file'} key={`${staged ? 'staged' : 'changes'}-${entry.path}`} title={`${getGitStatusLabel(entry)} · ${entry.path}`} onClick={() => void refreshGitPanel(entry.path, staged)} type="button">
        <span className="git-panel__file-icon">{getFileExtensionBadge(entry.path)}</span>
        <span className="git-panel__file-main">
          <span className="git-panel__file-name">{getFileTitle(entry.path)}</span>
          {directory && <span className="git-panel__file-dir">{directory}</span>}
        </span>
        <strong className="git-panel__file-status">{getGitStatusBadge(entry)}</strong>
      </button>
    )
  }

  function renderSourceControlContent() {
    return (
      <div className="git-panel__body git-panel__body--vscode source-control-node__body">
        <aside className="git-panel__scm">
          <div className="git-panel__section-title"><span>⌄ REPOSITORIES</span></div>
          <div className="git-panel__repo-row">
            <span className="git-panel__repo-icon">▱</span>
            <strong>{workspacePath ? getWorkspaceName(workspacePath) : 'Repository'}</strong>
            <span className="git-panel__branch">⑂ {gitPanel.branches?.current ?? 'main'}</span>
            <button className="git-panel__icon-button" disabled={gitPanel.loading} title="Fetch" onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitFetch(activeWorkspaceId))} type="button">⇣</button>
            <button className="git-panel__icon-button" disabled={gitPanel.loading} title="Pull" onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitPull(activeWorkspaceId))} type="button">↓</button>
            <button className="git-panel__icon-button" disabled={gitPanel.loading} title="Push / Sync" onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitPush(activeWorkspaceId))} type="button">↻</button>
            <button className="git-panel__icon-button" title={gitSyncLabel} type="button">…</button>
          </div>
          <div className="git-panel__meta">
            <span>{gitSyncLabel}</span>
            {gitPanel.branches?.lastCommit && <span>{gitPanel.branches.lastCommit.hash} {gitPanel.branches.lastCommit.subject}</span>}
            {gitPanel.loading && <span>Loading...</span>}
          </div>
          {gitPanel.error && <p className="git-panel__error">{gitPanel.error}</p>}
          <div className="git-panel__commit git-panel__commit--top">
            <textarea onChange={(event) => setGitPanel((current) => ({ ...current, commitMessage: event.target.value }))} placeholder="Message (Ctrl+Enter to commit on...)" value={gitPanel.commitMessage} onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && activeWorkspaceId && gitPanel.commitMessage.trim()) void runGitAction(() => getApi().gitCommit(activeWorkspaceId, gitPanel.commitMessage))
            }} />
            <div className="git-panel__commit-row">
              <button className="git-panel__commit-button" disabled={!gitPanel.commitMessage.trim()} onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitCommit(activeWorkspaceId, gitPanel.commitMessage))} type="button">✓ Commit</button>
              <button className="git-panel__commit-menu" title="Commit options" type="button">⌄</button>
            </div>
          </div>
          <div className="git-panel__section-title">
            <span>⌄ STAGED CHANGES</span><b>{stagedChanges.length}</b>
            <button className="git-panel__icon-button" title="Unstage All" onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitUnstage(activeWorkspaceId, '.'))} type="button">−</button>
          </div>
          {stagedChanges.map((entry) => renderGitFile(entry, true))}
          <div className="git-panel__section-title">
            <span>⌄ CHANGES</span><b>{unstagedChanges.length}</b>
            <button className="git-panel__icon-button" title="Stage All" onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitStage(activeWorkspaceId, '.'))} type="button">＋</button>
            <button className="git-panel__icon-button git-panel__icon-button--danger" title="Discard All" onClick={() => activeWorkspaceId && window.confirm('Discard ALL working tree changes and untracked files?') && void runGitAction(() => getApi().gitDiscardAll(activeWorkspaceId))} type="button">⌫</button>
          </div>
          {unstagedChanges.length === 0 && stagedChanges.length === 0 ? <p className="git-panel__empty">No changes.</p> : unstagedChanges.map((entry) => renderGitFile(entry, false))}
        </aside>
        <main className="git-panel__diff">
          {gitPanel.selectedPath && (
            <div className="git-panel__file-actions">
              <button onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitStage(activeWorkspaceId, gitPanel.selectedPath ?? ''))} type="button">Stage</button>
              <button onClick={() => activeWorkspaceId && void runGitAction(() => getApi().gitUnstage(activeWorkspaceId, gitPanel.selectedPath ?? ''))} type="button">Unstage</button>
              <button onClick={() => gitPanel.selectedPath && handleOpenFileFromExplorer(gitPanel.selectedPath)} type="button">Open</button>
              <button onClick={() => activeWorkspaceId && gitPanel.selectedPath && void getApi().getGitFileDiff(activeWorkspaceId, gitPanel.selectedPath, false).then((diff) => setGitPanel((current) => ({ ...current, selectedDiffStaged: false, diff })))} type="button">Unstaged Diff</button>
              <button onClick={() => activeWorkspaceId && gitPanel.selectedPath && void getApi().getGitFileDiff(activeWorkspaceId, gitPanel.selectedPath, true).then((diff) => setGitPanel((current) => ({ ...current, selectedDiffStaged: true, diff })))} type="button">Staged Diff</button>
              <button onClick={() => activeWorkspaceId && gitPanel.selectedPath && void getApi().getGitFileHistory(activeWorkspaceId, gitPanel.selectedPath).then((history) => window.alert(history.map((commit) => `${commit.hash} ${commit.date} ${commit.author}\n${commit.subject}`).join('\n\n') || 'No history.'))} type="button">History</button>
              <button onClick={() => activeWorkspaceId && gitPanel.selectedPath && void getApi().getGitBlame(activeWorkspaceId, gitPanel.selectedPath).then((blame) => window.alert(blame.slice(0, 60).map((line) => `${line.line} ${line.commit} ${line.author}: ${line.content}`).join('\n') || 'No blame.'))} type="button">Blame</button>
              <button onClick={() => setGitPanel((current) => ({ ...current, diffMode: current.diffMode === 'inline' ? 'side-by-side' : 'inline' }))} type="button">{gitPanel.diffMode === 'inline' ? 'Side-by-side' : 'Inline'}</button>
              <button className="command-button--danger" onClick={() => activeWorkspaceId && gitPanel.selectedPath && window.confirm(`Discard changes in ${gitPanel.selectedPath}?`) && void runGitAction(() => getApi().gitDiscard(activeWorkspaceId, gitPanel.selectedPath ?? ''))} type="button">Discard</button>
            </div>
          )}
          {gitPanel.selectedPath && <div className="git-panel__diff-title">{gitPanel.selectedDiffStaged ? 'Staged' : 'Unstaged'} diff: <strong>{gitPanel.selectedPath}</strong>{gitPanel.diff?.binary ? ' (binary)' : ''}</div>}
          {gitPanel.diffMode === 'inline' ? (
            <pre>{gitPanel.diff?.lines.map((line, index) => <div className={`git-panel__diff-line git-panel__diff-line--${line.type}`} key={`${index}-${line.content}`}>{line.content || ' '}</div>)}</pre>
          ) : (
            <div className="git-panel__side-by-side">
              <pre>{gitPanel.diff?.lines.filter((line) => line.type !== 'add').map((line, index) => <div className={`git-panel__diff-line git-panel__diff-line--${line.type}`} key={`old-${index}-${line.content}`}>{line.content || ' '}</div>)}</pre>
              <pre>{gitPanel.diff?.lines.filter((line) => line.type !== 'delete').map((line, index) => <div className={`git-panel__diff-line git-panel__diff-line--${line.type}`} key={`new-${index}-${line.content}`}>{line.content || ' '}</div>)}</pre>
            </div>
          )}
        </main>
      </div>
    )
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null
    if (target?.closest('.terminal-node') || target?.closest('.editor-node') || target?.closest('.source-control-node') || target?.closest('.canvas-context-menu')) {
      return
    }

    event.preventDefault()
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    setViewport((current) =>
      snapCanvasZoomViewport({
        viewport: current,
        deltaY: event.deltaY,
        anchor: {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
      }),
    )
  }

  return (
    <div className="app-shell">
      {isTerminalManagerOpen && (
        <div className="app-modal" role="presentation" onMouseDown={() => setIsTerminalManagerOpen(false)}>
          <section className="app-modal__panel app-modal__panel--wide" aria-label="Terminal manager" onMouseDown={(event) => event.stopPropagation()}>
            <header className="app-modal__header">
              <strong>TERMINAL MANAGER</strong>
              <button className="icon-button" onClick={() => setIsTerminalManagerOpen(false)} type="button">x</button>
            </header>
            <div className="app-modal__results terminal-manager">
              <section>
                <h3>Tasks</h3>
                {workspaceTasks.length === 0 ? <p>No package.json scripts detected.</p> : workspaceTasks.map((task) => (
                  <button className="app-modal__row" key={task.name} onClick={() => void handleRunTask(task)} type="button">
                    <strong>{task.packageManager} run {task.name}</strong>
                    <span>{task.command}</span>
                  </button>
                ))}
              </section>
              <section>
                <h3>Terminals</h3>
                {terminalNodes.map((node) => (
                  <div className="terminal-manager__row" key={node.id}>
                    <div>
                      <strong>{node.title}</strong>
                      <span>{node.cwd ?? workspacePath ?? 'HOME'} · {node.shell ?? 'shell'}</span>
                    </div>
                    <button onClick={() => setSelectedNodeIds([node.id])} type="button">Focus</button>
                    <button onClick={() => handleRenameTerminal(node)} type="button">Rename</button>
                    <button onClick={() => void handleDuplicateTerminal(node)} type="button">Duplicate</button>
                    <button onClick={() => void handleDuplicateTerminal({ ...node, title: `${node.title} split` })} type="button">Split</button>
                    <button onClick={() => void handleRestartTerminal(node)} type="button">Restart</button>
                    <button className="command-button--danger" onClick={() => void removeNode(node.id)} type="button">Kill</button>
                  </div>
                ))}
              </section>
              <section>
                <h3>Problems</h3>
                {problems.length === 0 ? <p>No terminal problems matched yet.</p> : problems.slice(0, 80).map((problem) => (
                  <button className="app-modal__row" key={problem.id} onClick={() => handleOpenFileFromExplorer(problem.relativePath)} type="button">
                    <strong>{problem.relativePath}:{problem.line}{problem.column ? `:${problem.column}` : ''}</strong>
                    <span>{problem.severity.toUpperCase()} · {problem.message}</span>
                  </button>
                ))}
              </section>
            </div>
          </section>
        </div>
      )}
      {isSshDialogOpen && (
        <div className="ssh-dialog" role="presentation" onMouseDown={closeSshDialog}>
          <form className="ssh-dialog__panel" aria-label="Open SSH workspace" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void handleSshDialogSubmit(event)}>
            <header className="ssh-dialog__header">
              <strong>SSH WORKSPACE</strong>
              <button className="icon-button" disabled={isOpeningWorkspace} onClick={closeSshDialog} type="button">x</button>
            </header>
            <div className="ssh-dialog__fields">
              <label className="ssh-dialog__field">
                <span>Host</span>
                <input
                  autoFocus
                  autoComplete="hostname"
                  disabled={isOpeningWorkspace}
                  onChange={(event) => setSshHostInput(event.target.value)}
                  placeholder="example.com"
                  value={sshHostInput}
                />
              </label>
              <label className="ssh-dialog__field">
                <span>Username</span>
                <input
                  autoComplete="username"
                  disabled={isOpeningWorkspace}
                  onChange={(event) => setSshUsernameInput(event.target.value)}
                  placeholder="user"
                  value={sshUsernameInput}
                />
              </label>
              <label className="ssh-dialog__field">
                <span>Password</span>
                <input
                  autoComplete="current-password"
                  disabled={isOpeningWorkspace}
                  onChange={(event) => setSshPasswordInput(event.target.value)}
                  placeholder="Not saved"
                  type="password"
                  value={sshPasswordInput}
                />
              </label>
              <p className="ssh-dialog__hint">Password is kept in memory for this app session only and is never saved to disk.</p>
            </div>
            <footer className="ssh-dialog__actions">
              <button className="command-button" disabled={isOpeningWorkspace} onClick={closeSshDialog} type="button">
                Cancel
              </button>
              <button className="command-button" disabled={isOpeningWorkspace || sshHostInput.trim().length === 0} type="submit">
                {isOpeningWorkspace ? 'OPENING...' : 'Connect'}
              </button>
            </footer>
          </form>
        </div>
      )}
      <header className="topbar">
        <div className="topbar__brand">T_CAN//STITCH</div>
        <nav className="topbar__nav" aria-label="Workspaces">
          {workspaces.length === 0 ? (
            <span className="topbar__tab topbar__tab--active">NO WORKSPACE</span>
          ) : (
            workspaces.map((workspace) => (
              <span
                className={workspace.id === activeWorkspaceId ? 'topbar__workspace topbar__workspace--active' : 'topbar__workspace'}
                key={workspace.id}
              >
                <button
                  className="topbar__tab"
                  disabled={closingWorkspaceId === workspace.id}
                  onClick={() => void handleSwitchWorkspace(workspace.id)}
                  title={workspace.path}
                  type="button"
                >
                  {getWorkspaceName(workspace.path)}
                </button>
                <button
                  aria-label={`Close ${getWorkspaceName(workspace.path)} workspace`}
                  className="topbar__workspace-close"
                  disabled={closingWorkspaceId === workspace.id}
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleCloseWorkspace(workspace.id)
                  }}
                  title="Close workspace"
                  type="button"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </nav>
        <div className="topbar__actions">
          <button className="command-button" disabled={dirtyEditorPathCount === 0} onClick={() => setSaveAllSignal((current) => current + 1)} type="button">
            SAVE ALL
          </button>
          <button className="command-button" onClick={() => setAutoSave((current) => !current)} type="button">
            AUTOSAVE {autoSave ? 'ON' : 'OFF'}
          </button>
          <button className="command-button" disabled={terminalNodeCount === 0} onClick={() => setIsTerminalManagerOpen(true)} type="button">
            TERMS
          </button>
          <button className="command-button" disabled={!activeWorkspaceId || activeWorkspace?.kind === 'ssh'} onClick={() => void openGitPanel()} type="button">
            GIT
          </button>
          <button className="command-button" disabled={isOpeningWorkspace} onClick={() => void handleOpenWorkspace()} type="button">
            {isOpeningWorkspace ? 'OPENING...' : 'ADD WORKSPACE'}
          </button>
          <button className="command-button" disabled={isOpeningWorkspace} onClick={openSshDialog} type="button">
            SSH
          </button>
          <button
            className="command-button"
            disabled={isCreatingTerminal || isBootstrapping}
            onClick={() => void handleCreateTerminal()}
            type="button"
          >
            {isCreatingTerminal ? 'CREATING...' : 'NEW TERMINAL'}
          </button>
          <button
            className="command-button command-button--danger"
            disabled={isBootstrapping || isKillingTerminals || terminalNodeCount === 0}
            onClick={() => void handleKillAllTerminals()}
            type="button"
          >
            {isKillingTerminals ? 'KILLING...' : `KILL ALL (${terminalNodeCount})`}
          </button>
        </div>
      </header>

      <div className="app-shell__body">
        <FileExplorer
          entries={fileEntries}
          loading={isLoadingFiles}
          onCopyPath={handleCopyWorkspacePath}
          onCreatePath={handleCreateWorkspacePath}
          onDeletePath={handleDeleteWorkspacePath}
          onDuplicatePath={handleDuplicateWorkspacePath}
          onOpenFile={handleOpenFileFromExplorer}
          onRefresh={() => void refreshFileTree()}
          onRenamePath={handleRenameWorkspacePath}
          onRevealPath={handleRevealWorkspacePath}
          remote={activeWorkspace?.kind === 'ssh'}
          workspaceName={activeWorkspace ? getWorkspaceName(activeWorkspace.path) : null}
        />

        <main className="workspace">
          <div
            className={isCanvasPanning ? 'canvas canvas--panning' : 'canvas'}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault()
              }
            }}
            onContextMenu={handleCanvasContextMenu}
            onPointerDown={handleCanvasPointerDown}
            onPointerDownCapture={handleCanvasPointerDownCapture}
            onWheel={handleWheel}
            ref={canvasRef}
            role="presentation"
            style={{
              backgroundPosition: `${viewport.x}px ${viewport.y}px`,
              backgroundSize: `${48 * viewport.scale}px ${48 * viewport.scale}px`,
            }}
          >
            <div className="canvas__world">
              {nodes.map((node) => {
                const canvasRect = getNodeCanvasRect(node, viewport)

                if (node.type === 'editor') {
                  if (!activeWorkspaceId) {
                    return null
                  }

                  return (
                    <EditorNode
                      key={node.id}
                      canvasRect={{
                        left: canvasRect.left,
                        top: canvasRect.top,
                        width: canvasRect.right - canvasRect.left,
                        height: canvasRect.bottom - canvasRect.top,
                      }}
                      node={node}
                      autoSave={autoSave}
                      onClose={() => void removeNode(node.id)}
                      onDirtyChange={handleEditorDirtyChange}
                      onMoveStart={(event) => beginNodeMove(node.id, event)}
                      onResizeStart={(event, direction) => beginNodeResize(node.id, event, direction)}
                      onSelect={(event) => handleNodeSelect(node.id, event)}
                      onSplit={handleSplitEditor}
                      onTabsChange={handleEditorTabsChange}
                      externalRefreshSignal={externalRefreshSignal}
                      saveAllSignal={saveAllSignal}
                      saveSignal={saveSignal}
                      scale={viewport.scale}
                      selected={selectedNodeIdSet.has(node.id)}
                      workspaceId={activeWorkspaceId}
                    />
                  )
                }

                if (node.type === 'source-control') {
                  return (
                    <article
                      className={selectedNodeIdSet.has(node.id) ? 'source-control-node source-control-node--selected' : 'source-control-node'}
                      key={node.id}
                      onPointerDownCapture={(event) => handleNodeSelect(node.id, event)}
                      style={{
                        transform: `translate(${canvasRect.left}px, ${canvasRect.top}px)`,
                        width: canvasRect.right - canvasRect.left,
                        height: canvasRect.bottom - canvasRect.top,
                        '--node-scale': `${viewport.scale}`,
                      } as CSSProperties}
                    >
                      <header className="source-control-node__header" onPointerDown={(event) => beginNodeMove(node.id, event)}>
                        <div className="terminal-node__lights" aria-hidden="true">
                          <span className="terminal-node__light terminal-node__light--red" />
                          <span className="terminal-node__light terminal-node__light--amber" />
                          <span className="terminal-node__light terminal-node__light--green" />
                        </div>
                        <div className="source-control-node__titleblock">
                          <strong>{node.title.toUpperCase()} {gitPanel.branches?.current ? `// ${gitPanel.branches.current}` : ''}</strong>
                          <span>{gitChangeCount} change{gitChangeCount === 1 ? '' : 's'} · {gitSyncLabel}</span>
                        </div>
                        <button className="git-panel__icon-button" disabled={gitPanel.loading} title="Refresh" onClick={() => void refreshGitPanel()} onPointerDown={(event) => event.stopPropagation()} type="button">↻</button>
                        <button aria-label={`Close ${node.title}`} className="icon-button" onClick={() => void removeNode(node.id)} onPointerDown={(event) => event.stopPropagation()} type="button">x</button>
                      </header>
                      {renderSourceControlContent()}
                      {RESIZE_DIRECTIONS.map((direction) => (
                        <button
                          aria-label={`Resize ${node.title} from ${direction}`}
                          className={`source-control-node__resize-handle source-control-node__resize-handle--${direction}`}
                          key={direction}
                          onPointerDown={(event) => beginNodeResize(node.id, event, direction)}
                          type="button"
                        />
                      ))}
                    </article>
                  )
                }

                return (
                  <TerminalNode
                    key={node.id}
                    canvasRect={{
                      left: canvasRect.left,
                      top: canvasRect.top,
                      width: canvasRect.right - canvasRect.left,
                      height: canvasRect.bottom - canvasRect.top,
                    }}
                    node={node}
                    onClose={() => void removeTerminalSelection(node.id)}
                    onContextMenu={selectedNodeIdSet.has(node.id) && selectedDuplicableNodeCount > 1 ? handleSelectedTerminalContextMenu : undefined}
                    onMoveStart={(event) => beginNodeMove(node.id, event)}
                    onResizeStart={(event, direction) => beginNodeResize(node.id, event, direction)}
                    onSelect={(event) => handleNodeSelect(node.id, event)}
                    onSshPasswordCaptured={handleSshPasswordCaptured}
                    scale={viewport.scale}
                    selected={selectedNodeIdSet.has(node.id)}
                    sessionId={node.sessionId}
                    shell={node.shell}
                    sshPassword={node.sshTarget ? sshPasswords[node.sshTarget] : undefined}
                    workspacePath={workspacePath}
                  />
                )
              })}
            </div>
            {selectionBox && (
              <div
                aria-hidden="true"
                className="canvas__selection-box"
                style={{
                  transform: `translate(${selectionBox.x}px, ${selectionBox.y}px)`,
                  width: selectionBox.width,
                  height: selectionBox.height,
                }}
              />
            )}
            {canvasContextMenu && (
              <div
                className="canvas-context-menu"
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => event.stopPropagation()}
                role="menu"
                style={{ transform: `translate(${canvasContextMenu.x}px, ${canvasContextMenu.y}px)` }}
              >
                <button
                  disabled={isOpeningWorkspace}
                  onClick={() => runCanvasContextCommand(() => void handleOpenWorkspace())}
                  role="menuitem"
                  type="button"
                >
                  {isOpeningWorkspace ? 'Opening workspace...' : 'Add workspace'}
                </button>
                <button
                  disabled={isCreatingTerminal || isBootstrapping}
                  onClick={() => runCanvasContextCommand(() => void handleCreateTerminal())}
                  role="menuitem"
                  type="button"
                >
                  {isCreatingTerminal ? 'Creating terminal...' : 'New terminal'}
                </button>
                <button
                  disabled={selectedDuplicableNodeCount === 0}
                  onClick={() => runCanvasContextCommand(() => void handleDuplicateSelectedNodes())}
                  role="menuitem"
                  type="button"
                >
                  Duplicate selected{selectedDuplicableNodeCount > 0 ? ` (${selectedDuplicableNodeCount})` : ''}
                </button>
                <button
                  disabled={isBootstrapping || isKillingTerminals || terminalNodeCount === 0}
                  onClick={() => runCanvasContextCommand(() => void handleKillAllTerminals())}
                  role="menuitem"
                  type="button"
                >
                  {isKillingTerminals ? 'Killing terminals...' : `Kill all terminals (${terminalNodeCount})`}
                </button>
              </div>
            )}
            {!nodes.length && !isBootstrapping && (
              <div className="empty-state">
                <p className="empty-state__title">EMPTY CANVAS</p>
                <p className="empty-state__body">Add or switch workspaces, then spawn shells at the canvas center. Use the mouse wheel on empty canvas space to toggle between normal and overview zoom.</p>
                <div className="empty-state__actions">
                  <button className="command-button" onClick={() => void handleOpenWorkspace()} type="button">
                    ADD WORKSPACE
                  </button>
                  <button className="command-button" onClick={() => void handleCreateTerminal()} type="button">
                    SPAWN SHELL
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <span>SYSTEM_STATUS: {isBootstrapping ? 'BOOTSTRAPPING' : 'NOMINAL'}</span>
        <span>NODES: {nodes.length}</span>
        <span>DIRTY_FILES: {dirtyEditorPathCount}</span>
        <span>AUTOSAVE: {autoSave ? 'ON' : 'OFF'}</span>
        <span>WORKSPACES: {workspaces.length}</span>
        <span>ACTIVE_WORKSPACE: {workspacePath ?? 'HOME'}</span>
        <span>VIEWPORT: X={Math.round(viewport.x)} Y={Math.round(viewport.y)}</span>
      </footer>
    </div>
  )
}

export default App
