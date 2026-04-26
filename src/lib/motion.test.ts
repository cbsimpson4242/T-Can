import { describe, expect, it, vi } from 'vitest'
import { createAnimationFrameThrottle } from './motion'

describe('createAnimationFrameThrottle', () => {
  it('coalesces multiple calls into a single animation frame using the latest value', () => {
    const requestAnimationFrame = vi.fn((_callback: (time: number) => void) => {
      return 1
    })
    const cancelAnimationFrame = vi.fn()
    const listener = vi.fn()

    const throttled = createAnimationFrameThrottle(listener, {
      requestAnimationFrame,
      cancelAnimationFrame,
    })

    throttled(1)
    throttled(2)
    throttled(3)

    expect(listener).not.toHaveBeenCalled()
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    const frame = requestAnimationFrame.mock.calls[0]?.[0] as ((time: number) => void) | undefined
    if (!frame) {
      throw new Error('Expected an animation frame callback to be scheduled')
    }

    frame(16)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(3)
  })

  it('flushes a pending frame immediately with the latest value', () => {
    const requestAnimationFrame = vi.fn(() => 7)
    const cancelAnimationFrame = vi.fn()
    const listener = vi.fn()

    const throttled = createAnimationFrameThrottle(listener, {
      requestAnimationFrame,
      cancelAnimationFrame,
    })

    throttled('first')
    throttled('latest')
    throttled.flush()

    expect(cancelAnimationFrame).toHaveBeenCalledWith(7)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('latest')
  })

  it('cancels a pending frame without invoking the listener', () => {
    const requestAnimationFrame = vi.fn(() => 7)
    const cancelAnimationFrame = vi.fn()
    const listener = vi.fn()

    const throttled = createAnimationFrameThrottle(listener, {
      requestAnimationFrame,
      cancelAnimationFrame,
    })

    throttled('pending')
    throttled.cancel()

    expect(cancelAnimationFrame).toHaveBeenCalledWith(7)
    expect(listener).not.toHaveBeenCalled()
  })
})
