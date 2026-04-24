import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  buildTerminalEnvironment,
  PtyManager,
  resolveDefaultShell,
  resolveShellArgs,
  resolveWindowsFallbackShell,
  resolveWindowsShell,
  type PtyBackend,
  type PtyHandle,
} from './ptyManager'

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
  it('uses the configured Unix shell when present', () => {
    expect(resolveDefaultShell({ SHELL: '/usr/bin/zsh' }, 'linux')).toBe('/usr/bin/zsh')
    expect(resolveDefaultShell({}, 'linux')).toBe('/bin/bash')
  })

  it('prefers PowerShell on Windows and falls back to COMSPEC', () => {
    const existsSyncSpy = vi.spyOn(fs, 'existsSync')

    existsSyncSpy.mockImplementation(
      (candidate) => candidate === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
    expect(
      resolveWindowsShell({
        ProgramFiles: 'C:\\Program Files',
        SystemRoot: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      }),
    ).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')

    existsSyncSpy.mockImplementation((candidate) => candidate === 'C:\\Windows\\System32\\cmd.exe')
    expect(
      resolveWindowsShell({
        ProgramFiles: 'C:\\Program Files',
        SystemRoot: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      }),
    ).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(resolveWindowsFallbackShell({ COMSPEC: 'C:\\Windows\\System32\\cmd.exe' })).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    )

    existsSyncSpy.mockRestore()
  })

  it('uses shell-specific launch args and platform-specific terminal environment', () => {
    expect(resolveShellArgs('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32')).toEqual(['-NoLogo'])
    expect(resolveShellArgs('C:\\Windows\\System32\\cmd.exe', 'win32')).toEqual(['/Q'])
    expect(resolveShellArgs('/bin/bash', 'linux')).toEqual([])

    expect(buildTerminalEnvironment({ TEST_ENV: '1' }, 'linux')).toEqual({
      TEST_ENV: '1',
      TERM: 'xterm-256color',
    })
    expect(buildTerminalEnvironment({ TERM: 'screen-256color', TEST_ENV: '1' }, 'linux')).toEqual({
      TERM: 'screen-256color',
      TEST_ENV: '1',
    })
    expect(buildTerminalEnvironment({ TEST_ENV: '1' }, 'win32')).toEqual({ TEST_ENV: '1' })
  })

  it('creates, writes to, resizes, and closes PTY sessions', () => {
    const handle = new FakePtyHandle()
    const backend: PtyBackend = {
      spawn: vi.fn(() => handle),
    }
    const manager = new PtyManager({
      backend,
      defaultShell: '/bin/bash',
      env: { TEST_ENV: '1' },
      platform: 'linux',
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
      env: expect.objectContaining({ TEST_ENV: '1', TERM: 'xterm-256color' }),
      name: 'xterm-256color',
      rows: 40,
    })

    manager.write(session.sessionId, 'ls\n')
    manager.resize(session.sessionId, 100, 30)
    handle.dataListener?.('hello')

    expect(handle.writes).toEqual(['ls\n'])
    expect(handle.resizeCalls).toEqual([{ cols: 100, rows: 30 }])
    expect(outputListener).toHaveBeenCalledWith({ sessionId: session.sessionId, data: 'hello' })
    expect(manager.listSessions()).toEqual([session])
    expect(manager.getSession(session.sessionId)).toEqual({ info: session, output: 'hello' })

    manager.close(session.sessionId)
    expect(handle.killed).toBe(true)

    const exitedSession = manager.createSession({ cwd: '/tmp/project', cols: 120, rows: 40 })
    handle.exitListener?.(7)
    expect(exitListener).toHaveBeenCalledWith({ sessionId: exitedSession.sessionId, exitCode: 7 })
  })

  it('passes Windows shell args without forcing TERM', () => {
    const handle = new FakePtyHandle()
    const backend: PtyBackend = {
      spawn: vi.fn(() => handle),
    }

    const manager = new PtyManager({
      backend,
      defaultShell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      env: { TEST_ENV: '1' },
      platform: 'win32',
    })

    manager.createSession({ cwd: 'C:\\workspace', cols: 100, rows: 30 })

    expect(backend.spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo'],
      {
        cols: 100,
        cwd: 'C:\\workspace',
        env: { TEST_ENV: '1' },
        name: 'xterm-256color',
        rows: 30,
      },
    )
  })

  it('falls back to cmd on Windows if the preferred shell fails to spawn', () => {
    const handle = new FakePtyHandle()
    const backend: PtyBackend = {
      spawn: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('pwsh failed')
        })
        .mockImplementationOnce(() => handle),
    }

    const manager = new PtyManager({
      backend,
      defaultShell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      platform: 'win32',
    })

    const session = manager.createSession({ cwd: 'C:\\workspace' })

    expect(session.shell).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(backend.spawn).toHaveBeenNthCalledWith(1, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', ['-NoLogo'], {
      cols: 80,
      cwd: 'C:\\workspace',
      env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      name: 'xterm-256color',
      rows: 24,
    })
    expect(backend.spawn).toHaveBeenNthCalledWith(2, 'C:\\Windows\\System32\\cmd.exe', ['/Q'], {
      cols: 80,
      cwd: 'C:\\workspace',
      env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      name: 'xterm-256color',
      rows: 24,
    })
  })

  it('creates a diagnostic session when both Windows shells fail to spawn', () => {
    const backend: PtyBackend = {
      spawn: vi.fn(() => {
        throw new Error('blocked by policy')
      }),
    }

    const manager = new PtyManager({
      backend,
      defaultShell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      platform: 'win32',
    })

    const session = manager.createSession({ cwd: 'C:\\workspace' })

    expect(session.shell).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(() => manager.write(session.sessionId, 'dir\n')).not.toThrow()
  })

  it('creates a diagnostic session when a Unix shell fails to spawn', () => {
    const backend: PtyBackend = {
      spawn: vi.fn(() => {
        throw new Error('permission denied')
      }),
    }

    const manager = new PtyManager({
      backend,
      defaultShell: '/bin/bash',
      env: { TEST_ENV: '1' },
      platform: 'linux',
    })

    const session = manager.createSession({ cwd: '/tmp/project' })

    expect(session.shell).toBe('/bin/bash')
    expect(() => manager.resize(session.sessionId, 120, 40)).not.toThrow()
  })
})
