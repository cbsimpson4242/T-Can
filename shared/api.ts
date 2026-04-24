import type {
  ClipboardTextMode,
  CreateTerminalRequest,
  PersistedAppState,
  GitBlameLine,
  GitBranchSummary,
  GitCommitSummary,
  GitFileDiff,
  GitStatusEntry,
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
  WorkspaceTaskScript,
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
  listWorkspaceTasks(workspaceId: string): Promise<WorkspaceTaskScript[]>
  saveLayout(layout: PersistedLayout): Promise<PersistedAppState>
  createTerminal(request: CreateTerminalRequest): Promise<TerminalSessionInfo>
  getTerminalSession(sessionId: string): Promise<TerminalSessionSnapshot | null>
  listTerminals(): Promise<TerminalSessionInfo[]>
  writeTerminal(sessionId: string, data: string): Promise<void>
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>
  closeTerminal(sessionId: string): Promise<void>
  closeAllTerminals(): Promise<void>
  getGitStatus(workspaceId: string): Promise<GitStatusEntry[]>
  getGitBranches(workspaceId: string): Promise<GitBranchSummary>
  gitStage(workspaceId: string, filePath: string): Promise<void>
  gitUnstage(workspaceId: string, filePath: string): Promise<void>
  gitDiscard(workspaceId: string, filePath: string): Promise<void>
  gitCommit(workspaceId: string, message: string): Promise<void>
  gitPush(workspaceId: string): Promise<void>
  gitPull(workspaceId: string): Promise<void>
  gitFetch(workspaceId: string): Promise<void>
  gitCheckoutBranch(workspaceId: string, branch: string): Promise<void>
  gitCreateBranch(workspaceId: string, branch: string): Promise<void>
  gitDeleteBranch(workspaceId: string, branch: string): Promise<void>
  getGitFileDiff(workspaceId: string, filePath: string, staged?: boolean): Promise<GitFileDiff>
  getGitFileHistory(workspaceId: string, filePath: string): Promise<GitCommitSummary[]>
  getGitBlame(workspaceId: string, filePath: string): Promise<GitBlameLine[]>
  readClipboardText(mode?: ClipboardTextMode): Promise<string>
  readClipboardForTerminal(request: TerminalClipboardRequest): Promise<string>
  showTerminalContextMenu(sessionId: string): Promise<void>
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void
  onTerminalPaste(listener: (event: TerminalPasteEvent) => void): () => void
}
