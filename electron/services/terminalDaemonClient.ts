import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type {
  CreateTerminalRequest,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionInfo,
  TerminalSessionSnapshot,
} from '../../shared/types'

interface DaemonState {
  port: number
  token: string
  pid?: number
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
}

interface TerminalDaemonClientOptions {
  daemonPath: string
  statePath: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveNodeExecutable(): string {
  return process.env.TCAN_NODE_PATH ?? process.env.npm_node_execpath ?? 'node'
}

function readState(statePath: string): DaemonState | null {
  try {
    if (!fs.existsSync(statePath)) {
      return null
    }
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<DaemonState>
    return typeof parsed.port === 'number' && typeof parsed.token === 'string' ? { port: parsed.port, token: parsed.token, pid: parsed.pid } : null
  } catch {
    return null
  }
}

export class TerminalDaemonClient {
  private readonly daemonPath: string
  private readonly statePath: string
  private socket: net.Socket | null = null
  private state: DaemonState | null = null
  private connectionPromise: Promise<void> | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly outputListeners = new Set<(event: TerminalOutputEvent) => void>()
  private readonly exitListeners = new Set<(event: TerminalExitEvent) => void>()

  constructor(options: TerminalDaemonClientOptions) {
    this.daemonPath = options.daemonPath
    this.statePath = options.statePath
  }

  onOutput(listener: (event: TerminalOutputEvent) => void): () => void {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  onExit(listener: (event: TerminalExitEvent) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async createSession(request: CreateTerminalRequest): Promise<TerminalSessionInfo> {
    return this.request<TerminalSessionInfo>('create', request)
  }

  async getSession(sessionId: string): Promise<TerminalSessionSnapshot | null> {
    return this.request<TerminalSessionSnapshot | null>('get', { sessionId })
  }

  async listSessions(): Promise<TerminalSessionInfo[]> {
    return this.request<TerminalSessionInfo[]>('list')
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.request('write', { sessionId, data })
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.request('resize', { sessionId, cols, rows })
  }

  async close(sessionId: string): Promise<void> {
    await this.request('close', { sessionId })
  }

  async closeAll(): Promise<void> {
    await this.request('closeAll')
  }

  async shutdownIfIdle(): Promise<void> {
    await this.request('shutdownIfIdle')
  }

  private async request<T>(type: string, payload?: unknown): Promise<T> {
    await this.ensureConnected()
    if (!this.socket || !this.state) {
      throw new Error('Terminal daemon is unavailable')
    }

    const id = crypto.randomUUID()
    const message = { id, token: this.state.token, type, payload }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
      this.socket?.write(`${JSON.stringify(message)}\n`)
    })
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return
    }

    if (!this.connectionPromise) {
      this.connectionPromise = this.connect().finally(() => {
        this.connectionPromise = null
      })
    }

    await this.connectionPromise
  }

  private async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return
    }

    const existingState = readState(this.statePath)
    if (existingState && (await this.tryConnect(existingState))) {
      return
    }

    await this.startDaemon()
    const startedState = readState(this.statePath)
    if (!startedState || !(await this.tryConnect(startedState))) {
      throw new Error('Unable to start terminal daemon')
    }
  }

  private async startDaemon(): Promise<void> {
    const token = crypto.randomBytes(24).toString('hex')
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true })
    fs.rmSync(this.statePath, { force: true })

    const child = spawn(resolveNodeExecutable(), [this.daemonPath, '--state', this.statePath, '--token', token], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (readState(this.statePath)) {
        return
      }
      await delay(50)
    }
  }

  private async tryConnect(state: DaemonState): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: state.port })
      socket.once('connect', () => {
        if (this.socket && this.socket !== socket && !this.socket.destroyed) {
          this.socket.destroy()
        }
        this.socket = socket
        this.state = state
        this.installSocketHandlers(socket)
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  private installSocketHandlers(socket: net.Socket): void {
    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        this.handleLine(line)
        newlineIndex = buffer.indexOf('\n')
      }
    })

    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
      }
      for (const pending of this.pending.values()) {
        pending.reject(new Error('Terminal daemon disconnected'))
      }
      this.pending.clear()
    })
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return
    }

    const message = JSON.parse(line) as { id?: string; ok?: boolean; result?: unknown; error?: string; event?: string; payload?: unknown }
    if (message.event === 'output') {
      for (const listener of this.outputListeners) {
        listener(message.payload as TerminalOutputEvent)
      }
      return
    }
    if (message.event === 'exit') {
      for (const listener of this.exitListeners) {
        listener(message.payload as TerminalExitEvent)
      }
      return
    }
    if (!message.id) {
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }

    this.pending.delete(message.id)
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error ?? 'Terminal daemon request failed'))
    }
  }
}
