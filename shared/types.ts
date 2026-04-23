export interface TerminalNode {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
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

export interface PersistedAppState {
  workspacePath: string | null
  layout: PersistedLayout
}

export interface TerminalSessionInfo {
  sessionId: string
  cwd: string
  shell: string
}

export interface CreateTerminalRequest {
  cwd?: string | null
  cols?: number
  rows?: number
}

export type ClipboardTextMode = 'clipboard' | 'selection'

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
