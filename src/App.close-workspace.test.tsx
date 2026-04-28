import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { TCanApi } from '../shared/api'
import type { PersistedAppState, PersistedWorkspace } from '../shared/types'

vi.mock('./components/FileExplorer', () => ({
  FileExplorer: () => <div data-testid="file-explorer" />,
}))

vi.mock('./components/TerminalNode', () => ({
  TerminalNode: () => <div data-testid="terminal-node" />,
}))

vi.mock('./components/EditorNode', async () => {
  const React = await import('react')

  return {
    EditorNode: ({ node, onDirtyChange }: { node: { id: string; title: string }; onDirtyChange(nodeId: string, dirtyPaths: string[]): void }) => {
      React.useEffect(() => {
        onDirtyChange(node.id, ['dirty.txt'])
      }, [node.id, onDirtyChange])

      return <div data-testid={`editor-node-${node.id}`}>{node.title}</div>
    },
  }
})

function createWorkspace(overrides: Partial<PersistedWorkspace> & Pick<PersistedWorkspace, 'id' | 'path'>): PersistedWorkspace {
  return {
    id: overrides.id,
    path: overrides.path,
    kind: overrides.kind,
    sshTarget: overrides.sshTarget,
    layout: overrides.layout ?? {
      nodes: [],
      viewport: { x: 0, y: 0, scale: 1 },
    },
  }
}

function createApi(state: PersistedAppState, closeWorkspaceResult?: PersistedAppState) {
  const api: TCanApi = {
    getAppState: vi.fn().mockResolvedValue(state),
    openWorkspace: vi.fn(),
    openSshWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    closeWorkspace: vi.fn().mockResolvedValue(closeWorkspaceResult ?? state),
    listWorkspaceFiles: vi.fn().mockResolvedValue([]),
    readWorkspaceFile: vi.fn().mockResolvedValue({ relativePath: 'dirty.txt', content: 'hello', mtimeMs: 1 }),
    saveWorkspaceFile: vi.fn(),
    createWorkspaceFile: vi.fn(),
    renameWorkspacePath: vi.fn(),
    deleteWorkspacePath: vi.fn(),
    duplicateWorkspacePath: vi.fn(),
    copyWorkspacePath: vi.fn(),
    revealWorkspacePath: vi.fn(),
    listWorkspaceTasks: vi.fn().mockResolvedValue([]),
    saveLayout: vi.fn().mockResolvedValue(state),
    createTerminal: vi.fn(),
    getTerminalSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    closeAllTerminals: vi.fn(),
    getGitStatus: vi.fn().mockResolvedValue([]),
    getGitBranches: vi.fn(),
    gitStage: vi.fn(),
    gitUnstage: vi.fn(),
    gitDiscard: vi.fn(),
    gitDiscardAll: vi.fn(),
    gitCommit: vi.fn(),
    gitPush: vi.fn(),
    gitPull: vi.fn(),
    gitFetch: vi.fn(),
    gitCheckoutBranch: vi.fn(),
    gitCreateBranch: vi.fn(),
    gitDeleteBranch: vi.fn(),
    getGitFileDiff: vi.fn().mockResolvedValue({ lines: [] }),
    getGitFileHistory: vi.fn(),
    getGitBlame: vi.fn(),
    readClipboardText: vi.fn(),
    writeClipboardText: vi.fn(),
    readClipboardForTerminal: vi.fn(),
    showTerminalContextMenu: vi.fn(),
    onTerminalOutput: vi.fn().mockReturnValue(() => {}),
    onTerminalExit: vi.fn().mockReturnValue(() => {}),
    onTerminalPaste: vi.fn().mockReturnValue(() => {}),
    onWorkspaceChanged: vi.fn().mockReturnValue(() => {}),
  }

  return api
}

describe('workspace closing', () => {
  const originalConfirm = window.confirm
  const originalAlert = window.alert

  beforeEach(() => {
    vi.clearAllMocks()
    window.alert = vi.fn()
  })

  afterEach(() => {
    window.confirm = originalConfirm
    window.alert = originalAlert
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'tcan')
  })

  it('uses a single confirmation when the active workspace has unsaved files', async () => {
    const alpha = createWorkspace({
      id: 'alpha',
      path: '/tmp/alpha',
      layout: {
        viewport: { x: 0, y: 0, scale: 1 },
        nodes: [{ id: 'editor-1', type: 'editor', title: 'dirty.txt', x: 0, y: 0, width: 500, height: 300, filePath: 'dirty.txt' }],
      },
    })
    const beta = createWorkspace({ id: 'beta', path: '/tmp/beta' })
    const state: PersistedAppState = { activeWorkspaceId: alpha.id, workspaces: [alpha, beta] }
    const nextState: PersistedAppState = { activeWorkspaceId: beta.id, workspaces: [beta] }
    const api = createApi(state, nextState)
    ;(window as Window & { tcan?: TCanApi }).tcan = api
    window.confirm = vi.fn().mockReturnValue(true)

    render(<App />)

    const closeButton = await screen.findByRole('button', { name: 'Close alpha workspace' })
    await userEvent.click(closeButton)

    await waitFor(() => expect(api.closeWorkspace).toHaveBeenCalledWith(alpha.id))
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledWith('Close workspace "alpha" with 1 unsaved file? Unsaved edits will be discarded.')
  })

  it('persists the active workspace layout before closing it', async () => {
    const alpha = createWorkspace({ id: 'alpha', path: '/tmp/alpha' })
    const beta = createWorkspace({ id: 'beta', path: '/tmp/beta' })
    const state: PersistedAppState = { activeWorkspaceId: alpha.id, workspaces: [alpha, beta] }
    const nextState: PersistedAppState = { activeWorkspaceId: beta.id, workspaces: [beta] }
    const api = createApi(state, nextState)
    ;(window as Window & { tcan?: TCanApi }).tcan = api
    window.confirm = vi.fn().mockReturnValue(true)

    render(<App />)

    await screen.findByRole('button', { name: 'Close alpha workspace' })
    await waitFor(() => expect(api.saveLayout).toHaveBeenCalled())
    vi.mocked(api.saveLayout).mockClear()
    vi.mocked(api.closeWorkspace).mockClear()

    const closeButton = screen.getByRole('button', { name: 'Close alpha workspace' })
    await userEvent.click(closeButton)

    await waitFor(() => expect(api.closeWorkspace).toHaveBeenCalledWith(alpha.id))
    const saveOrders = vi.mocked(api.saveLayout).mock.invocationCallOrder
    expect(saveOrders.length).toBeGreaterThan(0)
    const closeOrder = vi.mocked(api.closeWorkspace).mock.invocationCallOrder[0]
    expect(saveOrders[0]).toBeLessThan(closeOrder)
  })
})
