import { describe, expect, it, vi } from 'vitest'
import {
  clampNodeSize,
  clampScale,
  createTerminalNode,
  getViewportCenterWorldPoint,
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
})
