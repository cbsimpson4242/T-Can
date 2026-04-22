import type { TerminalNode, Viewport } from '../../shared/types'

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
    title: 'Terminal',
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
