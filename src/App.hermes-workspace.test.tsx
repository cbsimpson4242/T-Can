import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { TCanApi } from '../shared/api'
import type { PersistedAppState, PersistedWorkspace } from '../shared/types'

vi.mock('./components/FileExplorer', () => ({
  FileExplorer: () => <div data-testid="file-explorer">File explorer</div>,
}))

vi.mock('./components/TerminalNode', () => ({
  TerminalNode: ({ node, hermesSummary }: { node: { title: string }; hermesSummary?: { projectLabel: string; role: string; status: string; objective?: string } }) => (
    <div data-testid={`terminal-node-${node.title}`}>
      <div>{node.title}</div>
      {hermesSummary && (
        <div>
          <span>{hermesSummary.projectLabel}</span>
          <span>{hermesSummary.role}</span>
          <span>{hermesSummary.status}</span>
          {hermesSummary.objective && <span>{hermesSummary.objective}</span>}
        </div>
      )}
    </div>
  ),
}))

vi.mock('./components/EditorNode', () => ({
  EditorNode: () => <div data-testid="editor-node" />,
}))

function createWorkspace(overrides: Partial<PersistedWorkspace> & Pick<PersistedWorkspace, 'id' | 'path'>): PersistedWorkspace {
  return {
    id: overrides.id,
    path: overrides.path,
    kind: overrides.kind,
    mode: overrides.mode,
    sshTarget: overrides.sshTarget,
    layout: overrides.layout ?? {
      nodes: [],
      viewport: { x: 0, y: 0, scale: 1 },
    },
  }
}

function createApi(state: PersistedAppState): TCanApi {
  return {
    getAppState: vi.fn().mockResolvedValue(state),
    openWorkspace: vi.fn(),
    openSshWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    closeWorkspace: vi.fn(),
    listWorkspaceFiles: vi.fn().mockResolvedValue([]),
    readWorkspaceFile: vi.fn(),
    saveWorkspaceFile: vi.fn(),
    createWorkspaceFile: vi.fn(),
    renameWorkspacePath: vi.fn(),
    deleteWorkspacePath: vi.fn(),
    duplicateWorkspacePath: vi.fn(),
    copyWorkspacePath: vi.fn(),
    revealWorkspacePath: vi.fn(),
    listWorkspaceTasks: vi.fn().mockResolvedValue([]),
    saveLayout: vi.fn().mockResolvedValue(state),
    createTerminal: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      cwd: '/workspaces/dev-office-one',
      shell: '/bin/bash',
    }),
    getTerminalSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn().mockResolvedValue(undefined),
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
}

describe('Hermes workspace mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.alert = vi.fn()
  })

  afterEach(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'tcan')
  })

  it('shows mission control, Hermes summaries, and Fork Agent actions when Hermes mode is enabled', async () => {
    const workspace = createWorkspace({
      id: 'atlas',
      path: '/workspaces/dev-office-one',
      mode: 'hermes',
      layout: {
        viewport: { x: 0, y: 0, scale: 1 },
        nodes: [
          {
            id: 'term-1',
            type: 'terminal',
            title: 'Builder',
            x: 10,
            y: 10,
            width: 600,
            height: 400,
            cwd: '/workspaces/dev-office-one',
            hermes: {
              project: 'dev-office-one',
              role: 'builder',
              status: 'running',
              objective: 'Ship mission control',
            },
          },
        ],
      },
    })
    const state: PersistedAppState = { activeWorkspaceId: workspace.id, workspaces: [workspace] }
    const api = createApi(state)
    ;(window as Window & { tcan?: TCanApi }).tcan = api

    render(<App />)

    expect(await screen.findByText('Mission Control')).toBeInTheDocument()
    expect(screen.queryByTestId('file-explorer')).not.toBeInTheDocument()
    const sidebar = screen.getByLabelText('Hermes mission control sidebar')
    expect(within(sidebar).getByRole('heading', { level: 2, name: 'dev-office-one' })).toBeInTheDocument()
    expect(await within(sidebar).findByText('Builder')).toBeInTheDocument()
    expect(within(sidebar).getByText('running')).toBeInTheDocument()
    expect(screen.getByText('Ship mission control')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'TERMS' }))
    expect(await screen.findByRole('button', { name: 'Fork Agent' })).toBeInTheDocument()
  })

  it('keeps the file explorer in standard mode and hides Hermes-specific chrome', async () => {
    const workspace = createWorkspace({
      id: 'atlas',
      path: '/workspaces/dev-office-one',
      layout: {
        viewport: { x: 0, y: 0, scale: 1 },
        nodes: [
          {
            id: 'term-1',
            type: 'terminal',
            title: 'Builder',
            x: 10,
            y: 10,
            width: 600,
            height: 400,
            cwd: '/workspaces/dev-office-one',
            hermes: {
              project: 'dev-office-one',
              role: 'builder',
              status: 'running',
              objective: 'Ship mission control',
            },
          },
        ],
      },
    })
    const state: PersistedAppState = { activeWorkspaceId: workspace.id, workspaces: [workspace] }
    const api = createApi(state)
    ;(window as Window & { tcan?: TCanApi }).tcan = api

    render(<App />)

    expect(await screen.findByTestId('file-explorer')).toBeInTheDocument()
    expect(screen.queryByText('Mission Control')).not.toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
  })

  it('toggles AGENT OS and persists the workspace mode', async () => {
    const workspace = createWorkspace({ id: 'atlas', path: '/workspaces/dev-office-one' })
    const hermesState: PersistedAppState = {
      activeWorkspaceId: workspace.id,
      workspaces: [{ ...workspace, mode: 'hermes' }],
    }
    const api = createApi({ activeWorkspaceId: workspace.id, workspaces: [workspace] })
    vi.mocked(api.saveLayout).mockResolvedValue(hermesState)
    ;(window as Window & { tcan?: TCanApi }).tcan = api

    render(<App />)

    const toggle = await screen.findByRole('button', { name: 'AGENT OS OFF' })
    vi.mocked(api.saveLayout).mockClear()

    await userEvent.click(toggle)

    await waitFor(() => expect(api.saveLayout).toHaveBeenCalledWith(
      'atlas',
      expect.objectContaining({ viewport: expect.any(Object), nodes: expect.any(Array) }),
      'hermes',
    ))
    expect(await screen.findByText('Mission Control')).toBeInTheDocument()
  })
})
