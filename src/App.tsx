import { useEffect, useMemo, useRef, useState, type FormEvent as ReactFormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import './App.css'
import type { CanvasNode, EditorTab, NodeResizeDirection, PersistedAppState, PersistedLayout, PersistedWorkspace, Viewport, WorkspaceFileEntry, WorkspaceSymbol, WorkspaceTextSearchResult } from '../shared/types'
import { CommandPalette } from './components/CommandPalette'
import { EditorNode } from './components/EditorNode'
import { FileExplorer } from './components/FileExplorer'
import { TerminalNode } from './components/TerminalNode'
import {
  clampNodeSize,
  createCanvasRect,
  createEditorNode,
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

interface WorkspaceSearchState {
  query: string
  replacement: string
  results: WorkspaceTextSearchResult[]
  searching: boolean
}

interface WorkspaceSymbolState {
  query: string
  results: WorkspaceSymbol[]
  searching: boolean
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }
const SELECTION_DRAG_THRESHOLD = 4

function getWorkspaceName(workspacePath: string): string {
  if (workspacePath.startsWith('ssh://')) {
    return workspacePath.slice('ssh://'.length)
  }

  return workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
}

function getFileTitle(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function createEditorTab(filePath: string): EditorTab {
  return { filePath, title: getFileTitle(filePath) }
}

function joinWorkspacePath(parentPath: string, name: string): string {
  return [parentPath, name].filter(Boolean).join('/').replace(/\\/g, '/')
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
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false)
  const [workspaceSearch, setWorkspaceSearch] = useState<WorkspaceSearchState>({ query: '', replacement: '', results: [], searching: false })
  const [isWorkspaceSymbolOpen, setIsWorkspaceSymbolOpen] = useState(false)
  const [workspaceSymbols, setWorkspaceSymbols] = useState<WorkspaceSymbolState>({ query: '', results: [], searching: false })
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
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
  const terminalNodeCount = useMemo(() => nodes.filter((node) => node.type !== 'editor').length, [nodes])

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
          if (node.type === 'editor') {
            return node
          }

          if (node.sessionId) {
            const existingSession = await api.getTerminalSession(node.sessionId)
            if (existingSession) {
              return { ...node, shell: existingSession.info.shell }
            }
          }

          const sshTarget = workspace.kind === 'ssh' ? node.sshTarget ?? workspace.sshTarget : undefined
          const session = sshTarget
            ? await api.createTerminal({ cwd: null, command: 'ssh', args: [sshTarget] })
            : await api.createTerminal({ cwd: workspace.path })
          return { ...node, type: 'terminal' as const, sessionId: session.sessionId, shell: session.shell, sshTarget }
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
      if (usesCommandModifier && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setIsCommandPaletteOpen(true)
        return
      }

      if (usesCommandModifier && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setIsWorkspaceSearchOpen(true)
        return
      }

      if (usesCommandModifier && event.key.toLowerCase() === 't') {
        event.preventDefault()
        setIsWorkspaceSymbolOpen(true)
        return
      }

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

  async function refreshFileTree() {
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
      window.alert(`Unable to load workspace files.\n\n${message}`)
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

  useEffect(() => {
    queueMicrotask(() => void refreshFileTree())
    // refreshFileTree intentionally reads the latest active workspace state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

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
      setSshPasswords((current) => {
        const next = { ...current }
        if (password) {
          next[target] = password
        } else {
          delete next[target]
        }
        return next
      })
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
    const workspace = workspaces.find((entry) => entry.id === workspaceId)
    if (!workspace) {
      return
    }

    const terminalCount = workspaceId === activeWorkspaceId
      ? terminalNodeCount
      : workspace.layout.nodes.filter((node) => node.type !== 'editor').length
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
    try {
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
      setClosingWorkspaceId(null)
    }
  }

  async function handleCreateTerminal() {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    setIsCreatingTerminal(true)
    try {
      const node = createTerminalNode(getViewportCenterWorldPoint(viewport, bounds))
      const sshTarget = activeWorkspace?.kind === 'ssh' ? activeWorkspace.sshTarget : undefined
      const session = sshTarget
        ? await getApi().createTerminal({ cwd: null, command: 'ssh', args: [sshTarget] })
        : await getApi().createTerminal({ cwd: workspacePath })
      setNodes((current) => [
        ...current,
        {
          ...node,
          title: sshTarget ? `SSH ${sshTarget}` : node.title,
          sessionId: session.sessionId,
          shell: session.shell,
          sshTarget,
        },
      ])
      setSelectedNodeIds([node.id])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to create a terminal.\n\n${message}`)
    } finally {
      setIsCreatingTerminal(false)
    }
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
      if (node?.type === 'terminal' && node.sessionId) {
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

  async function handleKillAllTerminals() {
    const terminalNodeIds = nodes.filter((node) => node.type !== 'editor').map((node) => node.id)
    if (!terminalNodeIds.length || !window.confirm('Kill all running T-CAN terminals? This will stop any agents/processes inside them.')) {
      return
    }

    setIsKillingTerminals(true)
    try {
      await getApi().closeAllTerminals()
      setNodes((current) => current.filter((node) => node.type === 'editor'))
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
    if (!target?.closest('.terminal-node__body') && !target?.closest('.editor-node__body')) {
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

  async function runWorkspaceSearch() {
    if (!activeWorkspaceId || !workspaceSearch.query) {
      return
    }
    setWorkspaceSearch((current) => ({ ...current, searching: true }))
    try {
      const results = await getApi().searchWorkspaceText(activeWorkspaceId, workspaceSearch.query)
      setWorkspaceSearch((current) => ({ ...current, results }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Workspace search failed.\n\n${message}`)
    } finally {
      setWorkspaceSearch((current) => ({ ...current, searching: false }))
    }
  }

  async function runWorkspaceReplace() {
    if (!activeWorkspaceId || !workspaceSearch.query) {
      return
    }
    if (!window.confirm(`Replace all occurrences of "${workspaceSearch.query}" across the workspace?`)) {
      return
    }
    setWorkspaceSearch((current) => ({ ...current, searching: true }))
    try {
      const results = await getApi().replaceWorkspaceText(activeWorkspaceId, workspaceSearch.query, workspaceSearch.replacement)
      setWorkspaceSearch((current) => ({ ...current, results }))
      await refreshFileTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Workspace replace failed.\n\n${message}`)
    } finally {
      setWorkspaceSearch((current) => ({ ...current, searching: false }))
    }
  }

  async function runWorkspaceSymbolSearch(query = workspaceSymbols.query) {
    if (!activeWorkspaceId) {
      return
    }
    setWorkspaceSymbols((current) => ({ ...current, searching: true }))
    try {
      const results = await getApi().listWorkspaceSymbols(activeWorkspaceId, query)
      setWorkspaceSymbols((current) => ({ ...current, query, results }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Workspace symbol search failed.\n\n${message}`)
    } finally {
      setWorkspaceSymbols((current) => ({ ...current, searching: false }))
    }
  }

  function openWorkspaceSymbolSearch() {
    setIsWorkspaceSymbolOpen(true)
    if (workspaceSymbols.results.length === 0) {
      void runWorkspaceSymbolSearch('')
    }
  }

  const commandPaletteCommands = [
    {
      id: 'open-workspace',
      label: 'Add workspace',
      description: 'Open another project folder.',
      disabled: isOpeningWorkspace,
      run: () => void handleOpenWorkspace(),
    },
    {
      id: 'open-ssh-workspace',
      label: 'SSH workspace',
      description: 'Connect to a remote machine as a workspace.',
      disabled: isOpeningWorkspace,
      run: () => openSshDialog(),
    },
    {
      id: 'new-terminal',
      label: 'New terminal',
      description: 'Create a terminal at the canvas center.',
      disabled: isCreatingTerminal || isBootstrapping,
      run: () => void handleCreateTerminal(),
    },
    {
      id: 'save-active-file',
      label: 'Save active file',
      description: 'Save the selected editor tab (Ctrl/⌘+S).',
      disabled: dirtyEditorPathCount === 0,
      run: () => setSaveSignal((current) => current + 1),
    },
    {
      id: 'save-all-files',
      label: 'Save all files',
      description: 'Save every dirty editor tab (Ctrl/⌘+Shift+S).',
      disabled: dirtyEditorPathCount === 0,
      run: () => setSaveAllSignal((current) => current + 1),
    },
    {
      id: 'toggle-autosave',
      label: autoSave ? 'Disable auto-save' : 'Enable auto-save',
      description: 'Automatically save dirty editor tabs shortly after edits.',
      run: () => setAutoSave((current) => !current),
    },
    {
      id: 'workspace-search',
      label: 'Workspace search / replace',
      description: 'Search and replace text across the active workspace.',
      disabled: !activeWorkspaceId || activeWorkspace?.kind === 'ssh',
      run: () => setIsWorkspaceSearchOpen(true),
    },
    {
      id: 'workspace-symbols',
      label: 'Workspace symbols',
      description: 'Find classes, functions, types, and other project symbols.',
      disabled: !activeWorkspaceId || activeWorkspace?.kind === 'ssh',
      run: openWorkspaceSymbolSearch,
    },
    {
      id: 'refresh-files',
      label: 'Refresh file explorer',
      description: 'Reload the active workspace file tree.',
      disabled: !activeWorkspaceId || isLoadingFiles,
      run: () => void refreshFileTree(),
    },
    {
      id: 'kill-terminals',
      label: 'Kill all terminals',
      description: 'Stop every running T-CAN terminal session.',
      disabled: isKillingTerminals || terminalNodeCount === 0,
      run: () => void handleKillAllTerminals(),
    },
  ]

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

  function runCanvasContextCommand(command: () => void) {
    setCanvasContextMenu(null)
    command()
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null
    if (target?.closest('.terminal-node') || target?.closest('.editor-node') || target?.closest('.canvas-context-menu')) {
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
      <CommandPalette
        commands={commandPaletteCommands}
        onClose={() => setIsCommandPaletteOpen(false)}
        open={isCommandPaletteOpen}
      />
      {isWorkspaceSearchOpen && (
        <div className="workspace-search" role="presentation" onMouseDown={() => setIsWorkspaceSearchOpen(false)}>
          <section className="workspace-search__panel" aria-label="Workspace search" onMouseDown={(event) => event.stopPropagation()}>
            <header className="workspace-search__header">
              <strong>WORKSPACE SEARCH</strong>
              <button className="icon-button" onClick={() => setIsWorkspaceSearchOpen(false)} type="button">x</button>
            </header>
            <div className="workspace-search__fields">
              <input
                autoFocus
                onChange={(event) => setWorkspaceSearch((current) => ({ ...current, query: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void runWorkspaceSearch()
                  }
                }}
                placeholder="Find text across workspace"
                value={workspaceSearch.query}
              />
              <input
                onChange={(event) => setWorkspaceSearch((current) => ({ ...current, replacement: event.target.value }))}
                placeholder="Replacement text"
                value={workspaceSearch.replacement}
              />
              <div className="workspace-search__actions">
                <button className="command-button" disabled={!workspaceSearch.query || workspaceSearch.searching} onClick={() => void runWorkspaceSearch()} type="button">
                  {workspaceSearch.searching ? 'SEARCHING...' : 'Search'}
                </button>
                <button className="command-button command-button--danger" disabled={!workspaceSearch.query || workspaceSearch.searching} onClick={() => void runWorkspaceReplace()} type="button">
                  Replace all
                </button>
              </div>
            </div>
            <div className="workspace-search__results">
              {workspaceSearch.results.length === 0 ? (
                <p>No results.</p>
              ) : workspaceSearch.results.map((result) => (
                <section className="workspace-search__result" key={result.relativePath}>
                  <button onClick={() => handleOpenFileFromExplorer(result.relativePath)} type="button">{result.relativePath}</button>
                  {result.matches.slice(0, 8).map((match) => (
                    <button className="workspace-search__match" key={`${result.relativePath}-${match.line}-${match.column}`} onClick={() => handleOpenFileFromExplorer(result.relativePath)} type="button">
                      <span>{match.line}:{match.column}</span>
                      <code>{match.preview}</code>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
      {isWorkspaceSymbolOpen && (
        <div className="workspace-search" role="presentation" onMouseDown={() => setIsWorkspaceSymbolOpen(false)}>
          <section className="workspace-search__panel" aria-label="Workspace symbols" onMouseDown={(event) => event.stopPropagation()}>
            <header className="workspace-search__header">
              <strong>WORKSPACE SYMBOLS</strong>
              <button className="icon-button" onClick={() => setIsWorkspaceSymbolOpen(false)} type="button">x</button>
            </header>
            <div className="workspace-search__fields">
              <input
                autoFocus
                onChange={(event) => setWorkspaceSymbols((current) => ({ ...current, query: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void runWorkspaceSymbolSearch()
                  }
                }}
                placeholder="Search classes, functions, types, symbols"
                value={workspaceSymbols.query}
              />
              <div className="workspace-search__actions">
                <button className="command-button" disabled={workspaceSymbols.searching} onClick={() => void runWorkspaceSymbolSearch()} type="button">
                  {workspaceSymbols.searching ? 'INDEXING...' : 'Search symbols'}
                </button>
              </div>
            </div>
            <div className="workspace-search__results">
              {workspaceSymbols.results.length === 0 ? (
                <p>No symbols found.</p>
              ) : workspaceSymbols.results.map((symbol) => (
                <button
                  className="workspace-search__symbol"
                  key={`${symbol.relativePath}-${symbol.kind}-${symbol.name}-${symbol.line}-${symbol.column}`}
                  onClick={() => {
                    handleOpenFileFromExplorer(symbol.relativePath)
                    setIsWorkspaceSymbolOpen(false)
                  }}
                  type="button"
                >
                  <strong>{symbol.name}</strong>
                  <span>{symbol.kind} · {symbol.relativePath}:{symbol.line}:{symbol.column}</span>
                </button>
              ))}
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
          <button className="command-button" onClick={() => setIsCommandPaletteOpen(true)} type="button">
            COMMANDS
          </button>
          <button className="command-button" disabled={dirtyEditorPathCount === 0} onClick={() => setSaveAllSignal((current) => current + 1)} type="button">
            SAVE ALL
          </button>
          <button className="command-button" onClick={() => setAutoSave((current) => !current)} type="button">
            AUTOSAVE {autoSave ? 'ON' : 'OFF'}
          </button>
          <button className="command-button" disabled={!activeWorkspaceId || activeWorkspace?.kind === 'ssh'} onClick={() => setIsWorkspaceSearchOpen(true)} type="button">
            SEARCH
          </button>
          <button className="command-button" disabled={!activeWorkspaceId || activeWorkspace?.kind === 'ssh'} onClick={openWorkspaceSymbolSearch} type="button">
            SYMBOLS
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
                      saveAllSignal={saveAllSignal}
                      saveSignal={saveSignal}
                      scale={viewport.scale}
                      selected={selectedNodeIdSet.has(node.id)}
                      workspaceId={activeWorkspaceId}
                    />
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
                    onClose={() => void removeNode(node.id)}
                    onMoveStart={(event) => beginNodeMove(node.id, event)}
                    onResizeStart={(event, direction) => beginNodeResize(node.id, event, direction)}
                    onSelect={(event) => handleNodeSelect(node.id, event)}
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
