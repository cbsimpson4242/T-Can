import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  buildTerminalEnv,
  buildTerminalEnvironment,
  getDefaultShell,
  PtyManager,
  resolveDefaultShell,
  resolveShellArgs,
  resolveWindowsExecutable,
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

describe('getDefaultShell', () => {
  it('uses PowerShell by default on Windows when installed in the standard location', () => {
    expect(getDefaultShell('win32', { WINDIR: 'C:\\Windows' }, (candidate) => candidate.includes('powershell.exe'))).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
  })

  it('prefers PowerShell 7 on Windows when available', () => {
    expect(
      getDefaultShell(
        'win32',
        { ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows' },
        (candidate) => candidate.includes('pwsh.exe'),
      ),
    ).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
  })

  it('falls back to PowerShell by command name if the standard Windows path is unavailable', () => {
    expect(getDefaultShell('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, () => false)).toBe('powershell.exe')
  })

  it('prefers explicit SHELL on non-Windows', () => {
    expect(getDefaultShell('linux', { SHELL: '/bin/zsh' }, () => true)).toBe('/bin/zsh')
  })
})

describe('buildTerminalEnv', () => {
  it('adds Windows-friendly agent bin paths to PATH', () => {
    const env = buildTerminalEnv('win32', {
      PATH: 'C:\\Windows\\System32',
      USERPROFILE: 'C:\\Users\\Chris',
      APPDATA: 'C:\\Users\\Chris\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Chris\\AppData\\Local',
    })

    expect(env.PATH).toContain('C:\\Users\\Chris\\AppData\\Roaming\\npm')
    expect(env.PATH).toContain('C:\\Users\\Chris\\.opencode\\bin')
    expect(env.PATH).toContain('C:\\Users\\Chris\\AppData\\Local\\Programs\\opencode\\bin')
    expect(env.PATH).toContain('C:\\Windows\\System32\\OpenSSH')
    expect(env.PATH).toContain('C:\\Program Files\\Git\\usr\\bin')
  })

  it('preserves Windows Path casing when augmenting agent locations', () => {
    const env = buildTerminalEnv('win32', {
      Path: 'C:\\Windows\\System32',
      USERPROFILE: 'C:\\Users\\Chris',
      APPDATA: 'C:\\Users\\Chris\\AppData\\Roaming',
    })

    expect(env.Path).toContain('C:\\Users\\Chris\\AppData\\Roaming\\npm')
    expect(env.PATH).toBe(env.Path)
  })

  it('preserves TERM on non-Windows shells', () => {
    const env = buildTerminalEnv('linux', { PATH: '/usr/bin' })
    expect(env.TERM).toBe('xterm-256color')
    expect(env.PATH).toBe('/usr/bin')
  })
})

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
    ).toBe('powershell.exe')
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
    expect(buildTerminalEnvironment({ TEST_ENV: '1' }, 'win32')).toEqual({
      TEST_ENV: '1',
      PATH: 'C:\\Windows\\System32\\OpenSSH;C:\\Program Files\\Git\\usr\\bin',
    })
  })

  it('resolves Windows command names from the terminal PATH before spawning', () => {
    expect(
      resolveWindowsExecutable(
        'ssh',
        { PATH: 'C:\\Windows\\System32;C:\\Windows\\System32\\OpenSSH', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        (candidate) => candidate === 'C:\\Windows\\System32\\OpenSSH\\ssh.EXE',
      ),
    ).toBe('C:\\Windows\\System32\\OpenSSH\\ssh.EXE')
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

  it('passes Windows shell args while augmenting PATH', () => {
    const handle = new FakePtyHandle()
    const backend: PtyBackend = {
      spawn: vi.fn(() => handle),
    }

    const manager = new PtyManager({
      backend,
      defaultShell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      env: {
        APPDATA: 'C:\\Users\\Chris\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\Chris\\AppData\\Local',
        PATH: 'C:\\Windows\\System32',
        TEST_ENV: '1',
        USERPROFILE: 'C:\\Users\\Chris',
      },
      platform: 'win32',
    })

    manager.createSession({ cwd: 'C:\\workspace', cols: 100, rows: 30 })

    expect(backend.spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo'],
      {
        cols: 100,
        cwd: 'C:\\workspace',
        env: expect.objectContaining({
          PATH: expect.stringContaining('C:\\Users\\Chris\\AppData\\Roaming\\npm'),
          TEST_ENV: '1',
        }),
        name: 'xterm-256color',
        rows: 30,
      },
    )
  })

  it('can create a session from an explicit command and argument list', () => {
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

    const session = manager.createSession({ cwd: '/tmp', command: 'ssh', args: ['user@example.com'] })

    expect(session.shell).toBe('ssh')
    expect(session.command).toBe('ssh')
    expect(session.args).toEqual(['user@example.com'])
    expect(backend.spawn).toHaveBeenCalledWith('ssh', ['user@example.com'], {
      cols: 80,
      cwd: '/tmp',
      env: expect.objectContaining({ TEST_ENV: '1', TERM: 'xterm-256color' }),
      name: 'xterm-256color',
      rows: 24,
    })
  })

  it('recognizes common AI agent launch commands for duplication', () => {
    const agentCommands = [
      'pi',
      'pi agent',
      'opencode',
      'opencode-ai',
      'codex',
      'claude',
      'claude code',
      'claude-code',
      'gemini',
      'gemini cli',
      'gemini-cli',
      'aider',
      'cursor-agent',
      'cursor agent',
      'npx -y @anthropic-ai/claude-code',
      'npx @openai/codex',
      'pnpm dlx @google/gemini-cli',
      'yarn dlx opencode-ai',
      'bunx aider',
      'uvx cursor-agent',
      'npm exec -- codex',
    ]

    for (const commandLine of agentCommands) {
      const handle = new FakePtyHandle()
      const manager = new PtyManager({
        backend: { spawn: vi.fn(() => handle) },
        defaultShell: '/bin/bash',
        env: { TEST_ENV: '1' },
        platform: 'linux',
      })
      const session = manager.createSession({ cwd: '/tmp' })

      manager.write(session.sessionId, `${commandLine}\r`)

      expect(manager.getSession(session.sessionId)?.info).toMatchObject({
        agentCommandLine: commandLine,
        isAgentSession: true,
      })
    }
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
      env: {
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
        PATH: 'C:\\Windows\\System32\\OpenSSH;C:\\Program Files\\Git\\usr\\bin',
      },
      name: 'xterm-256color',
      rows: 24,
    })
    expect(backend.spawn).toHaveBeenNthCalledWith(2, 'C:\\Windows\\System32\\cmd.exe', ['/Q'], {
      cols: 80,
      cwd: 'C:\\workspace',
      env: {
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
        PATH: 'C:\\Windows\\System32\\OpenSSH;C:\\Program Files\\Git\\usr\\bin',
      },
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
