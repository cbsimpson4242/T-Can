export type CanvasNodeType = 'terminal' | 'editor'
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

export type CanvasNode = TerminalNode | EditorNode

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

export interface WorkspaceTextSearchMatch {
  line: number
  column: number
  preview: string
}

export interface WorkspaceTextSearchResult {
  relativePath: string
  matches: WorkspaceTextSearchMatch[]
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
