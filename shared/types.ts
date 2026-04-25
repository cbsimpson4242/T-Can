export type CanvasNodeType = 'terminal' | 'editor' | 'source-control'
export type NodeResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export interface CanvasNodeBase {
  id: string
  type?: CanvasNodeType
  title: string
  x: number
  y: number
  width: number
  height: number
}

export interface TerminalNode extends CanvasNodeBase {
  type?: 'terminal'
  sessionId?: string
  shell?: string
  sshTarget?: string
  cwd?: string
  taskName?: string
}

export interface EditorTab {
  filePath: string
  title: string
  language?: string
  pinned?: boolean
}

export interface EditorNode extends CanvasNodeBase {
  type: 'editor'
  /** Legacy single-file path retained for older saved layouts. */
  filePath: string
  language?: string
  tabs?: EditorTab[]
  activeFilePath?: string
}

export interface SourceControlNode extends CanvasNodeBase {
  type: 'source-control'
}

export type CanvasNode = TerminalNode | EditorNode | SourceControlNode

export interface Viewport {
  x: number
  y: number
  scale: number
}

export interface PersistedLayout {
  nodes: CanvasNode[]
  viewport: Viewport
}

export interface PersistedWorkspace {
  id: string
  path: string
  kind?: 'local' | 'ssh'
  sshTarget?: string
  layout: PersistedLayout
}

export interface PersistedAppState {
  activeWorkspaceId: string | null
  workspaces: PersistedWorkspace[]
  /** @deprecated retained only for migrating older persisted state files. */
  workspacePath?: string | null
  /** @deprecated retained only for migrating older persisted state files. */
  layout?: PersistedLayout
}

export interface TerminalSessionInfo {
  sessionId: string
  cwd: string
  shell: string
  command?: string
  args?: string[]
  agentCommandLine?: string
  isAgentSession?: boolean
  lastAgentMessage?: string
  pid?: number
}

export interface TerminalSessionSnapshot {
  info: TerminalSessionInfo
  output: string
}

export interface CreateTerminalRequest {
  cwd?: string | null
  command?: string
  args?: string[]
  cols?: number
  rows?: number
}

export interface WorkspaceFileEntry {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  children?: WorkspaceFileEntry[]
}

export interface WorkspaceFileReadResult {
  relativePath: string
  content: string
  mtimeMs: number
}

export interface WorkspaceFileMutationResult {
  relativePath: string
  entry?: WorkspaceFileEntry
}

export type WorkspaceSymbolKind =
  | 'class'
  | 'function'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'struct'
  | 'trait'

export interface WorkspaceSymbol {
  name: string
  kind: WorkspaceSymbolKind
  relativePath: string
  line: number
  column: number
  language?: string
  containerName?: string
}

export type ClipboardTextMode = 'clipboard' | 'selection'

export interface TerminalClipboardRequest {
  sessionId: string
  mode?: ClipboardTextMode
}

export interface TerminalOutputEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
}

export interface TerminalPasteEvent {
  sessionId: string
  data: string
}

export interface WorkspaceChangedEvent {
  workspaceId: string
  path?: string
}

export interface WorkspaceTaskScript {
  name: string
  command: string
  packageManager: 'npm' | 'yarn' | 'pnpm'
  cwd: string
}

export interface ProblemMatch {
  id: string
  source: string
  message: string
  relativePath: string
  line: number
  column?: number
  severity: 'error' | 'warning' | 'info'
  sessionId?: string
}

export interface GitStatusEntry {
  path: string
  indexStatus: string
  workTreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

export interface GitBranchSummary {
  current: string | null
  branches: string[]
  upstream?: string | null
  ahead?: number
  behind?: number
  lastCommit?: GitCommitSummary | null
}

export interface GitDiffLine {
  type: 'context' | 'add' | 'delete' | 'hunk'
  content: string
  oldLine?: number
  newLine?: number
}

export interface GitFileDiff {
  path: string
  staged: boolean
  binary: boolean
  lines: GitDiffLine[]
  raw: string
}

export interface GitCommitSummary {
  hash: string
  author: string
  date: string
  subject: string
}

export interface GitBlameLine {
  line: number
  commit: string
  author: string
  summary: string
  content: string
}
