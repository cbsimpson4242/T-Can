import { useSyncExternalStore } from 'react'

const outputListeners = new Map<string, Set<(data: string) => void>>()
const exitListeners = new Map<string, Set<(exitCode: number) => void>>()
const pasteListeners = new Map<string, Set<(data: string) => void>>()
const latestExitCodes = new Map<string, number>()
const exitStoreListeners = new Set<() => void>()
let subscribed = false

function emitExitStoreChange() {
  exitStoreListeners.forEach((listener) => listener())
}

function ensureSubscriptions() {
  if (subscribed) {
    return
  }
  subscribed = true

  window.tcan.onTerminalOutput(({ sessionId, data }) => {
    outputListeners.get(sessionId)?.forEach((listener) => listener(data))
  })

  window.tcan.onTerminalExit(({ sessionId, exitCode }) => {
    latestExitCodes.set(sessionId, exitCode)
    exitListeners.get(sessionId)?.forEach((listener) => listener(exitCode))
    emitExitStoreChange()
  })

  window.tcan.onTerminalPaste(({ sessionId, data }) => {
    pasteListeners.get(sessionId)?.forEach((listener) => listener(data))
  })
}

export function subscribeToTerminalOutput(sessionId: string, listener: (data: string) => void): () => void {
  ensureSubscriptions()
  const listeners = outputListeners.get(sessionId) ?? new Set<(data: string) => void>()
  listeners.add(listener)
  outputListeners.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      outputListeners.delete(sessionId)
    }
  }
}

export function subscribeToTerminalExit(sessionId: string, listener: (exitCode: number) => void): () => void {
  ensureSubscriptions()
  const listeners = exitListeners.get(sessionId) ?? new Set<(exitCode: number) => void>()
  listeners.add(listener)
  exitListeners.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      exitListeners.delete(sessionId)
    }
  }
}

export function subscribeToTerminalPaste(sessionId: string, listener: (data: string) => void): () => void {
  ensureSubscriptions()
  const listeners = pasteListeners.get(sessionId) ?? new Set<(data: string) => void>()
  listeners.add(listener)
  pasteListeners.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      pasteListeners.delete(sessionId)
    }
  }
}

export function useTerminalExit(sessionId?: string) {
  ensureSubscriptions()

  return useSyncExternalStore(
    (listener) => {
      exitStoreListeners.add(listener)
      return () => exitStoreListeners.delete(listener)
    },
    () => (sessionId ? latestExitCodes.get(sessionId) ?? null : null),
    () => null,
  )
}
