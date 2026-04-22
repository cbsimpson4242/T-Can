import fs from 'node:fs'
import path from 'node:path'
import { persistedAppStateSchema } from '../../shared/ipc'
import type { PersistedAppState } from '../../shared/types'

const DEFAULT_STATE: PersistedAppState = {
  workspacePath: null,
  layout: {
    nodes: [],
    viewport: { x: 0, y: 0, scale: 1 },
  },
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
      return persistedAppStateSchema.parse(parsed)
    } catch {
      return structuredClone(DEFAULT_STATE)
    }
  }

  save(state: PersistedAppState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8')
  }
}
