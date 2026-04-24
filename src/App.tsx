import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import './App.css'
import type { CanvasNode, PersistedAppState, PersistedLayout, PersistedWorkspace, Viewport, WorkspaceFileEntry } from '../shared/types'
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
  zoomViewport,
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

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }
const SELECTION_DRAG_THRESHOLD = 4

function getWorkspaceName(workspacePath: string): string {
  return workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
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
  const isCtrlZoomActiveRef = useRef(false)
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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isCanvasPanning, setIsCanvasPanning] = useState(false)

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])

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
        return
      }

      const api = getApi()
      setViewport(workspace.layout.viewport)
      setSelectedNodeIds([])

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

          const session = await api.createTerminal({ cwd: workspace.path })
          return { ...node, type: 'terminal' as const, sessionId: session.sessionId, shell: session.shell }
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
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setIsCommandPaletteOpen(true)
        return
      }

      if (event.key === 'Control') {
        isCtrlZoomActiveRef.current = true
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
        isCtrlZoomActiveRef.current = false
      }
    }

    const resetCtrlZoomModifier = () => {
      isCtrlZoomActiveRef.current = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', resetCtrlZoomModifier)
    document.addEventListener('visibilitychange', resetCtrlZoomModifier)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', resetCtrlZoomModifier)
      document.removeEventListener('visibilitychange', resetCtrlZoomModifier)
    }
  }, [])

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
    if (!activeWorkspaceId) {
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
    const existingNode = nodes.find((node) => node.type === 'editor' && node.filePath === relativePath)
    if (existingNode) {
      setSelectedNodeIds([existingNode.id])
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

  async function handleOpenWorkspace() {
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

  async function handleSwitchWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) {
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

    const terminalCount = workspaceId === activeWorkspaceId ? nodes.length : workspace.layout.nodes.length
    const message = terminalCount
      ? `Close workspace "${getWorkspaceName(workspace.path)}" and terminate ${terminalCount} terminal${terminalCount === 1 ? '' : 's'}?`
      : `Close workspace "${getWorkspaceName(workspace.path)}"?`

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
      const session = await getApi().createTerminal({ cwd: workspacePath })
      setNodes((current) => [...current, { ...node, sessionId: session.sessionId, shell: session.shell }])
      setSelectedNodeIds([node.id])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Unable to create a terminal.\n\n${message}`)
    } finally {
      setIsCreatingTerminal(false)
    }
  }

  async function removeNode(nodeId: string) {
    setNodes((current) => {
      const node = current.find((entry) => entry.id === nodeId)
      if (node?.type === 'terminal' && node.sessionId) {
        void getApi().closeTerminal(node.sessionId)
      }
      return current.filter((entry) => entry.id !== nodeId)
    })
    setSelectedNodeIds((current) => current.filter((entry) => entry !== nodeId))
  }

  async function handleKillAllTerminals() {
    if (!nodes.length || !window.confirm('Kill all running T-CAN terminals? This will stop any agents/processes inside them.')) {
      return
    }

    setIsKillingTerminals(true)
    try {
      await getApi().closeAllTerminals()
      setNodes([])
      setSelectedNodeIds([])
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
    if (target?.closest('.terminal-node') || target?.closest('.canvas__hud') || target?.closest('button')) {
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
    if (event.button === 1) {
      beginCanvasPan(event)
      return
    }

    beginCanvasSelection(event)
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

  function beginNodeResize(nodeId: string, event: ReactPointerEvent<HTMLButtonElement>) {
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
      const deltaWidth = (pointerEvent.clientX - previousX) / viewport.scale
      const deltaHeight = (pointerEvent.clientY - previousY) / viewport.scale

      setNodes((current) =>
        current.map((node) =>
          actionNodeIdSet.has(node.id)
            ? {
                ...node,
                ...clampNodeSize({
                  width: node.width + deltaWidth,
                  height: node.height + deltaHeight,
                }),
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

  const commandPaletteCommands = [
    {
      id: 'open-workspace',
      label: 'Add workspace',
      description: 'Open another project folder.',
      disabled: isOpeningWorkspace,
      run: () => void handleOpenWorkspace(),
    },
    {
      id: 'new-terminal',
      label: 'New terminal',
      description: 'Create a terminal at the canvas center.',
      disabled: isCreatingTerminal || isBootstrapping,
      run: () => void handleCreateTerminal(),
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
      disabled: isKillingTerminals || nodes.length === 0,
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
    if (!isCtrlZoomActiveRef.current) {
      return
    }

    event.preventDefault()
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    setViewport((current) =>
      zoomViewport({
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
          <button className="command-button" disabled={isOpeningWorkspace} onClick={() => void handleOpenWorkspace()} type="button">
            {isOpeningWorkspace ? 'OPENING...' : 'ADD WORKSPACE'}
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
            disabled={isBootstrapping || isKillingTerminals || nodes.length === 0}
            onClick={() => void handleKillAllTerminals()}
            type="button"
          >
            {isKillingTerminals ? 'KILLING...' : `KILL ALL (${nodes.length})`}
          </button>
        </div>
      </header>

      <div className="app-shell__body">
        <FileExplorer
          entries={fileEntries}
          loading={isLoadingFiles}
          onOpenFile={handleOpenFileFromExplorer}
          onRefresh={() => void refreshFileTree()}
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
                      onClose={() => void removeNode(node.id)}
                      onMoveStart={(event) => beginNodeMove(node.id, event)}
                      onResizeStart={(event) => beginNodeResize(node.id, event)}
                      onSelect={(event) => handleNodeSelect(node.id, event)}
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
                    onResizeStart={(event) => beginNodeResize(node.id, event)}
                    onSelect={(event) => handleNodeSelect(node.id, event)}
                    scale={viewport.scale}
                    selected={selectedNodeIdSet.has(node.id)}
                    sessionId={node.sessionId}
                    shell={node.shell}
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
                  disabled={isBootstrapping || isKillingTerminals || nodes.length === 0}
                  onClick={() => runCanvasContextCommand(() => void handleKillAllTerminals())}
                  role="menuitem"
                  type="button"
                >
                  {isKillingTerminals ? 'Killing terminals...' : `Kill all terminals (${nodes.length})`}
                </button>
              </div>
            )}
            {!nodes.length && !isBootstrapping && (
              <div className="empty-state">
                <p className="empty-state__title">NO ACTIVE TERMINALS</p>
                <p className="empty-state__body">Add or switch workspaces, then spawn shells at the canvas center. Zoom only works while the keyboard Ctrl key is held.</p>
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
        <span>TERMINALS: {nodes.length}</span>
        <span>WORKSPACES: {workspaces.length}</span>
        <span>ACTIVE_WORKSPACE: {workspacePath ?? 'HOME'}</span>
        <span>VIEWPORT: X={Math.round(viewport.x)} Y={Math.round(viewport.y)}</span>
      </footer>
    </div>
  )
}

export default App
