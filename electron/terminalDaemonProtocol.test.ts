import { describe, expect, it } from 'vitest'
import { buildTerminalDaemonErrorResponse } from './terminalDaemonProtocol'

describe('buildTerminalDaemonErrorResponse', () => {
  it('preserves the original request id when a daemon request fails', () => {
    expect(
      buildTerminalDaemonErrorResponse(
        { id: 'req-123' },
        new Error('boom'),
      ),
    ).toEqual({
      id: 'req-123',
      ok: false,
      error: 'boom',
    })
  })

  it('falls back to unknown only when the request id is unavailable', () => {
    expect(buildTerminalDaemonErrorResponse(undefined, 'bad request')).toEqual({
      id: 'unknown',
      ok: false,
      error: 'bad request',
    })
  })
})
