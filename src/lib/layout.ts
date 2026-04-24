import type { CanvasNode, EditorNode, TerminalNode, Viewport } from '../../shared/types'

export interface CanvasRect {
  left: number
  top: number
  right: number
  bottom: number
}

export const DEFAULT_NODE_SIZE = {
  width: 520,
  height: 320,
} as const

export const MIN_NODE_SIZE = {
  width: 280,
  height: 180,
} as const

export function createTerminalNode(position: { x: number; y: number }): TerminalNode {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `node-${Math.random().toString(36).slice(2, 11)}`

  return {
    id,
    type: 'terminal',
    title: 'Terminal',
    x: position.x,
    y: position.y,
    width: DEFAULT_NODE_SIZE.width,
    height: DEFAULT_NODE_SIZE.height,
  }
}

export function createEditorNode(position: { x: number; y: number }, filePath: string): EditorNode {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `node-${Math.random().toString(36).slice(2, 11)}`
  const title = filePath.split(/[/\\]/).pop() || filePath

  return {
    id,
    type: 'editor',
    title,
    filePath,
    x: position.x,
    y: position.y,
    width: DEFAULT_NODE_SIZE.width,
    height: DEFAULT_NODE_SIZE.height,
  }
}

export function clampScale(scale: number): number {
  return Math.min(2, Math.max(0.4, Number(scale.toFixed(3))))
}

export function zoomViewport(args: {
  viewport: Viewport
  deltaY: number
  anchor: { x: number; y: number }
}): Viewport {
  const { viewport, deltaY, anchor } = args
  const zoomFactor = deltaY < 0 ? 1.1 : 0.9
  const nextScale = clampScale(viewport.scale * zoomFactor)
  const worldX = (anchor.x - viewport.x) / viewport.scale
  const worldY = (anchor.y - viewport.y) / viewport.scale

  return {
    scale: nextScale,
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
  }
}

export const CANVAS_ZOOMED_OUT_SCALE = 0.5
export const CANVAS_NORMAL_SCALE = 1

export function snapCanvasZoomViewport(args: {
  viewport: Viewport
  deltaY: number
  anchor: { x: number; y: number }
}): Viewport {
  const { viewport, deltaY, anchor } = args
  const nextScale = deltaY > 0 ? CANVAS_ZOOMED_OUT_SCALE : CANVAS_NORMAL_SCALE

  if (viewport.scale === nextScale) {
    return viewport
  }

  const worldX = (anchor.x - viewport.x) / viewport.scale
  const worldY = (anchor.y - viewport.y) / viewport.scale

  return {
    scale: nextScale,
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
  }
}

export function getViewportCenterWorldPoint(viewport: Viewport, bounds: { width: number; height: number }) {
  return {
    x: (bounds.width / 2 - viewport.x) / viewport.scale,
    y: (bounds.height / 2 - viewport.y) / viewport.scale,
  }
}

export function clampNodeSize(size: { width: number; height: number }) {
  return {
    width: Math.max(MIN_NODE_SIZE.width, Math.round(size.width)),
    height: Math.max(MIN_NODE_SIZE.height, Math.round(size.height)),
  }
}

export function createCanvasRect(start: { x: number; y: number }, end: { x: number; y: number }): CanvasRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  }
}

export function getNodeCanvasRect(node: CanvasNode, viewport: Viewport): CanvasRect {
  const left = viewport.x + node.x * viewport.scale
  const top = viewport.y + node.y * viewport.scale

  return {
    left,
    top,
    right: left + node.width * viewport.scale,
    bottom: top + node.height * viewport.scale,
  }
}

export function rectanglesIntersect(a: CanvasRect, b: CanvasRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}
