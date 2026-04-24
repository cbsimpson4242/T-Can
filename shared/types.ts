export interface TerminalNode {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  sessionId?: string
  shell?: string
}

export interface Viewport {
  x: number
  y: number
  scale: number
}

export interface PersistedLayout {
  nodes: TerminalNode[]
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
