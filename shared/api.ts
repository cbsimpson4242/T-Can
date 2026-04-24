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
  WorkspaceFileEntry,
  WorkspaceFileMutationResult,
  WorkspaceFileReadResult,
  WorkspaceTextSearchResult,
} from './types'

export interface TCanApi {
  getAppState(): Promise<PersistedAppState>
  openWorkspace(): Promise<PersistedAppState>
  openSshWorkspace(target: string): Promise<PersistedAppState>
  switchWorkspace(workspaceId: string): Promise<PersistedAppState>
  closeWorkspace(workspaceId: string): Promise<PersistedAppState>
  listWorkspaceFiles(workspaceId: string, relativePath?: string): Promise<WorkspaceFileEntry[]>
  readWorkspaceFile(workspaceId: string, relativePath: string): Promise<WorkspaceFileReadResult>
  saveWorkspaceFile(workspaceId: string, relativePath: string, content: string): Promise<WorkspaceFileReadResult>
  createWorkspaceFile(workspaceId: string, relativePath: string, type: 'file' | 'directory'): Promise<WorkspaceFileMutationResult>
  renameWorkspacePath(workspaceId: string, relativePath: string, nextRelativePath: string): Promise<WorkspaceFileMutationResult>
  deleteWorkspacePath(workspaceId: string, relativePath: string): Promise<void>
  duplicateWorkspacePath(workspaceId: string, relativePath: string): Promise<WorkspaceFileMutationResult>
  copyWorkspacePath(workspaceId: string, relativePath: string): Promise<void>
  revealWorkspacePath(workspaceId: string, relativePath: string): Promise<void>
  searchWorkspaceText(workspaceId: string, query: string): Promise<WorkspaceTextSearchResult[]>
  replaceWorkspaceText(workspaceId: string, query: string, replacement: string): Promise<WorkspaceTextSearchResult[]>
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
