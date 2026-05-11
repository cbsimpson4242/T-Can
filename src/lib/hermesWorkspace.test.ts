import { describe, expect, it } from 'vitest'
import type { TerminalNode } from '../../shared/types'
import {
  createHermesSidebarTerminalSummary,
  createHermesTerminalSummary,
  getHermesProjectLabel,
  getHermesRoleLabel,
  getHermesStatusLabel,
  groupHermesTerminalsByProject,
  isHermesTerminal,
} from './hermesWorkspace'

describe('Hermes workspace helpers', () => {
  it('detects terminal nodes with Hermes metadata', () => {
    const hermesNode: TerminalNode = {
      id: 'node-1',
      type: 'terminal',
      title: 'Planner',
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      hermes: {
        project: 'alpha',
        role: 'planner',
        status: 'running',
      },
    }

    const plainNode: TerminalNode = {
      id: 'node-2',
      type: 'terminal',
      title: 'Shell',
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    }

    expect(isHermesTerminal(hermesNode)).toBe(true)
    expect(isHermesTerminal(plainNode)).toBe(false)
  })

  it('prefers explicit Hermes project metadata for project labels', () => {
    const node: TerminalNode = {
      id: 'node-1',
      type: 'terminal',
      title: 'Builder',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      cwd: '/home/chris/other-dir',
      hermes: {
        project: 'project-from-metadata',
        role: 'builder',
        status: 'idle',
      },
    }

    expect(getHermesProjectLabel(node, '/home/chris')).toBe('project-from-metadata')
  })

  it('derives a project label from the terminal cwd when Hermes metadata is absent', () => {
    const node: TerminalNode = {
      id: 'node-1',
      type: 'terminal',
      title: 'Tester',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      cwd: '/home/chris/Dev-Office-One',
    }

    expect(getHermesProjectLabel(node, '/home/chris')).toBe('Dev-Office-One')
  })

  it('falls back to the workspace name when no project metadata or cwd is present', () => {
    const node: TerminalNode = {
      id: 'node-1',
      type: 'terminal',
      title: 'Reviewer',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      hermes: {
        project: '',
        role: 'reviewer',
        status: 'waiting',
      },
    }

    expect(getHermesProjectLabel(node, '/home/chris/t-can')).toBe('t-can')
  })

  it('maps Hermes roles and statuses to presentation labels', () => {
    expect(getHermesRoleLabel('builder')).toBe('Builder')
    expect(getHermesStatusLabel('running')).toBe('Running')
  })

  it('creates a terminal summary for Hermes panes', () => {
    const node: TerminalNode = {
      id: 'node-1',
      type: 'terminal',
      title: 'Builder',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      cwd: '/home/chris/alpha',
      hermes: {
        project: 'alpha',
        role: 'builder',
        status: 'running',
        objective: 'Ship sidebar',
        branch: 'feat/sidebar',
        worktreePath: '/tmp/alpha-worktree',
      },
    }

    expect(createHermesTerminalSummary(node, '/home/chris')).toEqual({
      projectLabel: 'alpha',
      role: 'Builder',
      status: 'Running',
      objective: 'Ship sidebar',
      lastAction: undefined,
      branch: 'feat/sidebar',
      worktree: '/tmp/alpha-worktree',
      cwd: '/home/chris/alpha',
    })
  })

  it('creates a sidebar summary for Hermes panes', () => {
    const node: TerminalNode = {
      id: 'node-1',
      type: 'terminal',
      title: 'Reviewer',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      cwd: '/home/chris/alpha',
      hermes: {
        project: 'alpha',
        role: 'reviewer',
        status: 'waiting',
      },
    }

    expect(createHermesSidebarTerminalSummary(node, '/home/chris')).toEqual({
      id: 'node-1',
      title: 'Reviewer',
      project: 'alpha',
      role: 'reviewer',
      status: 'waiting',
      cwd: '/home/chris/alpha',
    })
  })

  it('returns null summaries for non-Hermes terminals', () => {
    const node: TerminalNode = {
      id: 'node-1',
      type: 'terminal',
      title: 'Shell',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    }

    expect(createHermesTerminalSummary(node, '/home/chris')).toBeNull()
    expect(createHermesSidebarTerminalSummary(node, '/home/chris')).toBeNull()
  })

  it('groups Hermes terminals by project label and excludes non-Hermes terminals', () => {
    const nodes: TerminalNode[] = [
      {
        id: 'node-1',
        type: 'terminal',
        title: 'Planner',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        cwd: '/home/chris/alpha',
        hermes: {
          project: 'alpha',
          role: 'planner',
          status: 'running',
        },
      },
      {
        id: 'node-2',
        type: 'terminal',
        title: 'Builder',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        cwd: '/home/chris/alpha',
        hermes: {
          project: 'alpha',
          role: 'builder',
          status: 'idle',
        },
      },
      {
        id: 'node-3',
        type: 'terminal',
        title: 'Tester',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        cwd: '/home/chris/beta',
        hermes: {
          project: 'beta',
          role: 'tester',
          status: 'blocked',
        },
      },
      {
        id: 'node-4',
        type: 'terminal',
        title: 'Shell',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        cwd: '/home/chris/plain-shell',
      },
    ]

    expect(groupHermesTerminalsByProject(nodes, '/home/chris')).toEqual([
      { project: 'alpha', nodes: [nodes[0], nodes[1]] },
      { project: 'beta', nodes: [nodes[2]] },
    ])
  })
})
