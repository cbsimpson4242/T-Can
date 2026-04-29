import { useMemo } from 'react'

export interface HermesSidebarTerminal {
  id: string
  title: string
  project: string
  role: string
  status: string
  cwd?: string
}

export interface HermesSidebarProps {
  workspaceName: string | null
  terminals: HermesSidebarTerminal[]
  selectedTerminalId?: string | null
  onSelectTerminal?: (id: string) => void
  mode?: 'mission' | 'files'
}

function getWorkspaceLabel(workspaceName: string | null): string {
  if (!workspaceName) {
    return 'No Workspace'
  }

  const parts = workspaceName.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? workspaceName
}

export function HermesSidebar({
  workspaceName,
  terminals,
  selectedTerminalId = null,
  onSelectTerminal,
  mode = 'mission',
}: HermesSidebarProps) {
  const projectGroups = useMemo(() => {
    const groups = new Map<string, HermesSidebarTerminal[]>()

    for (const terminal of terminals) {
      const projectLabel = terminal.project.trim() || 'Unassigned'
      const projectTerminals = groups.get(projectLabel) ?? []
      projectTerminals.push(terminal)
      groups.set(projectLabel, projectTerminals)
    }

    return Array.from(groups.entries()).map(([project, rows]) => ({ project, rows }))
  }, [terminals])

  return (
    <aside className="hermes-sidebar" aria-label="Hermes mission control sidebar" data-mode={mode}>
      <header className="hermes-sidebar__header">
        <p className="hermes-sidebar__eyebrow">Mission Control</p>
        <h2 className="hermes-sidebar__workspace">{getWorkspaceLabel(workspaceName)}</h2>
      </header>

      <div className="hermes-sidebar__body">
        {projectGroups.length === 0 ? (
          <div className="hermes-sidebar__empty-state">
            <p className="hermes-sidebar__empty-title">No Hermes terminals yet.</p>
            <p className="hermes-sidebar__empty-copy">Spawn an agent or connect a session to populate mission control.</p>
          </div>
        ) : (
          projectGroups.map(({ project, rows }) => (
            <section className="hermes-sidebar__group" key={project}>
              <h3 className="hermes-sidebar__group-title">{project}</h3>
              <div className="hermes-sidebar__list">
                {rows.map((terminal) => {
                  const isSelected = terminal.id === selectedTerminalId

                  return (
                    <button
                      key={terminal.id}
                      className={`hermes-sidebar__terminal ${isSelected ? 'hermes-sidebar__terminal--selected' : ''}`.trim()}
                      onClick={() => onSelectTerminal?.(terminal.id)}
                      type="button"
                    >
                      <span className="hermes-sidebar__terminal-main">
                        <span className="hermes-sidebar__terminal-title">{terminal.title}</span>
                        <span className="hermes-sidebar__terminal-role">{terminal.role}</span>
                      </span>
                      <span className="hermes-sidebar__terminal-status">{terminal.status}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
