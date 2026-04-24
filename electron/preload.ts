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
  openSshWorkspace(target) {
    return ipcRenderer.invoke(IPC_CHANNELS.openSshWorkspace, { target })
  },
  switchWorkspace(workspaceId) {
    return ipcRenderer.invoke(IPC_CHANNELS.switchWorkspace, { workspaceId })
  },
  closeWorkspace(workspaceId) {
    return ipcRenderer.invoke(IPC_CHANNELS.closeWorkspace, { workspaceId })
  },
  listWorkspaceFiles(workspaceId, relativePath = '') {
    return ipcRenderer.invoke(IPC_CHANNELS.listWorkspaceFiles, { workspaceId, relativePath })
  },
  readWorkspaceFile(workspaceId, relativePath) {
    return ipcRenderer.invoke(IPC_CHANNELS.readWorkspaceFile, { workspaceId, relativePath })
  },
  saveWorkspaceFile(workspaceId, relativePath, content) {
    return ipcRenderer.invoke(IPC_CHANNELS.saveWorkspaceFile, { workspaceId, relativePath, content })
  },
  createWorkspaceFile(workspaceId, relativePath, type) {
    return ipcRenderer.invoke(IPC_CHANNELS.createWorkspaceFile, { workspaceId, relativePath, type })
  },
  renameWorkspacePath(workspaceId, relativePath, nextRelativePath) {
    return ipcRenderer.invoke(IPC_CHANNELS.renameWorkspacePath, { workspaceId, relativePath, nextRelativePath })
  },
  deleteWorkspacePath(workspaceId, relativePath) {
    return ipcRenderer.invoke(IPC_CHANNELS.deleteWorkspacePath, { workspaceId, relativePath })
  },
  duplicateWorkspacePath(workspaceId, relativePath) {
    return ipcRenderer.invoke(IPC_CHANNELS.duplicateWorkspacePath, { workspaceId, relativePath })
  },
  copyWorkspacePath(workspaceId, relativePath) {
    return ipcRenderer.invoke(IPC_CHANNELS.copyWorkspacePath, { workspaceId, relativePath })
  },
  revealWorkspacePath(workspaceId, relativePath) {
    return ipcRenderer.invoke(IPC_CHANNELS.revealWorkspacePath, { workspaceId, relativePath })
  },
  searchWorkspaceText(workspaceId, query) {
    return ipcRenderer.invoke(IPC_CHANNELS.searchWorkspaceText, { workspaceId, query })
  },
  replaceWorkspaceText(workspaceId, query, replacement) {
    return ipcRenderer.invoke(IPC_CHANNELS.replaceWorkspaceText, { workspaceId, query, replacement })
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
  closeAllTerminals() {
    return ipcRenderer.invoke(IPC_CHANNELS.closeAllTerminals)
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
  readClipboardForTerminal(request) {
    return ipcRenderer.invoke(IPC_CHANNELS.readClipboardForTerminal, request)
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
