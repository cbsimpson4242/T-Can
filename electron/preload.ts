import { clipboard, contextBridge, ipcRenderer } from 'electron'
import type { TCanApi } from '../shared/api'
import { IPC_CHANNELS } from '../shared/ipc'
import type { ClipboardTextMode, TerminalExitEvent, TerminalOutputEvent, TerminalPasteEvent } from '../shared/types'

const api: TCanApi = {
  getAppState() {
    return ipcRenderer.invoke(IPC_CHANNELS.getAppState)
  },
  openWorkspace() {
    return ipcRenderer.invoke(IPC_CHANNELS.openWorkspace)
  },
  saveLayout(layout) {
    return ipcRenderer.invoke(IPC_CHANNELS.saveLayout, layout)
  },
  createTerminal(request) {
    return ipcRenderer.invoke(IPC_CHANNELS.createTerminal, request)
  },
  getTerminalSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.getTerminalSession, { sessionId })
  },
  listTerminals() {
    return ipcRenderer.invoke(IPC_CHANNELS.listTerminals)
  },
  writeTerminal(sessionId, data) {
    return ipcRenderer.invoke(IPC_CHANNELS.writeTerminal, { sessionId, data })
  },
  resizeTerminal(sessionId, cols, rows) {
    return ipcRenderer.invoke(IPC_CHANNELS.resizeTerminal, { sessionId, cols, rows })
  },
  closeTerminal(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.closeTerminal, { sessionId })
  },
  readClipboardText(mode: ClipboardTextMode = 'clipboard') {
    try {
      return Promise.resolve(clipboard.readText(mode))
    } catch (error) {
      if (mode === 'selection') {
        return Promise.resolve('')
      }
      return Promise.reject(error)
    }
  },
  showTerminalContextMenu(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.showTerminalContextMenu, { sessionId })
  },
  onTerminalOutput(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalOutputEvent) => listener(payload)
    ipcRenderer.on(IPC_CHANNELS.terminalOutput, wrapped)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalOutput, wrapped)
  },
  onTerminalExit(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => listener(payload)
    ipcRenderer.on(IPC_CHANNELS.terminalExit, wrapped)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalExit, wrapped)
  },
  onTerminalPaste(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalPasteEvent) => listener(payload)
    ipcRenderer.on(IPC_CHANNELS.terminalPaste, wrapped)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalPaste, wrapped)
  },
}

contextBridge.exposeInMainWorld('tcan', api)
