import { describe, expect, it, vi } from 'vitest'
import {
  clampNodeSize,
  clampScale,
  createCanvasRect,
  createTerminalNode,
  getNodeCanvasRect,
  getViewportCenterWorldPoint,
  rectanglesIntersect,
  resizeNodesByIds,
  snapCanvasZoomViewport,
  translateNodesByIds,
  zoomViewport,
} from './layout'

describe('layout helpers', () => {
  it('creates a terminal node with default dimensions', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000')

    const node = createTerminalNode({ x: 10, y: 20 })

    expect(node).toMatchObject({
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Terminal',
      x: 10,
      y: 20,
      width: 520,
      height: 320,
    })
  })

  it('clamps zoom scale into the supported range', () => {
    expect(clampScale(10)).toBe(2)
    expect(clampScale(0.1)).toBe(0.4)
    expect(clampScale(1.23456)).toBe(1.235)
  })

  it('zooms around the pointer anchor', () => {
    const viewport = { x: 100, y: 50, scale: 1 }

    const zoomed = zoomViewport({
      viewport,
      deltaY: -100,
      anchor: { x: 400, y: 300 },
    })

    expect(zoomed.scale).toBeGreaterThan(viewport.scale)
    expect(((400 - zoomed.x) / zoomed.scale).toFixed(4)).toBe(((400 - viewport.x) / viewport.scale).toFixed(4))
    expect(((300 - zoomed.y) / zoomed.scale).toFixed(4)).toBe(((300 - viewport.y) / viewport.scale).toFixed(4))
  })

  it('snaps canvas zoom between overview and normal around the pointer anchor', () => {
    const viewport = { x: 100, y: 50, scale: 1 }

    const zoomedOut = snapCanvasZoomViewport({
      viewport,
      deltaY: 100,
      anchor: { x: 400, y: 300 },
    })

    expect(zoomedOut.scale).toBe(0.5)
    expect(((400 - zoomedOut.x) / zoomedOut.scale).toFixed(4)).toBe(((400 - viewport.x) / viewport.scale).toFixed(4))
    expect(((300 - zoomedOut.y) / zoomedOut.scale).toFixed(4)).toBe(((300 - viewport.y) / viewport.scale).toFixed(4))

    expect(
      snapCanvasZoomViewport({
        viewport: zoomedOut,
        deltaY: -100,
        anchor: { x: 400, y: 300 },
      }).scale,
    ).toBe(1)
  })

  it('computes the canvas center in world coordinates', () => {
    expect(
      getViewportCenterWorldPoint(
        { x: 100, y: 60, scale: 2 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 150, y: 120 })
  })

  it('enforces minimum node dimensions', () => {
    expect(clampNodeSize({ width: 10, height: 20 })).toEqual({ width: 280, height: 180 })
  })

  it('creates normalized canvas rectangles', () => {
    expect(createCanvasRect({ x: 120, y: 90 }, { x: 40, y: 10 })).toEqual({
      left: 40,
      top: 10,
      right: 120,
      bottom: 90,
    })
  })

  it('projects node bounds into canvas coordinates', () => {
    expect(
      getNodeCanvasRect(
        { id: 'node-1', title: 'Terminal', x: 10, y: 20, width: 100, height: 50 },
        { x: 30, y: 40, scale: 2 },
      ),
    ).toEqual({ left: 50, top: 80, right: 250, bottom: 180 })
  })

  it('detects rectangle intersections including edge contact', () => {
    expect(
      rectanglesIntersect(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 100, top: 50, right: 150, bottom: 120 },
      ),
    ).toBe(true)
    expect(
      rectanglesIntersect(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 101, top: 50, right: 150, bottom: 120 },
      ),
    ).toBe(false)
  })

  it('translates only the selected nodes by the given delta', () => {
    const nodes = [
      { id: 'node-1', type: 'terminal' as const, title: 'One', x: 10, y: 20, width: 100, height: 80 },
      { id: 'node-2', type: 'terminal' as const, title: 'Two', x: 40, y: 50, width: 100, height: 80 },
    ]

    expect(translateNodesByIds(nodes, new Set(['node-2']), { x: 5, y: -10 })).toEqual([
      { id: 'node-1', type: 'terminal', title: 'One', x: 10, y: 20, width: 100, height: 80 },
      { id: 'node-2', type: 'terminal', title: 'Two', x: 45, y: 40, width: 100, height: 80 },
    ])
  })

  it('resizes only the selected nodes from the requested direction', () => {
    const nodes = [
      { id: 'node-1', type: 'terminal' as const, title: 'One', x: 10, y: 20, width: 300, height: 200 },
      { id: 'node-2', type: 'terminal' as const, title: 'Two', x: 50, y: 60, width: 300, height: 200 },
    ]

    expect(resizeNodesByIds(nodes, new Set(['node-1']), 'nw', { x: 30, y: 40 })).toEqual([
      { id: 'node-1', type: 'terminal', title: 'One', x: 30, y: 40, width: 280, height: 180 },
      { id: 'node-2', type: 'terminal', title: 'Two', x: 50, y: 60, width: 300, height: 200 },
    ])
  })
})
