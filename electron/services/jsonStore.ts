import fs from 'node:fs'
import path from 'node:path'
import { legacyPersistedAppStateSchema, persistedAppStateSchema } from '../../shared/ipc'
import type { PersistedAppState, PersistedLayout } from '../../shared/types'

const DEFAULT_LAYOUT: PersistedLayout = {
  nodes: [],
  viewport: { x: 0, y: 0, scale: 1 },
}

const DEFAULT_STATE: PersistedAppState = {
  activeWorkspaceId: null,
  workspaces: [],
}

function createWorkspaceId(workspacePath: string): string {
  return workspacePath
}

function migratePersistedState(candidate: unknown): PersistedAppState {
  const modern = persistedAppStateSchema.safeParse(candidate)
  if (modern.success) {
    return {
      activeWorkspaceId: modern.data.activeWorkspaceId,
      workspaces: modern.data.workspaces,
    }
  }

  const legacy = legacyPersistedAppStateSchema.safeParse(candidate)
  if (legacy.success && legacy.data.workspacePath) {
    const workspace = {
      id: createWorkspaceId(legacy.data.workspacePath),
      path: legacy.data.workspacePath,
      layout: legacy.data.layout,
    }

    return {
      activeWorkspaceId: workspace.id,
      workspaces: [workspace],
    }
  }

  if (legacy.success) {
    return structuredClone(DEFAULT_STATE)
  }

  return structuredClone(DEFAULT_STATE)
}

export class JsonStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  load(): PersistedAppState {
    if (!fs.existsSync(this.filePath)) {
      return structuredClone(DEFAULT_STATE)
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return migratePersistedState(parsed)
    } catch {
      return structuredClone(DEFAULT_STATE)
    }
  }

  save(state: PersistedAppState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(
        {
          activeWorkspaceId: state.activeWorkspaceId,
          workspaces: state.workspaces,
        },
        null,
        2,
      ),
      'utf8',
    )
  }
}

export { DEFAULT_LAYOUT }
