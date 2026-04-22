import os from 'node:os'
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
}

export class PtyManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly outputListeners = new Set<(event: TerminalOutputEvent) => void>()
  private readonly exitListeners = new Set<(event: TerminalExitEvent) => void>()
  private readonly defaultShell: string
  private readonly env: NodeJS.ProcessEnv
  private readonly options: PtyManagerOptions

  constructor(options: PtyManagerOptions) {
    this.options = options
    this.defaultShell = options.defaultShell ?? process.env.SHELL ?? '/bin/bash'
    this.env = options.env ?? process.env
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
    const handle = this.options.backend.spawn(this.defaultShell, [], {
      name: 'xterm-256color',
      cols: request.cols ?? 80,
      rows: request.rows ?? 24,
      cwd,
      env: {
        ...this.env,
        TERM: 'xterm-256color',
      },
    })

    const info: TerminalSessionInfo = {
      sessionId,
      cwd,
      shell: this.defaultShell,
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
  const nodePty = require('node-pty') as typeof import('node-pty')

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
