export type CanvasNodeType = 'terminal' | 'editor'

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
}

export interface EditorNode extends CanvasNodeBase {
  type: 'editor'
  filePath: string
  language?: string
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
  pid?: number
}

export interface TerminalSessionSnapshot {
  info: TerminalSessionInfo
  output: string
}

export interface CreateTerminalRequest {
  cwd?: string | null
  cols?: number
  rows?: number
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
