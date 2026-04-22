import type {
  CreateTerminalRequest,
  PersistedAppState,
  PersistedLayout,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionInfo,
} from './types'

export interface TCanApi {
  getAppState(): Promise<PersistedAppState>
  openWorkspace(): Promise<string | null>
  saveLayout(layout: PersistedLayout): Promise<PersistedAppState>
  createTerminal(request: CreateTerminalRequest): Promise<TerminalSessionInfo>
  writeTerminal(sessionId: string, data: string): Promise<void>
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>
  closeTerminal(sessionId: string): Promise<void>
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void
}
