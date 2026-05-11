# Hermes Agent Workspace MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a Hermes-specific workspace mode to T-CAN that turns generic terminal panes into project-aware agent panes with visible role/status metadata, a project-centric sidebar, and a first-class fork/duplicate workflow.

**Architecture:** Keep T-CAN’s current infinite-canvas terminal model, but add a Hermes workspace layer on top of existing `PersistedWorkspace`, terminal-node, and task-management primitives. The first slice should be metadata-first: teach the app to understand “project, agent role, status, objective, branch/worktree, and last action” without replacing the current PTY-backed terminal core. Build the feature so the new Hermes affordances can coexist with the current generic workspace mode and later grow into richer agent cards, artifacts, and dependency views.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, existing PTY daemon/runtime, current `shared/types.ts` and `shared/api.ts` contracts.

---

## Current grounded repo facts

Observed in the current repo:
- Main UI orchestration lives in `src/App.tsx` and is currently a large monolithic controller.
- Terminal rendering lives in `src/components/TerminalNode.tsx`.
- Shared app state contracts live in `shared/types.ts` and preload API types in `shared/api.ts`.
- T-CAN already supports:
  - multiple workspaces in the top bar
  - per-workspace layout persistence
  - terminal duplication / split behavior
  - terminal manager modal (`TERMS`)
  - AI agent session detection in `TerminalNode`
  - task discovery from `package.json` scripts
  - Git summary data via the source-control node and git IPC APIs
- Existing app tests already mock `window.tcan` and `TerminalNode` / `EditorNode`, as seen in `src/App.close-workspace.test.tsx`.

These existing seams make a metadata-first Hermes mode realistic without rebuilding the PTY model.

---

## Product scope for MVP

### In scope
- Hermes workspace mode toggle/state
- Project-aware terminal metadata
- Agent role + status labeling
- Project/agent summary sidebar
- Agent pane header summary strip
- Explicit duplicate/fork affordance for agent terminals
- Persistence of Hermes metadata in saved layouts

### Out of scope for MVP
- Autonomous orchestration engine
- Cross-agent dependency graph visualization
- Artifact viewer tabs
- Merge/promote workflows
- Background multi-agent supervisor
- LLM-generated summaries from terminal logs

---

## Proposed UX for MVP

### Hermes workspace behavior
When Hermes mode is enabled for a workspace:
- the left sidebar becomes a **Mission Control** panel instead of only a file tree
- terminal panes show agent metadata above the raw terminal area
- terminals can be tagged with a role such as `planner`, `builder`, `tester`, `reviewer`, `researcher`, or `runner`
- the app groups visible panes by their project/repo context in the sidebar
- duplicate actions become semantically presented as **Fork Agent**

### Minimum user-visible benefits
A user should be able to answer, at a glance:
1. which project each terminal belongs to
2. what role that terminal/agent has
3. whether it is running, idle, blocked, done, or waiting
4. what its latest useful action was
5. which branch/worktree or cwd it is using

---

## Data model proposal

Add Hermes metadata to terminal/layout persistence rather than creating a whole new session system first.

### Task 1: Add Hermes metadata types

**Objective:** Introduce the smallest shared schema that lets T-CAN persist project-aware agent metadata for terminal nodes.

**Files:**
- Modify: `shared/types.ts`
- Test: `src/App.hermes-workspace.test.tsx`

**Step 1: Add the failing test plan for initial metadata visibility**
Create a new UI test file that renders a workspace containing at least one terminal node with Hermes metadata and expects that metadata to appear in the UI once Hermes mode is enabled.

Expected test concerns:
- a role label like `BUILDER`
- a status label like `RUNNING`
- a project label like `dev-office-one`
- a visible “Fork Agent” action for a Hermes terminal

**Step 2: Run the targeted test to verify failure**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: FAIL — Hermes metadata is not represented in UI yet.

**Step 3: Add minimal shared types**
Add types similar to:
```ts
export type HermesWorkspaceMode = 'standard' | 'hermes'
export type HermesAgentRole = 'planner' | 'builder' | 'tester' | 'reviewer' | 'researcher' | 'runner' | 'summarizer'
export type HermesAgentStatus = 'idle' | 'running' | 'waiting' | 'blocked' | 'done'

export interface HermesAgentSummary {
  project: string
  role: HermesAgentRole
  status: HermesAgentStatus
  objective?: string
  lastAction?: string
  nextStep?: string
  branch?: string
  worktreePath?: string
}
```
Then attach optional Hermes metadata to `TerminalNode` and workspace-level mode state to `PersistedWorkspace`.

**Step 4: Run the targeted test again**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: still FAIL, but now for missing UI behavior rather than missing types.

**Step 5: Commit**
```bash
git add shared/types.ts src/App.hermes-workspace.test.tsx
git commit -m "feat: add Hermes workspace metadata types"
```

---

### Task 2: Add small pure helpers for Hermes mode

**Objective:** Avoid growing `src/App.tsx` further by moving Hermes-specific grouping and labeling logic into focused helpers.

**Files:**
- Create: `src/lib/hermesWorkspace.ts`
- Test: `src/lib/hermesWorkspace.test.ts`
- Modify: `src/App.tsx`

**Step 1: Write failing helper tests**
Add tests for pure functions such as:
- `getHermesProjectLabel(node, workspacePath)`
- `getHermesTerminalStatus(snapshotLikeData)`
- `groupHermesTerminalsByProject(nodes)`
- `isHermesTerminal(node)`

Example expectations:
- terminal with `cwd=/home/chris/Dev-Office-One` groups under `Dev-Office-One`
- metadata role/status are passed through safely
- fallback project name uses workspace name if no explicit project exists

**Step 2: Run tests to verify failure**
Run:
```bash
npm test -- src/lib/hermesWorkspace.test.ts
```
Expected: FAIL — helper module does not exist.

**Step 3: Add minimal helper implementation**
Create `src/lib/hermesWorkspace.ts` with small pure functions only. Do not put React hooks or IPC calls in this file.

**Step 4: Run tests to verify pass**
Run:
```bash
npm test -- src/lib/hermesWorkspace.test.ts
```
Expected: PASS

**Step 5: Commit**
```bash
git add src/lib/hermesWorkspace.ts src/lib/hermesWorkspace.test.ts src/App.tsx
git commit -m "feat: add Hermes workspace helper layer"
```

---

### Task 3: Add a workspace-mode toggle in app state

**Objective:** Let a workspace opt into Hermes UI without breaking the current T-CAN default mode.

**Files:**
- Modify: `shared/types.ts`
- Modify: `src/App.tsx`
- Test: `src/App.hermes-workspace.test.tsx`

**Step 1: Extend the failing UI test**
Add an expectation that Hermes-specific UI is hidden in standard mode and visible only when the workspace mode is `hermes`.

**Step 2: Run test to verify failure**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: FAIL — there is no mode-specific rendering yet.

**Step 3: Implement minimal mode toggle**
In `src/App.tsx`:
- derive `isHermesWorkspace = activeWorkspace?.mode === 'hermes'`
- add one button in the top bar or sidebar to toggle the active workspace mode
- persist the updated workspace mode using existing workspace/layout save flows

Use the simplest local-state/persisted-state strategy possible first; avoid introducing a global store.

**Step 4: Run test to verify pass**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: PASS for mode visibility.

**Step 5: Commit**
```bash
git add shared/types.ts src/App.tsx src/App.hermes-workspace.test.tsx
git commit -m "feat: add Hermes workspace mode toggle"
```

---

### Task 4: Add Mission Control sidebar content

**Objective:** Replace the current file-explorer-only left-rail experience with a Hermes-aware mission panel when Hermes mode is active.

**Files:**
- Create: `src/components/HermesSidebar.tsx`
- Test: `src/components/HermesSidebar.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Step 1: Write failing component tests**
Cover:
- rendering project groups
- displaying agent counts by project
- showing roles/statuses for listed terminals
- showing a fallback empty state when no Hermes agent terminals exist

**Step 2: Run tests to verify failure**
Run:
```bash
npm test -- src/components/HermesSidebar.test.tsx
```
Expected: FAIL — component does not exist.

**Step 3: Implement minimal sidebar**
The sidebar should render:
- active workspace name
- total Hermes terminals
- grouped project sections
- each terminal row with title, role, status, cwd/project summary

Do **not** remove the file explorer permanently. In Hermes mode, either:
- swap the explorer for the Hermes sidebar, or
- provide a small tab switch between `MISSION` and `FILES`

The safer MVP is a two-tab left rail.

**Step 4: Run tests to verify pass**
Run:
```bash
npm test -- src/components/HermesSidebar.test.tsx
```
Expected: PASS

**Step 5: Commit**
```bash
git add src/components/HermesSidebar.tsx src/components/HermesSidebar.test.tsx src/App.tsx src/App.css
git commit -m "feat: add Hermes mission control sidebar"
```

---

### Task 5: Add terminal header summary strip

**Objective:** Make a Hermes terminal readable at a glance before the user reads raw logs.

**Files:**
- Modify: `src/components/TerminalNode.tsx`
- Modify: `src/App.css`
- Test: `src/App.hermes-workspace.test.tsx`

**Step 1: Extend failing UI tests**
Add expectations that a Hermes terminal can show:
- project
- role
- status
- objective or last action
- branch/worktree when available

**Step 2: Run test to verify failure**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: FAIL — terminal header has only current title/shell labels.

**Step 3: Implement minimal summary strip**
In `TerminalNode.tsx`, add an optional Hermes summary area below the existing title block and above the xterm host.

Suggested content priority:
1. role + status chips
2. project label
3. `lastAction` or `objective`
4. branch/worktree/cwd secondary line

Keep the existing AI-agent last-message strip; Hermes summary should complement it, not replace it.

**Step 4: Run tests to verify pass**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: PASS

**Step 5: Commit**
```bash
git add src/components/TerminalNode.tsx src/App.css src/App.hermes-workspace.test.tsx
git commit -m "feat: add Hermes terminal summary strip"
```

---

### Task 6: Rename duplicate semantics to Fork Agent in Hermes mode

**Objective:** Turn existing duplicate behavior into an explicit agent workflow without changing the underlying PTY/session cloning logic yet.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TerminalNode.tsx`
- Test: `src/App.hermes-workspace.test.tsx`

**Step 1: Write failing test**
Add an expectation that in Hermes mode, duplicate-related UI reads `Fork Agent`, while standard mode still says `Duplicate` or `Split`.

**Step 2: Run test to verify failure**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: FAIL

**Step 3: Implement the minimum behavior**
- relabel duplicate actions in Hermes mode
- preserve current duplication behavior (`createDuplicateTerminalNodes`, `handleDuplicateTerminal`) for now
- if metadata exists, copy it to the new forked node and append `copy` only if no better title exists

**Step 4: Run test to verify pass**
Run:
```bash
npm test -- src/App.hermes-workspace.test.tsx
```
Expected: PASS

**Step 5: Commit**
```bash
git add src/App.tsx src/components/TerminalNode.tsx src/App.hermes-workspace.test.tsx
git commit -m "feat: add Hermes fork-agent workflow"
```

---

### Task 7: Add repo-level documentation for the new mode

**Objective:** Document how Hermes mode fits into T-CAN’s existing product identity.

**Files:**
- Modify: `README.md`
- Create: `docs/plans/2026-04-28-hermes-agent-workspace-mvp.md`

**Step 1: Update README**
Add a short section describing:
- Hermes workspace mode
- project-centric agent organization
- role/status labeling
- mission control sidebar
- fork-agent workflow

**Step 2: Verify documentation exists**
Run:
```bash
python3 - <<'PY'
from pathlib import Path
for path in [
    Path('README.md'),
    Path('docs/plans/2026-04-28-hermes-agent-workspace-mvp.md'),
]:
    print(path, path.exists())
PY
```
Expected: both files exist and README contains Hermes mode language.

**Step 3: Commit**
```bash
git add README.md docs/plans/2026-04-28-hermes-agent-workspace-mvp.md
git commit -m "docs: describe Hermes agent workspace MVP"
```

---

## Suggested UI labels

Use concise labels that fit the current T-CAN aesthetic:
- `HERMES MODE`
- `MISSION`
- `FILES`
- `FORK AGENT`
- `PLANNER`
- `BUILDER`
- `TESTER`
- `REVIEWER`
- `RUNNING`
- `WAITING`
- `BLOCKED`
- `DONE`

---

## Testing strategy

### Fast test targets
Use focused commands while implementing:
```bash
npm test -- src/lib/hermesWorkspace.test.ts
npm test -- src/components/HermesSidebar.test.tsx
npm test -- src/App.hermes-workspace.test.tsx
```

### Full regression pass
Before finalizing the MVP slice, run:
```bash
npm test
npm run build
```

If `npm run lint` is part of the normal repo health loop, run it too and clearly separate new failures from any pre-existing ones.

---

## Risks and constraints

1. `src/App.tsx` is already very large, so Hermes logic should be extracted into helper modules/components early.
2. Do not tightly couple Hermes mode to live LLM parsing in v1; keep it metadata-driven.
3. Do not replace existing terminal duplication internals yet; re-skin them as forking first.
4. Preserve standard T-CAN behavior for users who just want generic terminals.
5. Be careful not to break workspace persistence or close/switch flows already covered by `src/App.close-workspace.test.tsx`.

---

## Recommended first execution slice

If implementing immediately, start with this exact sequence:
1. `Task 1` — shared Hermes metadata types
2. `Task 2` — helper extraction
3. `Task 3` — Hermes mode toggle
4. `Task 4` — mission control sidebar
5. `Task 5` — terminal summary strip
6. `Task 6` — fork-agent labels/behavior
7. `Task 7` — README/docs

This order gets visible value quickly while reducing risk in the giant `App.tsx` file.

---

## Definition of done for MVP

The MVP is complete when:
- a workspace can be switched into Hermes mode
- Hermes terminals visibly show project + role + status metadata
- the left rail provides a mission-control summary of active agent terminals
- duplicate agent workflows are presented as explicit forks
- workspace state persists across reloads/restarts
- tests cover the new mode and existing workspace-close behavior still passes

---

Plan complete and saved. Ready to execute using subagent-driven-development or directly inside this branch.