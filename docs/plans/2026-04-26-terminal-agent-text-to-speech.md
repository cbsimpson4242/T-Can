# Terminal Agent Text-to-Speech Implementation Plan

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Add a text-to-speech feature that reads terminal agent responses aloud to the user inside T-CAN.

**Architecture:** Start with a renderer-first implementation using the browser/Electron `speechSynthesis` API so we can prototype quickly without adding server-side TTS dependencies. Detect agent sessions from the terminal metadata already tracked by T-CAN, extract stable agent-response text from streamed terminal output, queue utterances in a small speech manager, and expose simple controls for enable/mute/replay. Keep v1 focused on spoken summaries of *agent responses*, not raw full-terminal narration.

**Tech Stack:** Electron, React, TypeScript, xterm, Web Speech API (`window.speechSynthesis`, `SpeechSynthesisUtterance`), Vitest.

---

## What already exists in the codebase

- `src/components/TerminalNode.tsx`
  - already detects AI/agent terminals via `AI_AGENT_COMMAND_PATTERN`
  - already tracks `lastAgentMessage` from user submissions
  - already subscribes to streamed terminal output via `subscribeToTerminalOutput(sessionId, ...)`
  - already restores terminal snapshot metadata with `window.tcan.getTerminalSession(sessionId)`
- `electron/services/ptyManager.ts`
  - already persists `agentCommandLine`, `isAgentSession`, and `lastAgentMessage` in `TerminalSessionInfo`
- `src/lib/terminalEvents.ts`
  - already fans out per-session terminal output events to the renderer
- `src/App.tsx`
  - already owns top-level workspace state and renders all `TerminalNode` instances
- `shared/types.ts`
  - already has `TerminalSessionInfo` and `TerminalNode` types that can be extended if needed

## Product direction for v1

### User story
When I run Claude/Codex/Gemini/etc. inside a T-CAN terminal, I want T-CAN to read the *agent’s response* out loud so I can keep working with the canvas without staring at the terminal the whole time.

### Explicit non-goals for v1
- Do **not** read every single terminal line aloud.
- Do **not** add a cloud TTS provider yet.
- Do **not** try to perfectly understand every agent’s output format.
- Do **not** speak SSH passwords, shell commands, or noisy build logs.

### v1 behavior target
- TTS can be toggled on/off globally.
- TTS can be toggled on/off per terminal node.
- T-CAN only attempts speech for sessions known to be AI-agent sessions.
- T-CAN speaks after an agent response appears to have *settled* (idle debounce), not on every chunk.
- T-CAN strips ANSI noise and compresses whitespace before speech.
- T-CAN suppresses obviously unsafe/private content such as password prompts.
- T-CAN exposes a manual replay action for the last spoken response.

---

## Proposed implementation shape

### New renderer-only speech layer
Create a small speech manager module in the renderer, likely:
- `src/lib/terminalSpeech.ts`

Responsibilities:
- detect whether `window.speechSynthesis` is available
- manage a queue of utterances
- cancel/replace speech when a newer response supersedes an older one
- expose helper methods like:
  - `speakTerminalAgentResponse(payload)`
  - `cancelTerminalSpeech(sessionId?)`
  - `replayLastTerminalSpeech(sessionId)`
  - `setSpeechEnabled(enabled)`
- keep per-session last spoken text hashes so identical repeated output is not re-read

### Response extraction strategy
Do not speak raw chunks directly from `subscribeToTerminalOutput`.

Instead, per session:
1. accumulate streamed output text in a small rolling buffer
2. strip ANSI/control sequences
3. detect “probably new assistant response” text after the last user prompt
4. debounce for idleness (for example 1200–2000ms with no new output)
5. synthesize the normalized response text if it is non-empty and sufficiently different from the previous spoken text

### Why idle debounce is important
Agent output arrives in many chunks. If we speak too early, the app will interrupt itself constantly. Waiting for short output quiet time should make the voice feel intentional.

### Suggested v1 extraction heuristic
Use a pragmatic heuristic instead of a full parser:
- only run on `isAgentSession === true`
- keep `lastAgentMessage` as the user prompt boundary hint
- after new output arrives, normalize it and inspect the most recent output window
- drop obvious shell prompt echoes and command echoes where possible
- speak only the trailing response block after the latest prompt boundary
- if boundary detection is uncertain, fall back to speaking the last meaningful paragraph block

This is intentionally heuristic. We can harden it later once we see Claude/Codex/Gemini output patterns in real use.

---

## Task breakdown

### Task 1: Add a dedicated speech design note in code comments and create the utility skeleton

**Objective:** Create the isolated renderer-side speech manager so the feature has one place to evolve.

**Files:**
- Create: `src/lib/terminalSpeech.ts`
- Test: `src/lib/terminalSpeech.test.ts`

**Step 1: Write failing tests**

Add tests for:
- ANSI stripping
- whitespace normalization
- password-prompt suppression
- duplicate-text suppression keying

Example test cases:
```ts
import { describe, expect, it } from 'vitest'
import {
  buildSpeechFingerprint,
  normalizeTerminalSpeechText,
  shouldSuppressSpeechText,
  stripTerminalControlSequences,
} from './terminalSpeech'

describe('stripTerminalControlSequences', () => {
  it('removes ansi escape codes', () => {
    expect(stripTerminalControlSequences('\u001b[32mHello\u001b[0m')).toBe('Hello')
  })
})

describe('normalizeTerminalSpeechText', () => {
  it('collapses noisy whitespace', () => {
    expect(normalizeTerminalSpeechText('Hello\n\n\nworld   there')).toBe('Hello world there')
  })
})

describe('shouldSuppressSpeechText', () => {
  it('suppresses password prompts', () => {
    expect(shouldSuppressSpeechText('Password:')).toBe(true)
  })
})

describe('buildSpeechFingerprint', () => {
  it('is stable for equivalent normalized text', () => {
    expect(buildSpeechFingerprint('Hello\nworld')).toBe(buildSpeechFingerprint('Hello world'))
  })
})
```

**Step 2: Run test to verify failure**

Run: `npm test -- src/lib/terminalSpeech.test.ts`

Expected: FAIL because the file does not exist yet.

**Step 3: Write minimal implementation**

Create a utility module with pure helpers first:
- `stripTerminalControlSequences(text: string): string`
- `normalizeTerminalSpeechText(text: string): string`
- `shouldSuppressSpeechText(text: string): boolean`
- `buildSpeechFingerprint(text: string): string`

Keep this task purely functional and side-effect free.

**Step 4: Run test to verify pass**

Run: `npm test -- src/lib/terminalSpeech.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/terminalSpeech.ts src/lib/terminalSpeech.test.ts
git commit -m "feat: add terminal speech text utilities"
```

---

### Task 2: Add speech queue primitives around the Web Speech API

**Objective:** Wrap `speechSynthesis` behind a testable adapter so UI code does not directly manage utterances.

**Files:**
- Modify: `src/lib/terminalSpeech.ts`
- Modify: `src/lib/terminalSpeech.test.ts`

**Step 1: Write failing tests**

Add tests for a small controller interface such as:
- `createTerminalSpeechController(synth)`
- controller stores last spoken fingerprint per session
- controller skips duplicates for the same session
- controller cancels previous queued speech for a session when a newer response arrives

Use a fake synth object instead of the real browser API.

**Step 2: Run test to verify failure**

Run: `npm test -- src/lib/terminalSpeech.test.ts`

Expected: FAIL for missing controller logic.

**Step 3: Write minimal implementation**

Implement a controller with methods like:
```ts
interface TerminalSpeechController {
  isSupported(): boolean
  setEnabled(enabled: boolean): void
  speak(sessionId: string, text: string): void
  cancel(sessionId?: string): void
  replay(sessionId: string): void
}
```

Internally keep:
- global enabled flag
- `lastSpokenTextBySession`
- `lastSpokenFingerprintBySession`
- optional current utterance metadata

**Step 4: Run test to verify pass**

Run: `npm test -- src/lib/terminalSpeech.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/terminalSpeech.ts src/lib/terminalSpeech.test.ts
git commit -m "feat: add terminal speech controller"
```

---

### Task 3: Add terminal-response extraction helpers

**Objective:** Convert raw streamed terminal output into a stable candidate “agent response” text block.

**Files:**
- Modify: `src/lib/terminalSpeech.ts`
- Modify: `src/lib/terminalSpeech.test.ts`

**Step 1: Write failing tests**

Add tests for a helper like:
```ts
extractSpeakableAgentResponse({
  sessionOutput,
  lastAgentMessage,
}): string | null
```

Test cases should cover:
- prompt echo followed by real assistant content
- empty/noisy output returning `null`
- password prompt returning `null`
- duplicate prompt-only output returning `null`
- multi-line response returning a normalized sentence/paragraph string

**Step 2: Run test to verify failure**

Run: `npm test -- src/lib/terminalSpeech.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

Implement a pragmatic extractor:
- strip ANSI/control sequences
- normalize line endings
- trim repeated blank lines
- if `lastAgentMessage` exists, try to locate it in the output and prefer the text after it
- remove obvious trailing shell prompt artifacts if present
- return `null` when the result is too short or suppressible

**Step 4: Run test to verify pass**

Run: `npm test -- src/lib/terminalSpeech.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/terminalSpeech.ts src/lib/terminalSpeech.test.ts
git commit -m "feat: extract speakable terminal agent responses"
```

---

### Task 4: Add persisted TTS preferences for the app

**Objective:** Give the user simple durable control over TTS behavior.

**Files:**
- Modify: `shared/types.ts`
- Modify: `src/App.tsx`
- Optional: `electron/main.ts` if app-state schema validation needs updates
- Optional Test: `src/lib/layout.test.ts` or a new targeted state migration test if persistence is validated there

**Step 1: Write failing tests**

If app state shape is validated anywhere, add a test showing the new TTS defaults are preserved and older state without TTS still loads safely.

**Step 2: Run test to verify failure**

Run the relevant targeted test command.

**Step 3: Write minimal implementation**

Add a compact app preference shape, for example:
```ts
export interface TerminalSpeechPreferences {
  enabled: boolean
  autoSpeakAgentResponses: boolean
  rate: number
}
```

Then store it in app state with conservative defaults:
- `enabled: false`
- `autoSpeakAgentResponses: true`
- `rate: 1`

Important: keep v1 minimal. Do not add voice-selection persistence unless needed immediately.

**Step 4: Run tests**

Run targeted tests, then full `npm test`.

**Step 5: Commit**

```bash
git add shared/types.ts src/App.tsx
git commit -m "feat: add terminal speech preferences"
```

---

### Task 5: Wire top-level app controls for speech enable/mute

**Objective:** Surface a global control in the top bar so the feature is discoverable and quickly stoppable.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Step 1: Write failing UI test**

Add a component-level test verifying:
- a global TTS button renders
- the button reflects enabled/disabled state
- toggling it updates state

If there is no existing App render test harness, add a narrow test around the extracted control component instead.

**Step 2: Run test to verify failure**

Run the relevant targeted test.

**Step 3: Write minimal implementation**

Add a topbar button such as:
- `TTS OFF`
- `TTS ON`
- optional `SPEAKING…` indicator later

Use clear behavior:
- turning TTS off cancels active speech immediately
- turning it on only affects future responses

**Step 4: Run test to verify pass**

Run targeted tests, then `npm test`.

**Step 5: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat: add global terminal speech toggle"
```

---

### Task 6: Add per-terminal speech state and replay affordance

**Objective:** Let users silence one noisy agent terminal while leaving another one audible.

**Files:**
- Modify: `shared/types.ts`
- Modify: `src/components/TerminalNode.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Step 1: Write failing test**

Add a focused component test verifying a terminal node can:
- show a speech toggle when `isAiAgentSession` is true
- call a prop callback to toggle speech for that node
- call a replay callback when last spoken text exists

**Step 2: Run test to verify failure**

Run the targeted component test.

**Step 3: Write minimal implementation**

Add a per-node flag, for example on `TerminalNode` layout state:
```ts
speechEnabled?: boolean
```

Default behavior:
- inherit from global enabled preference when not explicitly overridden
- for v1, keep the UI simple: one mute/unmute icon plus one replay button on agent terminals

**Step 4: Run test to verify pass**

Run targeted tests, then `npm test`.

**Step 5: Commit**

```bash
git add shared/types.ts src/components/TerminalNode.tsx src/App.tsx src/App.css
git commit -m "feat: add per-terminal speech controls"
```

---

### Task 7: Connect streamed terminal output to the speech controller

**Objective:** Speak settled agent responses at the right time.

**Files:**
- Modify: `src/components/TerminalNode.tsx`
- Modify: `src/lib/terminalSpeech.ts`
- Modify Test: `src/lib/terminalSpeech.test.ts`
- Optional Test: `src/components/TerminalNode.test.tsx`

**Step 1: Write failing tests**

Add tests for:
- output chunks arriving quickly only produce one final speech call after idle debounce
- duplicate identical responses are not re-spoken
- disabled terminal/global settings prevent speech
- password prompts are ignored

**Step 2: Run test to verify failure**

Run targeted tests.

**Step 3: Write minimal implementation**

In `TerminalNode.tsx`:
- keep a rolling output buffer ref for the current session
- on `subscribeToTerminalOutput`, append new data
- if agent session + speech enabled, schedule an idle-debounced extraction
- on timer fire, call the speech controller with extracted response text
- on unmount, cancel timers and cancel session speech if desired

Keep this logic isolated; avoid making `TerminalNode` rerender on every output chunk.

**Step 4: Run test to verify pass**

Run targeted tests, then full `npm test` and `npm run build`.

**Step 5: Commit**

```bash
git add src/components/TerminalNode.tsx src/lib/terminalSpeech.ts src/lib/terminalSpeech.test.ts
git commit -m "feat: speak settled terminal agent responses"
```

---

### Task 8: Handle session restore and duplicate terminal behavior

**Objective:** Make speech work predictably when terminals are restored from snapshot or duplicated.

**Files:**
- Modify: `src/components/TerminalNode.tsx`
- Modify: `src/App.tsx`
- Optional: `electron/services/ptyManager.ts` only if additional metadata proves necessary

**Step 1: Write failing tests**

Add tests for:
- restored terminal session does not instantly re-speak stale historic output on mount
- replay still works after restore if last spoken text exists in renderer state
- duplicated terminal nodes do not inherit an already-speaking utterance state accidentally

**Step 2: Run test to verify failure**

Run targeted tests.

**Step 3: Write minimal implementation**

Rules for v1:
- on initial session snapshot load, hydrate buffers quietly
- do not auto-speak old backlog just because the app reopened
- only speak output that arrives after the node mounted or after the user explicitly replays it

**Step 4: Run test to verify pass**

Run targeted tests, then `npm test` and `npm run build`.

**Step 5: Commit**

```bash
git add src/components/TerminalNode.tsx src/App.tsx
git commit -m "feat: stabilize speech across session restore"
```

---

### Task 9: Add a visible status hint and failure fallback

**Objective:** Make it obvious when TTS is unsupported or muted.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Optional: `src/components/TerminalNode.tsx`

**Step 1: Write failing UI test**

Add tests for:
- unsupported speech synthesis shows `TTS UNSUPPORTED`
- disabling TTS updates the label immediately

**Step 2: Run test to verify failure**

Run targeted tests.

**Step 3: Write minimal implementation**

Display concise UI state:
- `TTS ON`
- `TTS OFF`
- `TTS UNSUPPORTED`

Do not block the app if the browser speech API is unavailable.

**Step 4: Run test to verify pass**

Run targeted tests, then `npm test`.

**Step 5: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat: show terminal speech status"
```

---

### Task 10: Manual QA sweep

**Objective:** Verify the feature feels useful with real agent sessions instead of synthetic tests only.

**Files:**
- No required source changes
- Optional notes update: `README.md`

**Step 1: Start the app**

Run:
```bash
npm run dev
```

**Step 2: Manual scenarios**

Verify all of these:
1. launch a new local terminal
2. start `codex` or `claude`
3. send a short prompt
4. confirm the app speaks the reply once after it settles
5. confirm repeated identical follow-up output is not re-read every chunk
6. toggle global TTS off and confirm current speech stops
7. toggle one terminal muted while another remains audible
8. verify password prompts are never spoken
9. verify SSH session behavior does not speak login prompts
10. verify restore/reopen does not read stale historical backlog aloud automatically

**Step 3: Build verification**

Run:
```bash
npm test
npm run build
```

Expected: PASS

**Step 4: Commit doc polish if needed**

```bash
git add README.md
git commit -m "docs: document terminal speech controls"
```

---

## Exact code touchpoints likely involved

- `src/components/TerminalNode.tsx`
  - best place to observe live per-session output
  - likely home for per-terminal debounce refs and speech trigger wiring
- `src/lib/terminalEvents.ts`
  - probably does not need modification, but is the current event fanout layer
- `src/lib/terminalSpeech.ts`
  - new pure/helper + controller layer
- `src/App.tsx`
  - likely home for global TTS toggle and persisted preference state
- `src/App.css`
  - topbar button styling + per-terminal speech control styling
- `shared/types.ts`
  - likely home for `TerminalSpeechPreferences` and optional `speechEnabled` on terminal nodes
- `electron/services/ptyManager.ts`
  - only touch if we discover renderer needs richer metadata than `lastAgentMessage` / `isAgentSession`

---

## Open design questions

1. **What exactly counts as an “agent response”?**
   - v1 answer: last stable meaningful output block after the latest agent prompt boundary.

2. **Should speech be global-only or per-terminal too?**
   - recommended: both, because parallel agent sessions are a core T-CAN use case.

3. **Should we use browser speech or a real TTS provider first?**
   - recommended: browser speech first for zero backend dependency and fastest iteration.

4. **Should the app speak on restore/relaunch?**
   - recommended: no, only new output or manual replay.

5. **Should we expose voice/rate settings in v1?**
   - recommended: keep only rate if it is trivial; otherwise ship ON/OFF first.

---

## Risks and mitigations

### Risk: noisy or repetitive speech
**Mitigation:** idle debounce, duplicate suppression, per-session last fingerprint tracking.

### Risk: speaking secrets or SSH prompts
**Mitigation:** explicit suppression of password/passphrase/login prompts and never speaking user keystrokes directly.

### Risk: agent output parsing is inconsistent across Codex/Claude/Gemini
**Mitigation:** use heuristics for v1 and test against multiple real agents before broadening scope.

### Risk: renderer rerender churn from output-driven state
**Mitigation:** keep rolling buffers, timers, and speech bookkeeping in refs or utility modules instead of React state.

---

## Recommended first implementation slice

If we want the fastest path to a demo, do this first:
1. build `src/lib/terminalSpeech.ts`
2. add a single global `TTS ON/OFF` button
3. make agent terminals speak one debounced response using Web Speech API
4. skip per-terminal controls until the demo works

That gives a fast proof-of-value without over-designing the first pass.

---

## Execution handoff

Plan complete and saved. Ready to execute using `subagent-driven-development` — dispatch a fresh subagent per task with verification after each step, or implement the recommended first slice directly on this `text-to-speech` branch.
