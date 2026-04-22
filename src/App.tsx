import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import './App.css'
import type { PersistedLayout, TerminalNode as TerminalNodeModel, Viewport } from '../shared/types'
import { TerminalNode } from './components/TerminalNode'
import {
  clampNodeSize,
  createTerminalNode,
  getViewportCenterWorldPoint,
  zoomViewport,
} from './lib/layout'

interface ActiveNode extends TerminalNodeModel {
  sessionId?: string
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }

function App() {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [nodes, setNodes] = useState<ActiveNode[]>([])
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false)
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false)

  const layout = useMemo<PersistedLayout>(
    () => ({
      nodes: nodes.map((node) => ({
        id: node.id,
        title: node.title,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      })),
      viewport,
    }),
    [nodes, viewport],
  )

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const state = await window.tcan.getAppState()
      if (cancelled) {
        return
      }

      setWorkspacePath(state.workspacePath)
      setViewport(state.layout.viewport)

      const restoredNodes = await Promise.all(
        state.layout.nodes.map(async (node) => {
          const session = await window.tcan.createTerminal({ cwd: state.workspacePath })
          return { ...node, sessionId: session.sessionId }
        }),
      )

      if (cancelled) {
        return
      }

      setNodes(restoredNodes)
      setIsBootstrapping(false)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isBootstrapping) {
      return
    }
    void window.tcan.saveLayout(layout)
  }, [isBootstrapping, layout])

  async function handleOpenWorkspace() {
    setIsOpeningWorkspace(true)
    try {
      const nextWorkspace = await window.tcan.openWorkspace()
      setWorkspacePath(nextWorkspace)
    } finally {
      setIsOpeningWorkspace(false)
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
      const session = await window.tcan.createTerminal({ cwd: workspacePath })
      setNodes((current) => [...current, { ...node, sessionId: session.sessionId }])
    } finally {
      setIsCreatingTerminal(false)
    }
  }

  async function removeNode(nodeId: string) {
    setNodes((current) => {
      const node = current.find((entry) => entry.id === nodeId)
      if (node?.sessionId) {
        void window.tcan.closeTerminal(node.sessionId)
      }
      return current.filter((entry) => entry.id !== nodeId)
    })
  }

  function updateNode(nodeId: string, updater: (node: ActiveNode) => ActiveNode) {
    setNodes((current) => current.map((node) => (node.id === nodeId ? updater(node) : node)))
  }

  function beginCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return
    }

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
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
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
      <aside className="sidebar">
        <div className="sidebar__brand">
          <p className="eyebrow">T-CAN MVP</p>
          <h1>Terminal canvas</h1>
          <p className="lede">Linux-first Electron workspace with pannable, zoomable terminals.</p>
        </div>
        <div className="sidebar__actions">
          <button disabled={isOpeningWorkspace} onClick={() => void handleOpenWorkspace()} type="button">
            {isOpeningWorkspace ? 'Opening…' : 'Open workspace'}
          </button>
          <button disabled={isCreatingTerminal || isBootstrapping} onClick={() => void handleCreateTerminal()} type="button">
            {isCreatingTerminal ? 'Creating…' : 'New terminal'}
          </button>
        </div>
        <section className="sidebar__panel">
          <h2>Workspace</h2>
          <p className="path">{workspacePath ?? 'No folder selected'}</p>
          <p className="hint">New terminals start in the workspace root when available.</p>
        </section>
        <section className="sidebar__panel">
          <h2>Canvas</h2>
          <dl className="stats">
            <div>
              <dt>Zoom</dt>
              <dd>{Math.round(viewport.scale * 100)}%</dd>
            </div>
            <div>
              <dt>Nodes</dt>
              <dd>{nodes.length}</dd>
            </div>
          </dl>
        </section>
      </aside>
      <main className="workspace">
        <div
          className="canvas"
          onPointerDown={beginCanvasPan}
          onWheel={handleWheel}
          ref={canvasRef}
          role="presentation"
        >
          <div
            className="canvas__world"
            style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
          >
            {nodes.map((node) => (
              <TerminalNode
                key={node.id}
                node={node}
                onClose={() => void removeNode(node.id)}
                onMove={(delta) =>
                  updateNode(node.id, (current) => ({
                    ...current,
                    x: current.x + delta.x,
                    y: current.y + delta.y,
                  }))
                }
                onResize={(delta) =>
                  updateNode(node.id, (current) => ({
                    ...current,
                    ...clampNodeSize({
                      width: current.width + delta.width,
                      height: current.height + delta.height,
                    }),
                  }))
                }
                scale={viewport.scale}
                sessionId={node.sessionId}
                workspacePath={workspacePath}
              />
            ))}
          </div>
          {!nodes.length && !isBootstrapping && (
            <div className="empty-state">
              <p>No terminals yet.</p>
              <button onClick={() => void handleCreateTerminal()} type="button">
                Create one at center
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
