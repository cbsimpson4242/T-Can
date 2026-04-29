import type { HermesAgentRole, HermesAgentStatus, TerminalNode } from '../../shared/types'

export interface HermesProjectTerminalGroup {
  project: string
  nodes: TerminalNode[]
}

export interface HermesSidebarTerminalSummary {
  id: string
  title: string
  project: string
  role: string
  status: string
  cwd?: string
}

export interface HermesTerminalSummary {
  projectLabel: string
  role: string
  status: string
  objective?: string
  lastAction?: string
  branch?: string
  worktree?: string
  cwd?: string
}

const ROLE_LABELS: Record<HermesAgentRole, string> = {
  planner: 'Planner',
  builder: 'Builder',
  tester: 'Tester',
  reviewer: 'Reviewer',
  researcher: 'Researcher',
  runner: 'Runner',
  summarizer: 'Summarizer',
}

const STATUS_LABELS: Record<HermesAgentStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting: 'Waiting',
  blocked: 'Blocked',
  done: 'Done',
}

export function isHermesTerminal(node: TerminalNode): boolean {
  return Boolean(node.hermes)
}

export function getHermesProjectLabel(node: TerminalNode, workspacePath?: string): string {
  const explicitProject = node.hermes?.project?.trim()

  if (explicitProject) {
    return explicitProject
  }

  const cwdLabel = getPathBasename(node.cwd)
  if (cwdLabel) {
    return cwdLabel
  }

  return getPathBasename(workspacePath) ?? 'Workspace'
}

export function groupHermesTerminalsByProject(nodes: TerminalNode[], workspacePath?: string): HermesProjectTerminalGroup[] {
  const projects = new Map<string, TerminalNode[]>()

  for (const node of nodes) {
    if (!isHermesTerminal(node)) {
      continue
    }

    const project = getHermesProjectLabel(node, workspacePath)
    const projectNodes = projects.get(project)

    if (projectNodes) {
      projectNodes.push(node)
      continue
    }

    projects.set(project, [node])
  }

  return Array.from(projects, ([project, projectNodes]) => ({ project, nodes: projectNodes }))
}

export function getHermesRoleLabel(role: HermesAgentRole): string {
  return ROLE_LABELS[role]
}

export function getHermesStatusLabel(status: HermesAgentStatus): string {
  return STATUS_LABELS[status]
}

export function createHermesTerminalSummary(node: TerminalNode, workspacePath?: string): HermesTerminalSummary | null {
  if (!node.hermes) {
    return null
  }

  return {
    projectLabel: getHermesProjectLabel(node, workspacePath),
    role: getHermesRoleLabel(node.hermes.role),
    status: getHermesStatusLabel(node.hermes.status),
    objective: node.hermes.objective,
    lastAction: node.hermes.lastAction,
    branch: node.hermes.branch,
    worktree: node.hermes.worktreePath,
    cwd: node.cwd,
  }
}

export function createHermesSidebarTerminalSummary(node: TerminalNode, workspacePath?: string): HermesSidebarTerminalSummary | null {
  if (!node.hermes) {
    return null
  }

  return {
    id: node.id,
    title: node.title,
    project: getHermesProjectLabel(node, workspacePath),
    role: node.hermes.role,
    status: node.hermes.status,
    cwd: node.cwd,
  }
}

function getPathBasename(path?: string): string | undefined {
  if (!path) {
    return undefined
  }

  const normalizedPath = path.replace(/[\\/]+$/, '')
  if (!normalizedPath) {
    return undefined
  }

  const segments = normalizedPath.split(/[/\\]/).filter(Boolean)
  return segments.at(-1)
}
