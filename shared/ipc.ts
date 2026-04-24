import { z } from 'zod'

const canvasNodeBaseSchema = z.object({
  id: z.string(),
  type: z.enum(['terminal', 'editor']).default('terminal'),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

export const terminalNodeSchema = canvasNodeBaseSchema.extend({
  type: z.literal('terminal').default('terminal'),
  sessionId: z.string().optional(),
  shell: z.string().optional(),
  sshTarget: z.string().optional(),
})

export const editorTabSchema = z.object({
  filePath: z.string(),
  title: z.string(),
  language: z.string().optional(),
  pinned: z.boolean().optional(),
})

export const editorNodeSchema = canvasNodeBaseSchema.extend({
  type: z.literal('editor'),
  filePath: z.string(),
  language: z.string().optional(),
  tabs: z.array(editorTabSchema).optional(),
  activeFilePath: z.string().optional(),
})

export const canvasNodeSchema = z.union([terminalNodeSchema, editorNodeSchema])

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number(),
})

export const persistedLayoutSchema = z.object({
  nodes: z.array(canvasNodeSchema),
  viewport: viewportSchema,
})

export const persistedWorkspaceSchema = z.object({
  id: z.string(),
  path: z.string(),
  kind: z.enum(['local', 'ssh']).optional(),
  sshTarget: z.string().optional(),
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

export const workspaceRequestSchema = z.object({
  workspaceId: z.string(),
})

export const sshWorkspaceRequestSchema = z.object({
  target: z.string().trim().min(1).max(255),
})

export const workspaceFileRequestSchema = z.object({
  workspaceId: z.string(),
  relativePath: z.string().optional().default(''),
})

export const workspaceFileSaveSchema = z.object({
  workspaceId: z.string(),
  relativePath: z.string(),
  content: z.string(),
})

export const workspaceFileCreateSchema = z.object({
  workspaceId: z.string(),
  relativePath: z.string().trim().min(1),
  type: z.enum(['file', 'directory']),
})

export const workspacePathRenameSchema = z.object({
  workspaceId: z.string(),
  relativePath: z.string().trim().min(1),
  nextRelativePath: z.string().trim().min(1),
})

export const workspaceTextSearchSchema = z.object({
  workspaceId: z.string(),
  query: z.string(),
})

export const workspaceTextReplaceSchema = workspaceTextSearchSchema.extend({
  replacement: z.string(),
})

export const workspaceSymbolRequestSchema = z.object({
  workspaceId: z.string(),
  query: z.string().optional().default(''),
})

export const createTerminalRequestSchema = z.object({
  cwd: z.string().nullable().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
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
  openSshWorkspace: 'workspace:open-ssh',
  switchWorkspace: 'workspace:switch',
  closeWorkspace: 'workspace:close',
  listWorkspaceFiles: 'workspace:list-files',
  readWorkspaceFile: 'workspace:read-file',
  saveWorkspaceFile: 'workspace:save-file',
  createWorkspaceFile: 'workspace:create-path',
  renameWorkspacePath: 'workspace:rename-path',
  deleteWorkspacePath: 'workspace:delete-path',
  duplicateWorkspacePath: 'workspace:duplicate-path',
  copyWorkspacePath: 'workspace:copy-path',
  revealWorkspacePath: 'workspace:reveal-path',
  searchWorkspaceText: 'workspace:search-text',
  replaceWorkspaceText: 'workspace:replace-text',
  listWorkspaceSymbols: 'workspace:list-symbols',
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
