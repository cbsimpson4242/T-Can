import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { FitAddon } from 'xterm-addon-fit'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'
import type { ClipboardTextMode, NodeResizeDirection, TerminalNode as TerminalNodeModel } from '../../shared/types'
import { subscribeToTerminalOutput, subscribeToTerminalPaste, useTerminalExit } from '../lib/terminalEvents'

const BASE_TERMINAL_FONT_SIZE = 13
const PTY_RESIZE_DEBOUNCE_MS = 150
const RESIZE_DIRECTIONS: NodeResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const AI_AGENT_COMMAND_PATTERN = /^(?:(?:npx|bunx|uvx)(?:\s+--?[^\s]+)*\s+|(?:pnpm\s+dlx|yarn\s+dlx|npm\s+exec)(?:\s+--?[^\s]+)*\s+)?(?:pi(?:[-\s]+agent)?|opencode(?:-ai)?|claude(?:[-\s]+code)?|@anthropic-ai\/claude-code|codex|@openai\/codex|gemini(?:[-\s]+cli)?|@google\/gemini-cli|aider|cursor(?:[-\s]+agent)?)(?:\s|$)/i
const AI_AGENT_OUTPUT_PATTERN = /\b(?:pi\s+(?:coding\s+)?agent|opencode(?:\s+ai)?|claude(?:\s+code)?|codex|gemini(?:\s+cli)?|aider|cursor\s+agent)\b/i
const AI_AGENT_PROMPT_SCROLL_LINE_THRESHOLD = 2
const AI_AGENT_PROMPT_SCROLL_CHAR_THRESHOLD = 120
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const BRACKETED_PASTE_START = `${ESC}[200~`
const BRACKETED_PASTE_END = `${ESC}[201~`

interface ProjectedNodeRect {
  left: number
  top: number
  width: number
  height: number
}

interface TerminalNodeProps {
  node: TerminalNodeModel
  canvasRect: ProjectedNodeRect
  sessionId?: string
  shell?: string
  sshPassword?: string
  workspacePath: string | null
  scale: number
  selected: boolean
  onSelect(event: ReactPointerEvent<HTMLElement>): void
  onContextMenu?(event: ReactMouseEvent<HTMLElement>): void
  onMoveStart(event: ReactPointerEvent<HTMLElement>): void
  onResizeStart(event: ReactPointerEvent<HTMLButtonElement>, direction: NodeResizeDirection): void
  onClose(): void
  onSshPasswordCaptured?(target: string, password: string): void
}

function getShellLabel(shell?: string): string | null {
  if (!shell) {
    return null
  }

  const label = shell.split(/[/\\]/).pop()
  return label && label.length > 0 ? label : shell
}

function canReadClipboardForTerminal(): boolean {
  return typeof window.tcan?.readClipboardForTerminal === 'function'
}

function canGetTerminalSession(): boolean {
  return typeof window.tcan?.getTerminalSession === 'function'
}

function canWriteClipboardText(): boolean {
  return typeof window.tcan?.writeClipboardText === 'function'
}

function normalizeTerminalPrompt(text: string): string {
  const withoutAnsi = text
    .replace(new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
    .replace(new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g'), '')

  return Array.from(withoutAnsi)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
}

function isSshPasswordPrompt(text: string): boolean {
  const normalized = normalizeTerminalPrompt(text)
  return /(?:password|passphrase)(?:\s+for\s+[^:\r\n]+|[^:\r\n]*)?:\s*$/i.test(normalized)
}

function stripBracketedPasteMarkers(input: string): string {
  return input.split(BRACKETED_PASTE_START).join('').split(BRACKETED_PASTE_END).join('')
}

function normalizeSubmittedAgentMessage(input: string): string {
  return stripBracketedPasteMarkers(input)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function isKnownAiAgentCommand(input: string): boolean {
  return AI_AGENT_COMMAND_PATTERN.test(input.trim())
}

function containsKnownAiAgentOutput(data: string): boolean {
  return AI_AGENT_OUTPUT_PATTERN.test(data)
}

export function TerminalNode(props: TerminalNodeProps) {
  const { node, canvasRect, sessionId, shell, sshPassword, workspacePath, scale, selected, onSelect, onContextMenu, onMoveStart, onResizeStart, onClose, onSshPasswordCaptured } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastSentTerminalSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const sshPasswordPromptBufferRef = useRef('')
  const hasSentSshPasswordRef = useRef(false)
  const currentSshPasswordRef = useRef(sshPassword)
  const onSshPasswordCapturedRef = useRef(onSshPasswordCaptured)
  const isCapturingSshPasswordRef = useRef(false)
  const capturedSshPasswordRef = useRef('')
  const resizeTimerRef = useRef<number | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const inputBufferRef = useRef('')
  const isAiAgentSessionRef = useRef(false)
  const [isReady, setIsReady] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isAiAgentSession, setIsAiAgentSession] = useState(false)
  const [lastAgentMessage, setLastAgentMessage] = useState('')
  const exitCode = useTerminalExit(sessionId)

  const sessionLabel = useMemo(() => (node.sshTarget ? `SSH ${node.sshTarget}` : workspacePath ?? 'Home shell'), [node.sshTarget, workspacePath])
  const shellLabel = useMemo(() => getShellLabel(shell), [shell])

  useEffect(() => {
    currentSshPasswordRef.current = sshPassword
    if (sshPassword && sessionId && !hasSentSshPasswordRef.current && isSshPasswordPrompt(sshPasswordPromptBufferRef.current)) {
      hasSentSshPasswordRef.current = true
      isCapturingSshPasswordRef.current = false
      capturedSshPasswordRef.current = ''
      void window.tcan.writeTerminal(sessionId, `${sshPassword}\r`)
    }
  }, [sessionId, sshPassword])

  useEffect(() => {
    onSshPasswordCapturedRef.current = onSshPasswordCaptured
  }, [onSshPasswordCaptured])

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus()
  }, [])

  const pasteText = useCallback(
    (text: string) => {
      if (!text) {
        return
      }

      terminalRef.current?.paste(text)
      focusTerminal()
    },
    [focusTerminal],
  )

  const sendTerminalResize = useCallback(
    (terminal: Terminal, mode: 'immediate' | 'debounced' = 'debounced') => {
      if (!sessionId) {
        return
      }

      const size = { cols: terminal.cols, rows: terminal.rows }
      const lastSentSize = lastSentTerminalSizeRef.current
      if (lastSentSize?.cols === size.cols && lastSentSize.rows === size.rows) {
        return
      }

      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }

      const send = () => {
        lastSentTerminalSizeRef.current = size
        void window.tcan.resizeTerminal(sessionId, size.cols, size.rows)
      }

      if (mode === 'immediate') {
        send()
        return
      }

      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        send()
      }, PTY_RESIZE_DEBOUNCE_MS)
    },
    [sessionId],
  )

  const copySelectionToClipboard = useCallback(async () => {
    const terminal = terminalRef.current
    const text = terminal?.getSelection() ?? ''
    if (!text) {
      return
    }

    try {
      if (canWriteClipboardText()) {
        await window.tcan.writeClipboardText(text)
        return
      }

      await navigator.clipboard?.writeText(text)
    } catch {
      // Ignore clipboard failures so Alt+C never leaks into the terminal when text is selected.
    }
  }, [])

  const markAiAgentSession = useCallback(() => {
    if (isAiAgentSessionRef.current) {
      return
    }

    isAiAgentSessionRef.current = true
    setIsAiAgentSession(true)
  }, [])

  const handleSubmittedInput = useCallback(
    (input: string) => {
      const message = normalizeSubmittedAgentMessage(input)
      if (!message) {
        return
      }

      if (isKnownAiAgentCommand(message)) {
        markAiAgentSession()
        return
      }

      if (isAiAgentSessionRef.current && !isCapturingSshPasswordRef.current) {
        setLastAgentMessage(message)
      }
    },
    [markAiAgentSession],
  )

  const processTerminalInput = useCallback(
    (data: string) => {
      if (!data) {
        return
      }

      const cleanedData = stripBracketedPasteMarkers(data)
      for (const character of cleanedData) {
        if (character === '\r') {
          handleSubmittedInput(inputBufferRef.current)
          inputBufferRef.current = ''
          continue
        }

        if (character === '\n') {
          inputBufferRef.current = `${inputBufferRef.current}\n`
          continue
        }

        if (character === '\u0003' || character === '\u001b' || character === '\u0015') {
          inputBufferRef.current = ''
          continue
        }

        if (character === '\u007f' || character === '\b') {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1)
          continue
        }

        if (character >= ' ' || character === '\t') {
          inputBufferRef.current = `${inputBufferRef.current}${character}`
        }
      }
    },
    [handleSubmittedInput],
  )

  const pasteFromClipboard = useCallback(
    async (mode: ClipboardTextMode, allowClipboardFallback = false) => {
      if (!sessionId) {
        return
      }

      let text = ''

      if (canReadClipboardForTerminal()) {
        text = await window.tcan.readClipboardForTerminal({ sessionId, mode })

        if (!text && allowClipboardFallback && mode !== 'clipboard') {
          text = await window.tcan.readClipboardForTerminal({ sessionId, mode: 'clipboard' })
        }
      } else if (typeof window.tcan?.readClipboardText === 'function') {
        text = await window.tcan.readClipboardText(mode)

        if (!text && allowClipboardFallback && mode !== 'clipboard') {
          text = await window.tcan.readClipboardText('clipboard')
        }
      }

      pasteText(text)
    },
    [pasteText, sessionId],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || !sessionId) {
      return
    }

    const terminal = new Terminal({
      convertEol: true,
      fontFamily: 'Cascadia Mono, Consolas, SFMono-Regular, Menlo, monospace',
      fontSize: BASE_TERMINAL_FONT_SIZE,
      cursorBlink: true,
      theme: {
        background: '#0a0a0a',
        foreground: '#00ff41',
        cursor: '#00ff41',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#003907',
        black: '#0a0a0a',
        brightBlack: '#3a3939',
        green: '#00ff41',
        brightGreen: '#72ff70',
        cyan: '#00f1fd',
        brightCyan: '#6ff6ff',
        red: '#ff6b6b',
        yellow: '#ffd166',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()
    sendTerminalResize(terminal, 'immediate')
    terminal.focus()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    setIsReady(true)

    const helperTextarea = host.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    if (helperTextarea) {
      helperTextarea.classList.add('terminal-node__helper-textarea')
      helperTextarea.setAttribute('autocomplete', 'off')
      helperTextarea.setAttribute('autocorrect', 'off')
      helperTextarea.setAttribute('autocapitalize', 'off')
      helperTextarea.spellcheck = false
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true
      }

      const lowerKey = event.key.toLowerCase()
      const isAltCopyShortcut = event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && lowerKey === 'c'
      const isPasteShortcut = !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && lowerKey === 'v'
      const isShiftInsert = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Insert'

      if (isAltCopyShortcut && terminal.hasSelection()) {
        event.preventDefault()
        void copySelectionToClipboard()
        return false
      }

      if (!isPasteShortcut && !isShiftInsert) {
        return true
      }

      event.preventDefault()
      void pasteFromClipboard('clipboard')
      return false
    })

    const handleHostPointerFocus = () => {
      focusTerminal()
    }

    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const text = event.clipboardData?.getData('text/plain') ?? event.clipboardData?.getData('text') ?? ''
      if (text) {
        pasteText(text)
        return
      }

      void pasteFromClipboard('clipboard')
    }

    const handleFocus = () => {
      setIsFocused(true)
    }

    const handleBlur = () => {
      setIsFocused(false)
    }

    host.addEventListener('pointerdown', handleHostPointerFocus)
    host.addEventListener('pointerenter', handleHostPointerFocus)
    helperTextarea?.addEventListener('paste', handlePaste, true)
    helperTextarea?.addEventListener('focus', handleFocus)
    helperTextarea?.addEventListener('blur', handleBlur)

    let disposed = false
    sshPasswordPromptBufferRef.current = ''
    hasSentSshPasswordRef.current = false
    isCapturingSshPasswordRef.current = false
    capturedSshPasswordRef.current = ''

    const maybeHandleSshPasswordPrompt = (data: string) => {
      sshPasswordPromptBufferRef.current = `${sshPasswordPromptBufferRef.current}${data}`.slice(-300)
      if (!isSshPasswordPrompt(sshPasswordPromptBufferRef.current)) {
        return
      }

      const currentSshPassword = currentSshPasswordRef.current
      if (currentSshPassword && !hasSentSshPasswordRef.current) {
        hasSentSshPasswordRef.current = true
        void window.tcan.writeTerminal(sessionId, `${currentSshPassword}\r`)
        return
      }

      if (!currentSshPassword && node.sshTarget) {
        isCapturingSshPasswordRef.current = true
        capturedSshPasswordRef.current = ''
      }
    }

    const captureManualSshPasswordInput = (data: string) => {
      if (!node.sshTarget || !isCapturingSshPasswordRef.current || currentSshPasswordRef.current) {
        return
      }

      for (const character of data) {
        if (character === '\r' || character === '\n') {
          const capturedPassword = capturedSshPasswordRef.current
          isCapturingSshPasswordRef.current = false
          capturedSshPasswordRef.current = ''
          if (capturedPassword) {
            onSshPasswordCapturedRef.current?.(node.sshTarget, capturedPassword)
          }
          continue
        }

        if (character === '\u0003' || character === '\u001b') {
          isCapturingSshPasswordRef.current = false
          capturedSshPasswordRef.current = ''
          continue
        }

        if (character === '\b' || character === '\u007f') {
          capturedSshPasswordRef.current = capturedSshPasswordRef.current.slice(0, -1)
          continue
        }

        if (character >= ' ') {
          capturedSshPasswordRef.current = `${capturedSshPasswordRef.current}${character}`
        }
      }
    }

    const outputCleanup = subscribeToTerminalOutput(sessionId, (data) => {
      terminal.write(data)
      maybeHandleSshPasswordPrompt(data)
      if (containsKnownAiAgentOutput(data)) {
        markAiAgentSession()
      }
    })

    if (canGetTerminalSession()) {
      void window.tcan.getTerminalSession(sessionId).then((snapshot) => {
        if (disposed || !snapshot) {
          return
        }

        if (snapshot.info.isAgentSession || snapshot.info.agentCommandLine) {
          markAiAgentSession()
        }
        if (snapshot.info.lastAgentMessage) {
          setLastAgentMessage(snapshot.info.lastAgentMessage)
        }
        if (snapshot.output) {
          terminal.write(snapshot.output)
          maybeHandleSshPasswordPrompt(snapshot.output)
          if (containsKnownAiAgentOutput(snapshot.output)) {
            markAiAgentSession()
          }
        }
      })
    }

    const pasteCleanup = subscribeToTerminalPaste(sessionId, (data) => {
      pasteText(data)
    })

    const dataDisposable = terminal.onData((data) => {
      processTerminalInput(data)
      captureManualSshPasswordInput(data)
      void window.tcan.writeTerminal(sessionId, data)
    })

    return () => {
      disposed = true
      outputCleanup()
      pasteCleanup()
      host.removeEventListener('pointerdown', handleHostPointerFocus)
      host.removeEventListener('pointerenter', handleHostPointerFocus)
      helperTextarea?.removeEventListener('paste', handlePaste, true)
      helperTextarea?.removeEventListener('focus', handleFocus)
      helperTextarea?.removeEventListener('blur', handleBlur)
      dataDisposable.dispose()
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
      fitAddonRef.current = null
      terminalRef.current = null
      inputBufferRef.current = ''
      isAiAgentSessionRef.current = false
      setIsReady(false)
      setIsFocused(false)
      setIsHovered(false)
      setIsAiAgentSession(false)
      setLastAgentMessage('')
      terminal.dispose()
    }
  }, [copySelectionToClipboard, focusTerminal, markAiAgentSession, node.sshTarget, pasteFromClipboard, pasteText, processTerminalInput, sendTerminalResize, sessionId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const helperTextarea = host.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    if (!helperTextarea) {
      return
    }

    helperTextarea.setAttribute('aria-label', `${node.title} terminal input`)
  }, [node.title, sessionId])

  useLayoutEffect(() => {
    if (!sessionId || !fitAddonRef.current || !terminalRef.current) {
      return
    }

    if (resizeRafRef.current !== null) {
      window.cancelAnimationFrame(resizeRafRef.current)
    }

    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null
      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current
      if (!terminal || !fitAddon) {
        return
      }

      terminal.options.fontSize = BASE_TERMINAL_FONT_SIZE * scale
      fitAddon.fit()
      sendTerminalResize(terminal)
    })
  }, [canvasRect.height, canvasRect.width, scale, sendTerminalResize, sessionId])

  function handleTerminalHover() {
    setIsHovered(true)
    focusTerminal()
  }

  function handleTerminalLeave() {
    setIsHovered(false)
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (onContextMenu) {
      onContextMenu(event)
      return
    }

    if (!sessionId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    focusTerminal()
    void pasteFromClipboard('selection', true)
  }

  const className = [
    'terminal-node',
    selected ? 'terminal-node--selected' : null,
    isFocused && isHovered ? 'terminal-node--active' : null,
  ]
    .filter(Boolean)
    .join(' ')

  const style = {
    transform: `translate(${canvasRect.left}px, ${canvasRect.top}px)`,
    width: canvasRect.width,
    height: canvasRect.height,
    '--node-scale': `${scale}`,
  } as CSSProperties

  const lastAgentMessageLineCount = Math.max(1, lastAgentMessage.split('\n').length)
  const shouldScrollLastAgentMessage = lastAgentMessageLineCount > AI_AGENT_PROMPT_SCROLL_LINE_THRESHOLD || lastAgentMessage.length > AI_AGENT_PROMPT_SCROLL_CHAR_THRESHOLD
  const lastAgentMessageStyle = {
    '--agent-message-scroll-duration': `${Math.max(8, Math.min(28, lastAgentMessageLineCount * 3 + Math.ceil(lastAgentMessage.length / 45)))}s`,
  } as CSSProperties

  return (
    <article
      className={className}
      onContextMenu={handleContextMenu}
      onPointerEnter={handleTerminalHover}
      onPointerLeave={handleTerminalLeave}
      onPointerDownCapture={onSelect}
      style={style}
    >
      <header className="terminal-node__header" onPointerDown={onMoveStart}>
        <div className="terminal-node__lights" aria-hidden="true">
          <span className="terminal-node__light terminal-node__light--red" />
          <span className="terminal-node__light terminal-node__light--amber" />
          <span className="terminal-node__light terminal-node__light--green" />
        </div>
        <div className="terminal-node__titleblock">
          <strong>{node.title.toUpperCase()}</strong>
          <span>{shellLabel ? `${sessionLabel} / ${shellLabel}` : sessionLabel}</span>
        </div>
        <button
          aria-label={`Close ${node.title}`}
          className="icon-button"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          x
        </button>
      </header>
      <div className="terminal-node__body">
        {!sessionId && <div className="terminal-node__overlay">Starting terminal...</div>}
        {sessionId && exitCode !== null && (
          <div className="terminal-node__overlay">Terminal exited with code {exitCode}</div>
        )}
        {isAiAgentSession && lastAgentMessage && (
          <div className="terminal-node__agent-message" title={lastAgentMessage}>
            <span className="terminal-node__agent-message-label">Last prompt</span>
            <div className="terminal-node__agent-message-viewport">
              <div
                className={shouldScrollLastAgentMessage ? 'terminal-node__agent-message-text terminal-node__agent-message-text--scrolling' : 'terminal-node__agent-message-text'}
                style={lastAgentMessageStyle}
              >
                {lastAgentMessage}
              </div>
            </div>
          </div>
        )}
        <div className="terminal-node__terminal" data-ready={isReady} ref={hostRef} />
      </div>
      {RESIZE_DIRECTIONS.map((direction) => (
        <button
          aria-label={`Resize ${node.title} from ${direction}`}
          className={`terminal-node__resize-handle terminal-node__resize-handle--${direction}`}
          key={direction}
          onPointerDown={(event) => onResizeStart(event, direction)}
          type="button"
        />
      ))}
    </article>
  )
}
