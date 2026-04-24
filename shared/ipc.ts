import { z } from 'zod'

export const terminalNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  sessionId: z.string().optional(),
  shell: z.string().optional(),
})

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number(),
})

export const persistedLayoutSchema = z.object({
  nodes: z.array(terminalNodeSchema),
  viewport: viewportSchema,
})

export const persistedWorkspaceSchema = z.object({
  id: z.string(),
  path: z.string(),
  layout: persistedLayoutSchema,
})

export const persistedAppStateSchema = z.object({
  activeWorkspaceId: z.string().nullable(),
  workspaces: z.array(persistedWorkspaceSchema),
  workspacePath: z.string().nullable().optional(),
  layout: persistedLayoutSchema.optional(),
})

export const legacyPersistedAppStateSchema = z.object({
  workspacePath: z.string().nullable(),
  layout: persistedLayoutSchema,
})

export const switchWorkspaceSchema = z.object({
  workspaceId: z.string(),
})

export const createTerminalRequestSchema = z.object({
  cwd: z.string().nullable().optional(),
  cols: z.number().int().min(20).max(400).optional(),
  rows: z.number().int().min(5).max(200).optional(),
})

export const terminalSessionSchema = z.object({
  sessionId: z.string(),
})

export const terminalResizeSchema = z.object({
  sessionId: z.string(),
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
})

export const terminalWriteSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
})

export const terminalCloseSchema = z.object({
  sessionId: z.string(),
})

export const terminalContextMenuSchema = z.object({
  sessionId: z.string(),
})

export const terminalClipboardRequestSchema = z.object({
  sessionId: z.string(),
  mode: z.enum(['clipboard', 'selection']).optional(),
})

export const IPC_CHANNELS = {
  getAppState: 'app:get-state',
  saveLayout: 'app:save-layout',
  openWorkspace: 'workspace:open-folder',
  switchWorkspace: 'workspace:switch',
  createTerminal: 'terminal:create',
  getTerminalSession: 'terminal:get-session',
  listTerminals: 'terminal:list',
  writeTerminal: 'terminal:write',
  resizeTerminal: 'terminal:resize',
  closeTerminal: 'terminal:close',
  closeAllTerminals: 'terminal:close-all',
  readClipboardForTerminal: 'terminal:read-clipboard',
  showTerminalContextMenu: 'terminal:show-context-menu',
  terminalOutput: 'terminal:output',
  terminalExit: 'terminal:exit',
  terminalPaste: 'terminal:paste',
} as const
