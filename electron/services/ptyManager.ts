import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  CreateTerminalRequest,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionInfo,
  TerminalSessionSnapshot,
} from '../../shared/types'

export interface Disposable {
  dispose(): void
}

export interface PtyHandle {
  onData(listener: (data: string) => void): Disposable
  onExit(listener: (exitCode: number) => void): Disposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  readonly pid?: number
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
  output: string
}

const MAX_SESSION_OUTPUT_CHARS = 200_000

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

function pickFirstShellCandidate(
  candidates: Array<string | undefined>,
  pathExists: (candidate: string) => boolean = fs.existsSync,
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const looksLikePath = candidate.includes('\\') || candidate.includes('/')
    if (!looksLikePath || pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

export function resolveWindowsFallbackShell(env: NodeJS.ProcessEnv): string {
  return getEnvValue(env, 'COMSPEC') ?? 'cmd.exe'
}

export function resolveWindowsShell(
  env: NodeJS.ProcessEnv,
  pathExists: (candidate: string) => boolean = fs.existsSync,
): string {
  const systemRoot = getEnvValue(env, 'SystemRoot') ?? getEnvValue(env, 'WINDIR') ?? 'C:\\Windows'
  const programFiles = getEnvValue(env, 'ProgramW6432') ?? getEnvValue(env, 'ProgramFiles') ?? 'C:\\Program Files'

  return pickFirstShellCandidate(
    [
      path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      'powershell.exe',
      resolveWindowsFallbackShell(env),
    ],
    pathExists,
  ) ?? 'cmd.exe'
}

export function resolveDefaultShell(
  env: NodeJS.ProcessEnv,
  platform = process.platform,
  pathExists: (candidate: string) => boolean = fs.existsSync,
): string {
  if (platform === 'win32') {
    return resolveWindowsShell(env, pathExists)
  }

  return getEnvValue(env, 'SHELL') ?? '/bin/bash'
}

export function getDefaultShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  pathExists: (candidate: string) => boolean = fs.existsSync,
): string {
  return resolveDefaultShell(env, platform, pathExists)
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

function hasPathSeparator(command: string): boolean {
  return command.includes('\\') || command.includes('/')
}

export function resolveWindowsExecutable(
  command: string,
  env: NodeJS.ProcessEnv,
  pathExists: (candidate: string) => boolean = fs.existsSync,
): string {
  if (hasPathSeparator(command)) {
    return command
  }

  const pathValue = getEnvValue(env, 'PATH') ?? ''
  const pathExtValue = getEnvValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD'
  const commandExt = path.win32.extname(command)
  const extensions = commandExt ? [''] : pathExtValue.split(';').filter(Boolean)

  for (const pathEntry of pathValue.split(';').filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.win32.join(pathEntry, `${command}${extension}`)
      if (pathExists(candidate)) {
        return candidate
      }
    }
  }

  return command
}

function resolveSpawnCommand(request: CreateTerminalRequest, defaultShell: string, env: NodeJS.ProcessEnv, platform = process.platform) {
  if (request.command) {
    return {
      file: platform === 'win32' ? resolveWindowsExecutable(request.command, env) : request.command,
      args: request.args ?? [],
      label: request.command,
    }
  }

  return {
    file: defaultShell,
    args: resolveShellArgs(defaultShell, platform),
    label: defaultShell,
  }
}

export function buildTerminalEnvironment(
  env: NodeJS.ProcessEnv,
  platform = process.platform,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
  }

  if (platform !== 'win32') {
    nextEnv.TERM = getEnvValue(env, 'TERM') ?? 'xterm-256color'
    return nextEnv
  }

  const delimiter = ';'
  const pathKey = env.Path ? 'Path' : 'PATH'
  const currentPath = env[pathKey] ?? env.PATH ?? env.Path ?? ''
  const appData = env.APPDATA ?? (env.USERPROFILE ? path.win32.join(env.USERPROFILE, 'AppData', 'Roaming') : undefined)
  const localAppData = env.LOCALAPPDATA ?? (env.USERPROFILE ? path.win32.join(env.USERPROFILE, 'AppData', 'Local') : undefined)
  const userProfile = env.USERPROFILE
  const systemRoot = getEnvValue(env, 'SystemRoot') ?? getEnvValue(env, 'WINDIR') ?? 'C:\\Windows'
  const programFiles = getEnvValue(env, 'ProgramW6432') ?? getEnvValue(env, 'ProgramFiles') ?? 'C:\\Program Files'
  const programFilesX86 = getEnvValue(env, 'ProgramFiles(x86)')

  const candidateEntries = [
    appData ? path.win32.join(appData, 'npm') : undefined,
    userProfile ? path.win32.join(userProfile, '.opencode', 'bin') : undefined,
    localAppData ? path.win32.join(localAppData, 'Programs', 'opencode', 'bin') : undefined,
    path.win32.join(systemRoot, 'System32', 'OpenSSH'),
    path.win32.join(programFiles, 'Git', 'usr', 'bin'),
    programFilesX86 ? path.win32.join(programFilesX86, 'Git', 'usr', 'bin') : undefined,
  ].filter((entry): entry is string => Boolean(entry))

  const segments = new Set(currentPath.split(delimiter).filter(Boolean))
  for (const entry of candidateEntries) {
    segments.add(entry)
  }

  nextEnv[pathKey] = Array.from(segments).join(delimiter)
  nextEnv.PATH = nextEnv[pathKey]
  return nextEnv
}

export function buildTerminalEnv(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return buildTerminalEnvironment(env, platform)
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
    const spawnOptions = {
      name: 'xterm-256color',
      cols: request.cols ?? 80,
      rows: request.rows ?? 24,
      cwd,
      env,
    }
    let shell = request.command ?? this.defaultShell
    let handle: PtyHandle

    try {
      const command = resolveSpawnCommand(request, this.defaultShell, env, this.platform)
      shell = command.label
      handle = this.backend.spawn(command.file, command.args, spawnOptions)
    } catch (error) {
      if (request.command) {
        const reason = error instanceof Error ? error.message : String(error)
        handle = createUnavailablePtyBackend(`Unable to launch ${request.command}: ${reason}`).spawn(
          request.command,
          request.args ?? [],
          spawnOptions,
        )
      } else if (this.platform !== 'win32') {
        const reason = error instanceof Error ? error.message : String(error)
        handle = createUnavailablePtyBackend(`Unable to launch ${shell}: ${reason}`).spawn(
          shell,
          resolveShellArgs(shell, this.platform),
          spawnOptions,
        )
      } else {
        const firstReason = error instanceof Error ? error.message : String(error)
        const fallbackShell = resolveWindowsFallbackShell(this.env)

        if (fallbackShell === shell) {
          handle = createUnavailablePtyBackend(`Unable to launch ${shell}: ${firstReason}`).spawn(
            shell,
            resolveShellArgs(shell, this.platform),
            spawnOptions,
          )
        } else {
          shell = fallbackShell
          try {
            handle = this.backend.spawn(shell, resolveShellArgs(shell, this.platform), spawnOptions)
          } catch (fallbackError) {
            const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            handle = createUnavailablePtyBackend(
              [`Unable to launch ${this.defaultShell}: ${firstReason}`, `Unable to launch ${shell}: ${fallbackReason}`].join(
                '\n',
              ),
            ).spawn(shell, resolveShellArgs(shell, this.platform), spawnOptions)
          }
        }
      }
    }

    const info: TerminalSessionInfo = {
      sessionId,
      cwd,
      shell,
      command: request.command,
      args: request.args,
      pid: handle.pid,
    }

    const disposables = [
      handle.onData((data) => {
        const session = this.sessions.get(sessionId)
        if (session) {
          session.output = `${session.output}${data}`.slice(-MAX_SESSION_OUTPUT_CHARS)
        }
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

    this.sessions.set(sessionId, { info, handle, disposables, output: '' })
    return info
  }

  getSession(sessionId: string): TerminalSessionSnapshot | null {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }

    return {
      info: session.info,
      output: session.output,
    }
  }

  listSessions(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info)
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

function createUnavailablePtyBackend(reason: string): PtyBackend {
  return {
    spawn(file, _args, options) {
      const dataListeners = new Set<(data: string) => void>()
      const exitListeners = new Set<(exitCode: number) => void>()
      let closed = false

      queueMicrotask(() => {
        const message = [
          '[T-CAN] Terminal backend unavailable.',
          reason,
          `shell: ${file}`,
          `cwd: ${options.cwd}`,
          'Install Visual Studio with the "Desktop development with C++" workload, then reinstall dependencies.',
          '',
        ].join('\r\n')

        for (const listener of dataListeners) {
          listener(message)
        }
      })

      return {
        onData(listener) {
          dataListeners.add(listener)
          return {
            dispose() {
              dataListeners.delete(listener)
            },
          }
        },
        onExit(listener) {
          exitListeners.add(listener)
          return {
            dispose() {
              exitListeners.delete(listener)
            },
          }
        },
        write() {},
        resize() {},
        kill() {
          if (closed) {
            return
          }
          closed = true
          for (const listener of exitListeners) {
            listener(0)
          }
        },
        pid: undefined,
      }
    },
  }
}

export function createNodePtyBackend(): PtyBackend {
  try {
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
          pid: pty.pid,
        }
      },
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[T-CAN] Falling back to disabled PTY backend: ${reason}\n`)
    return createUnavailablePtyBackend(reason)
  }
}
