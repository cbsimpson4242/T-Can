import type { TerminalNode } from '../../shared/types'

export interface HermesProjectTerminalGroup {
  project: string
  nodes: TerminalNode[]
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
