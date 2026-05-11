import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TCanApi } from '../../shared/api'
import { TerminalNode } from './TerminalNode'

const { fitMock } = vi.hoisted(() => ({
  fitMock: vi.fn(),
}))

vi.mock('xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: { fontSize?: number } = {}

    loadAddon() {}

    open(host: HTMLElement) {
      const helperTextarea = document.createElement('textarea')
      helperTextarea.className = 'xterm-helper-textarea'
      host.appendChild(helperTextarea)
    }

    focus() {}
    paste() {}
    write() {}
    dispose() {}
    hasSelection() { return false }
    getSelection() { return '' }
    attachCustomKeyEventHandler() { return undefined }
    onData() { return { dispose() {} } }
  },
}))

vi.mock('xterm-addon-fit', () => ({
  FitAddon: class {
    fit = fitMock
  },
}))

vi.mock('xterm/css/xterm.css', () => ({}))

function createApi(): TCanApi {
  return {
    getAppState: vi.fn(),
    openWorkspace: vi.fn(),
    openSshWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    closeWorkspace: vi.fn(),
    listWorkspaceFiles: vi.fn(),
    readWorkspaceFile: vi.fn(),
    saveWorkspaceFile: vi.fn(),
    createWorkspaceFile: vi.fn(),
    renameWorkspacePath: vi.fn(),
    deleteWorkspacePath: vi.fn(),
    duplicateWorkspacePath: vi.fn(),
    copyWorkspacePath: vi.fn(),
    revealWorkspacePath: vi.fn(),
    listWorkspaceTasks: vi.fn(),
    saveLayout: vi.fn(),
    createTerminal: vi.fn(),
    getTerminalSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    closeAllTerminals: vi.fn(),
    getGitStatus: vi.fn(),
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
    getGitFileDiff: vi.fn(),
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

function renderTerminalNode(overrides: Partial<Parameters<typeof TerminalNode>[0]> = {}) {
  return render(
    <TerminalNode
      canvasRect={{ left: 0, top: 0, width: 640, height: 360 }}
      node={{ id: 'term-1', title: 'Hermes Terminal', type: 'terminal', x: 0, y: 0, width: 640, height: 360 }}
      onClose={vi.fn()}
      onMoveStart={vi.fn()}
      onResizeStart={vi.fn()}
      onSelect={vi.fn()}
      scale={1}
      selected={false}
      sessionId="session-1"
      workspacePath="/repo/project"
      {...overrides}
    />,
  )
}

describe('TerminalNode Hermes summary strip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as Window & { tcan?: TCanApi }).tcan = createApi()
  })

  afterEach(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'tcan')
  })

  it('renders a Hermes summary strip when Hermes metadata is present', async () => {
    renderTerminalNode({
      hermesSummary: {
        projectLabel: 'payments-service',
        role: 'Implementer',
        status: 'Running',
        objective: 'Add terminal summary strip',
        branch: 'feat/hermes-terminal',
        worktree: '/tmp/tcan-hermes/terminal',
        cwd: '/tmp/tcan-hermes/terminal/src',
      },
    })

    expect(screen.getByText('payments-service')).toBeInTheDocument()
    expect(screen.getByText('Implementer')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Add terminal summary strip')).toBeInTheDocument()
    expect(screen.getByText(/feat\/hermes-terminal/)).toBeInTheDocument()
    expect(screen.getByText(/\/tmp\/tcan-hermes\/terminal/)).toBeInTheDocument()
  })

  it('does not render a Hermes summary strip when Hermes metadata is absent', () => {
    renderTerminalNode()

    expect(screen.queryByText('Implementer')).not.toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(screen.queryByText('Add terminal summary strip')).not.toBeInTheDocument()
  })
})
