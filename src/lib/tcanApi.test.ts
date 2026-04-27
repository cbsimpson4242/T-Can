import { describe, expect, it, vi } from 'vitest'
import type { TCanApi } from '../../shared/api'
import type { TerminalSessionInfo, TerminalSessionSnapshot } from '../../shared/types'
import { getApi } from './tcanApi'

function createSessionInfo(overrides: Partial<TerminalSessionInfo> = {}): TerminalSessionInfo {
  return {
    sessionId: 'session-1',
    cwd: '/tmp/workspace',
    shell: '/bin/bash',
    ...overrides,
  }
}

describe('getApi', () => {
  it('preserves a preload-provided getTerminalSessionInfo implementation when available', async () => {
    const expected = createSessionInfo({ sessionId: 'session-live' })
    const getTerminalSessionInfo = vi.fn<() => Promise<TerminalSessionInfo | null>>().mockResolvedValue(expected)
    const getTerminalSession = vi.fn<() => Promise<TerminalSessionSnapshot | null>>()

    const api = getApi({
      tcan: {
        getTerminalSessionInfo,
        getTerminalSession,
      } as unknown as TCanApi,
    })

    await expect(api.getTerminalSessionInfo('session-live')).resolves.toEqual(expected)
    expect(getTerminalSessionInfo).toHaveBeenCalledWith('session-live')
    expect(getTerminalSession).not.toHaveBeenCalled()
  })

  it('falls back to getTerminalSession().info when older preload builds lack getTerminalSessionInfo', async () => {
    const expected = createSessionInfo({ sessionId: 'session-fallback' })
    const getTerminalSession = vi.fn<() => Promise<TerminalSessionSnapshot | null>>().mockResolvedValue({
      info: expected,
      output: 'hello',
    })

    const api = getApi({
      tcan: {
        getTerminalSession,
      } as unknown as TCanApi,
    })

    await expect(api.getTerminalSessionInfo('session-fallback')).resolves.toEqual(expected)
    expect(getTerminalSession).toHaveBeenCalledWith('session-fallback')
  })

  it('returns null when older preload builds expose getTerminalSession but the session no longer exists', async () => {
    const getTerminalSession = vi.fn<() => Promise<TerminalSessionSnapshot | null>>().mockResolvedValue(null)

    const api = getApi({
      tcan: {
        getTerminalSession,
      } as unknown as TCanApi,
    })

    await expect(api.getTerminalSessionInfo('missing-session')).resolves.toBeNull()
    expect(getTerminalSession).toHaveBeenCalledWith('missing-session')
  })

  it('throws a rebuild hint when the preload API is entirely unavailable', () => {
    expect(() => getApi({})).toThrow('T-CAN preload API is unavailable. Rebuild the Electron bundles and restart the app.')
  })
})
