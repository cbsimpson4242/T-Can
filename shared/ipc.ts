import { z } from 'zod'

export const terminalNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
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

export const persistedAppStateSchema = z.object({
  workspacePath: z.string().nullable(),
  layout: persistedLayoutSchema,
})

export const createTerminalRequestSchema = z.object({
  cwd: z.string().nullable().optional(),
  cols: z.number().int().min(20).max(400).optional(),
  rows: z.number().int().min(5).max(200).optional(),
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

export const IPC_CHANNELS = {
  getAppState: 'app:get-state',
  saveLayout: 'app:save-layout',
  openWorkspace: 'workspace:open-folder',
  createTerminal: 'terminal:create',
  writeTerminal: 'terminal:write',
  resizeTerminal: 'terminal:resize',
  closeTerminal: 'terminal:close',
  terminalOutput: 'terminal:output',
  terminalExit: 'terminal:exit',
} as const
