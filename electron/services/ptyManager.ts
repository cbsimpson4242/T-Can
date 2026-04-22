import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CreateTerminalRequest, TerminalExitEvent, TerminalOutputEvent, TerminalSessionInfo } from '../../shared/types'

export interface Disposable {
  dispose(): void
}

export interface PtyHandle {
  onData(listener: (data: string) => void): Disposable
  onExit(listener: (exitCode: number) => void): Disposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface PtyBackend {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: NodeJS.ProcessEnv
    },
  ): PtyHandle
}

interface SessionRecord {
  info: TerminalSessionInfo
  handle: PtyHandle
  disposables: Disposable[]
}

interface PtyManagerOptions {
  backend: PtyBackend
  defaultShell?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = env[key]
  if (direct) {
    return direct
  }

  const lowerKey = key.toLowerCase()
  const matchedKey = Object.keys(env).find((entry) => entry.toLowerCase() === lowerKey)
  return matchedKey ? env[matchedKey] : undefined
}

function pickFirstShellCandidate(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const looksLikePath = candidate.includes('\\') || candidate.includes('/')
    if (!looksLikePath || fs.existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

export function resolveWindowsFallbackShell(env: NodeJS.ProcessEnv): string {
  return pickFirstShellCandidate([getEnvValue(env, 'COMSPEC'), 'cmd.exe']) ?? 'cmd.exe'
}

export function resolveWindowsShell(env: NodeJS.ProcessEnv): string {
  const systemRoot = getEnvValue(env, 'SystemRoot') ?? 'C:\\Windows'
  const programFiles = getEnvValue(env, 'ProgramW6432') ?? getEnvValue(env, 'ProgramFiles') ?? 'C:\\Program Files'

  return pickFirstShellCandidate([
    path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    resolveWindowsFallbackShell(env),
  ]) ?? 'cmd.exe'
}

export function resolveDefaultShell(env: NodeJS.ProcessEnv, platform = process.platform): string {
  if (platform === 'win32') {
    return resolveWindowsShell(env)
  }

  return getEnvValue(env, 'SHELL') ?? '/bin/bash'
}

function getShellCommandName(shell: string, platform = process.platform): string {
  const basename = platform === 'win32' ? path.win32.basename(shell) : path.posix.basename(shell)
  return basename.toLowerCase()
}

export function resolveShellArgs(shell: string, platform = process.platform): string[] {
  if (platform !== 'win32') {
    return []
  }

  const command = getShellCommandName(shell, platform)
  if (command === 'pwsh.exe' || command === 'pwsh' || command === 'powershell.exe' || command === 'powershell') {
    return ['-NoLogo']
  }

  if (command === 'cmd.exe' || command === 'cmd') {
    return ['/Q']
  }

  return []
}

export function buildTerminalEnvironment(
  env: NodeJS.ProcessEnv,
  platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform === 'win32') {
    return { ...env }
  }

  return {
    ...env,
    TERM: getEnvValue(env, 'TERM') ?? 'xterm-256color',
  }
}

export class PtyManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly outputListeners = new Set<(event: TerminalOutputEvent) => void>()
  private readonly exitListeners = new Set<(event: TerminalExitEvent) => void>()
  private readonly backend: PtyBackend
  private readonly defaultShell: string
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform

  constructor(options: PtyManagerOptions) {
    this.backend = options.backend
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    this.defaultShell = options.defaultShell ?? resolveDefaultShell(this.env, this.platform)
  }

  onOutput(listener: (event: TerminalOutputEvent) => void): () => void {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  onExit(listener: (event: TerminalExitEvent) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  createSession(request: CreateTerminalRequest): TerminalSessionInfo {
    const sessionId = crypto.randomUUID()
    const cwd = request.cwd ?? process.cwd()
    const env = buildTerminalEnvironment(this.env, this.platform)
    let shell = this.defaultShell
    let handle: PtyHandle

    try {
      handle = this.backend.spawn(shell, resolveShellArgs(shell, this.platform), {
        name: 'xterm-256color',
        cols: request.cols ?? 80,
        rows: request.rows ?? 24,
        cwd,
        env,
      })
    } catch (error) {
      if (this.platform !== 'win32') {
        throw error
      }

      const fallbackShell = resolveWindowsFallbackShell(this.env)
      if (fallbackShell === shell) {
        throw error
      }

      shell = fallbackShell
      handle = this.backend.spawn(shell, resolveShellArgs(shell, this.platform), {
        name: 'xterm-256color',
        cols: request.cols ?? 80,
        rows: request.rows ?? 24,
        cwd,
        env,
      })
    }

    const info: TerminalSessionInfo = {
      sessionId,
      cwd,
      shell,
    }

    const disposables = [
      handle.onData((data) => {
        for (const listener of this.outputListeners) {
          listener({ sessionId, data })
        }
      }),
      handle.onExit((exitCode) => {
        for (const listener of this.exitListeners) {
          listener({ sessionId, exitCode })
        }
        this.disposeSession(sessionId, false)
      }),
    ]

    this.sessions.set(sessionId, { info, handle, disposables })
    return info
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.handle.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.handle.resize(cols, rows)
  }

  close(sessionId: string): void {
    this.disposeSession(sessionId, true)
  }

  disposeAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.disposeSession(sessionId, true)
    }
  }

  private disposeSession(sessionId: string, killHandle: boolean): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.delete(sessionId)
    for (const disposable of session.disposables) {
      disposable.dispose()
    }
    if (killHandle) {
      session.handle.kill()
    }
  }
}

export function createNodePtyBackend(): PtyBackend {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePty = require('@homebridge/node-pty-prebuilt-multiarch') as typeof import('@homebridge/node-pty-prebuilt-multiarch')

  return {
    spawn(file, args, options) {
      const pty = nodePty.spawn(file, args, options)
      return {
        onData(listener) {
          return pty.onData(listener)
        },
        onExit(listener) {
          return pty.onExit((event) => listener(event.exitCode ?? 0))
        },
        write(data) {
          pty.write(data)
        },
        resize(cols, rows) {
          pty.resize(cols, rows)
        },
        kill() {
          if (os.platform() === 'win32') {
            pty.kill()
            return
          }
          pty.kill('SIGTERM')
        },
      }
    },
  }
}
