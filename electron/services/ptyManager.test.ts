import { describe, expect, it, vi } from 'vitest'
import { PtyManager, type PtyBackend, type PtyHandle } from './ptyManager'

class FakePtyHandle implements PtyHandle {
  public dataListener: ((data: string) => void) | null = null
  public exitListener: ((exitCode: number) => void) | null = null
  public writes: string[] = []
  public resizeCalls: Array<{ cols: number; rows: number }> = []
  public killed = false

  onData(listener: (data: string) => void) {
    this.dataListener = listener
    return { dispose: () => { this.dataListener = null } }
  }

  onExit(listener: (exitCode: number) => void) {
    this.exitListener = listener
    return { dispose: () => { this.exitListener = null } }
  }

  write(data: string) {
    this.writes.push(data)
  }

  resize(cols: number, rows: number) {
    this.resizeCalls.push({ cols, rows })
  }

  kill() {
    this.killed = true
  }
}

describe('PtyManager', () => {
  it('creates, writes to, resizes, and closes PTY sessions', () => {
    const handle = new FakePtyHandle()
    const backend: PtyBackend = {
      spawn: vi.fn(() => handle),
    }
    const manager = new PtyManager({
      backend,
      defaultShell: '/bin/bash',
      env: { TEST_ENV: '1' },
    })

    const outputListener = vi.fn()
    const exitListener = vi.fn()
    manager.onOutput(outputListener)
    manager.onExit(exitListener)

    const session = manager.createSession({ cwd: '/tmp/project', cols: 120, rows: 40 })
    expect(session.cwd).toBe('/tmp/project')
    expect(backend.spawn).toHaveBeenCalledWith('/bin/bash', [], {
      cols: 120,
      cwd: '/tmp/project',
      env: expect.objectContaining({ TEST_ENV: '1' }),
      name: 'xterm-256color',
      rows: 40,
    })

    manager.write(session.sessionId, 'ls\n')
    manager.resize(session.sessionId, 100, 30)
    handle.dataListener?.('hello')

    expect(handle.writes).toEqual(['ls\n'])
    expect(handle.resizeCalls).toEqual([{ cols: 100, rows: 30 }])
    expect(outputListener).toHaveBeenCalledWith({ sessionId: session.sessionId, data: 'hello' })

    manager.close(session.sessionId)
    expect(handle.killed).toBe(true)

    const exitedSession = manager.createSession({ cwd: '/tmp/project', cols: 120, rows: 40 })
    handle.exitListener?.(7)
    expect(exitListener).toHaveBeenCalledWith({ sessionId: exitedSession.sessionId, exitCode: 7 })
  })
})
