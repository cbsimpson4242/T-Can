import type {
  ClipboardTextMode,
  CreateTerminalRequest,
  PersistedAppState,
  PersistedLayout,
  TerminalClipboardRequest,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalPasteEvent,
  TerminalSessionInfo,
  TerminalSessionSnapshot,
} from './types'

export interface TCanApi {
  getAppState(): Promise<PersistedAppState>
  openWorkspace(): Promise<PersistedAppState>
  switchWorkspace(workspaceId: string): Promise<PersistedAppState>
  closeWorkspace(workspaceId: string): Promise<PersistedAppState>
  saveLayout(layout: PersistedLayout): Promise<PersistedAppState>
  createTerminal(request: CreateTerminalRequest): Promise<TerminalSessionInfo>
  getTerminalSession(sessionId: string): Promise<TerminalSessionSnapshot | null>
  listTerminals(): Promise<TerminalSessionInfo[]>
  writeTerminal(sessionId: string, data: string): Promise<void>
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>
  closeTerminal(sessionId: string): Promise<void>
  closeAllTerminals(): Promise<void>
  readClipboardText(mode?: ClipboardTextMode): Promise<string>
  readClipboardForTerminal(request: TerminalClipboardRequest): Promise<string>
  showTerminalContextMenu(sessionId: string): Promise<void>
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void
  onTerminalPaste(listener: (event: TerminalPasteEvent) => void): () => void
}
