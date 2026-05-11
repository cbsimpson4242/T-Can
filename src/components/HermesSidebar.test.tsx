import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { HermesSidebar, type HermesSidebarTerminal } from './HermesSidebar'

function createTerminal(overrides: Partial<HermesSidebarTerminal> & Pick<HermesSidebarTerminal, 'id' | 'title' | 'project' | 'role' | 'status'>): HermesSidebarTerminal {
  return {
    id: overrides.id,
    title: overrides.title,
    project: overrides.project,
    role: overrides.role,
    status: overrides.status,
    cwd: overrides.cwd,
  }
}

describe('HermesSidebar', () => {
  it('renders the workspace name header', () => {
    render(
      <HermesSidebar
        workspaceName="/workspaces/atlas"
        terminals={[createTerminal({ id: '1', title: 'Planner', project: 'Atlas', role: 'planner', status: 'running' })]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'atlas' })).toBeInTheDocument()
    expect(screen.getByText('Mission Control')).toBeInTheDocument()
  })

  it('groups terminals by project label', () => {
    render(
      <HermesSidebar
        workspaceName="Atlas"
        terminals={[
          createTerminal({ id: '1', title: 'Planner', project: 'Apollo', role: 'planner', status: 'running' }),
          createTerminal({ id: '2', title: 'Builder', project: 'Apollo', role: 'implementer', status: 'idle' }),
          createTerminal({ id: '3', title: 'Verifier', project: 'Zeus', role: 'reviewer', status: 'done' }),
        ]}
      />,
    )

    const apolloGroup = screen.getByRole('heading', { name: 'Apollo' }).closest('section')
    const zeusGroup = screen.getByRole('heading', { name: 'Zeus' }).closest('section')

    expect(apolloGroup).not.toBeNull()
    expect(zeusGroup).not.toBeNull()
    expect(within(apolloGroup as HTMLElement).getByRole('button', { name: /Planner/i })).toBeInTheDocument()
    expect(within(apolloGroup as HTMLElement).getByRole('button', { name: /Builder/i })).toBeInTheDocument()
    expect(within(zeusGroup as HTMLElement).getByRole('button', { name: /Verifier/i })).toBeInTheDocument()
  })

  it('shows each terminal row with title, role, and status', () => {
    render(
      <HermesSidebar
        workspaceName="Atlas"
        terminals={[createTerminal({ id: '1', title: 'Planner', project: 'Apollo', role: 'planner', status: 'running' })]}
      />,
    )

    const row = screen.getByRole('button', { name: /Planner/i })
    expect(within(row).getByText('Planner')).toBeInTheDocument()
    expect(within(row).getByText('planner')).toBeInTheDocument()
    expect(within(row).getByText('running')).toBeInTheDocument()
  })

  it('shows an empty state when no terminals exist', () => {
    render(<HermesSidebar workspaceName="Atlas" terminals={[]} />)

    expect(screen.getByText('No Hermes terminals yet.')).toBeInTheDocument()
    expect(screen.getByText('Spawn an agent or connect a session to populate mission control.')).toBeInTheDocument()
  })

  it('calls onSelectTerminal when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelectTerminal = vi.fn()

    render(
      <HermesSidebar
        workspaceName="Atlas"
        terminals={[createTerminal({ id: '1', title: 'Planner', project: 'Apollo', role: 'planner', status: 'running' })]}
        onSelectTerminal={onSelectTerminal}
        selectedTerminalId="2"
      />,
    )

    await user.click(screen.getByRole('button', { name: /Planner/i }))

    expect(onSelectTerminal).toHaveBeenCalledWith('1')
  })
})
