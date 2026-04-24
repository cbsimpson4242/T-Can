import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonStore } from './jsonStore'

const tempPaths: string[] = []

afterEach(() => {
  for (const tempPath of tempPaths) {
    fs.rmSync(tempPath, { recursive: true, force: true })
  }
  tempPaths.length = 0
})

describe('JsonStore', () => {
  it('returns defaults when the file does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcan-store-'))
    tempPaths.push(dir)

    const store = new JsonStore(path.join(dir, 'app-state.json'))
    const state = store.load()

    expect(state.activeWorkspaceId).toBeNull()
    expect(state.workspaces).toEqual([])
  })

  it('persists and reloads multiple workspace layout state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcan-store-'))
    tempPaths.push(dir)

    const filePath = path.join(dir, 'app-state.json')
    const store = new JsonStore(filePath)

    store.save({
      activeWorkspaceId: '/tmp/workspace',
      workspaces: [
        {
          id: '/tmp/workspace',
          path: '/tmp/workspace',
          layout: {
            viewport: { x: 10, y: 20, scale: 1.2 },
            nodes: [
              {
                id: 'node-1',
                title: 'Terminal',
                x: 1,
                y: 2,
                width: 300,
                height: 200,
              },
            ],
          },
        },
      ],
    })

    const reloaded = new JsonStore(filePath).load()
    expect(reloaded).toEqual({
      activeWorkspaceId: '/tmp/workspace',
      workspaces: [
        {
          id: '/tmp/workspace',
          path: '/tmp/workspace',
          layout: {
            viewport: { x: 10, y: 20, scale: 1.2 },
            nodes: [
              {
                id: 'node-1',
                title: 'Terminal',
                x: 1,
                y: 2,
                width: 300,
                height: 200,
              },
            ],
          },
        },
      ],
    })
  })

  it('migrates legacy single-workspace state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcan-store-'))
    tempPaths.push(dir)

    const filePath = path.join(dir, 'app-state.json')
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        workspacePath: '/tmp/workspace',
        layout: {
          viewport: { x: 10, y: 20, scale: 1.2 },
          nodes: [],
        },
      }),
      'utf8',
    )

    const reloaded = new JsonStore(filePath).load()
    expect(reloaded).toEqual({
      activeWorkspaceId: '/tmp/workspace',
      workspaces: [
        {
          id: '/tmp/workspace',
          path: '/tmp/workspace',
          layout: {
            viewport: { x: 10, y: 20, scale: 1.2 },
            nodes: [],
          },
        },
      ],
    })
  })
})
