import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createNodePtyBackend, PtyManager } from './services/ptyManager'
import { buildTerminalDaemonErrorResponse, type TerminalDaemonRequestMessage as RequestMessage } from './terminalDaemonProtocol'
import type { CreateTerminalRequest } from '../shared/types'

const statePath = process.argv[process.argv.indexOf('--state') + 1]
const token = process.argv[process.argv.indexOf('--token') + 1]

if (!statePath || !token) {
  process.stderr.write('[T-CAN daemon] Missing --state or --token.\n')
  process.exit(1)
}

const manager = new PtyManager({ backend: createNodePtyBackend() })
const sockets = new Set<net.Socket>()

function send(socket: net.Socket, message: unknown): void {
  socket.write(`${JSON.stringify(message)}\n`)
}

function broadcast(message: unknown): void {
  for (const socket of sockets) {
    send(socket, message)
  }
}

function parseTerminalRequest(payload: unknown): CreateTerminalRequest {
  const request = payload && typeof payload === 'object' ? (payload as CreateTerminalRequest) : {}
  return request
}

function handleRequest(message: RequestMessage): unknown {
  if (message.token !== token) {
    throw new Error('Invalid terminal daemon token')
  }

  switch (message.type) {
    case 'create':
      return manager.createSession(parseTerminalRequest(message.payload))
    case 'get': {
      const sessionId = (message.payload as { sessionId?: string } | undefined)?.sessionId
      return sessionId ? manager.getSession(sessionId) : null
    }
    case 'getInfo': {
      const sessionId = (message.payload as { sessionId?: string } | undefined)?.sessionId
      return sessionId ? manager.getSessionInfo(sessionId) : null
    }
    case 'list':
      return manager.listSessions()
    case 'write': {
      const payload = message.payload as { sessionId?: string; data?: string } | undefined
      if (payload?.sessionId && typeof payload.data === 'string') {
        manager.write(payload.sessionId, payload.data)
      }
      return null
    }
    case 'resize': {
      const payload = message.payload as { sessionId?: string; cols?: number; rows?: number } | undefined
      if (payload?.sessionId && payload.cols && payload.rows) {
        manager.resize(payload.sessionId, payload.cols, payload.rows)
      }
      return null
    }
    case 'close': {
      const sessionId = (message.payload as { sessionId?: string } | undefined)?.sessionId
      if (sessionId) {
        manager.close(sessionId)
      }
      return null
    }
    case 'closeAll':
      manager.disposeAll()
      return null
    case 'shutdownIfIdle':
      if (manager.listSessions().length === 0) {
        queueMicrotask(() => process.exit(0))
      }
      return null
    default:
      throw new Error(`Unknown terminal daemon request: ${message.type}`)
  }
}

manager.onOutput((payload) => broadcast({ event: 'output', payload }))
manager.onExit((payload) => broadcast({ event: 'exit', payload }))

const server = net.createServer((socket) => {
  sockets.add(socket)
  let buffer = ''

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let newlineIndex = buffer.indexOf('\n')

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)

      if (line.trim()) {
        try {
          const message = JSON.parse(line) as RequestMessage
          const result = handleRequest(message)
          send(socket, { id: message.id, ok: true, result })
        } catch (error) {
          const parsedMessage = (() => {
            try {
              return JSON.parse(line) as Partial<RequestMessage>
            } catch {
              return undefined
            }
          })()
          send(socket, buildTerminalDaemonErrorResponse(parsedMessage?.id ? { id: parsedMessage.id } : undefined, error))
        }
      }

      newlineIndex = buffer.indexOf('\n')
    }
  })

  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => sockets.delete(socket))
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine terminal daemon address')
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(
    statePath,
    JSON.stringify({ port: address.port, token, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2),
    'utf8',
  )
})

process.on('SIGTERM', () => {
  manager.disposeAll()
  process.exit(0)
})
