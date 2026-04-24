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
  onMoveStart(event: ReactPointerEvent<HTMLElement>): void
  onResizeStart(event: ReactPointerEvent<HTMLButtonElement>, direction: NodeResizeDirection): void
  onClose(): void
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

export function TerminalNode(props: TerminalNodeProps) {
  const { node, canvasRect, sessionId, shell, sshPassword, workspacePath, scale, selected, onSelect, onMoveStart, onResizeStart, onClose } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastSentTerminalSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const sshPasswordPromptBufferRef = useRef('')
  const hasSentSshPasswordRef = useRef(false)
  const resizeTimerRef = useRef<number | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const exitCode = useTerminalExit(sessionId)

  const sessionLabel = useMemo(() => (node.sshTarget ? `SSH ${node.sshTarget}` : workspacePath ?? 'Home shell'), [node.sshTarget, workspacePath])
  const shellLabel = useMemo(() => getShellLabel(shell), [shell])

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
      helperTextarea.setAttribute('aria-label', `${node.title} terminal input`)
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
      const isPasteShortcut = !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && lowerKey === 'v'
      const isShiftInsert = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Insert'

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
    host.addEventListener('pointermove', handleHostPointerFocus)
    helperTextarea?.addEventListener('paste', handlePaste, true)
    helperTextarea?.addEventListener('focus', handleFocus)
    helperTextarea?.addEventListener('blur', handleBlur)

    let disposed = false
    sshPasswordPromptBufferRef.current = ''
    hasSentSshPasswordRef.current = false

    const maybeSendSshPassword = (data: string) => {
      if (!sshPassword || hasSentSshPasswordRef.current) {
        return
      }

      sshPasswordPromptBufferRef.current = `${sshPasswordPromptBufferRef.current}${data}`.slice(-300)
      if (/password(?: for [^:\r\n]+)?\s*:\s*$/i.test(sshPasswordPromptBufferRef.current)) {
        hasSentSshPasswordRef.current = true
        void window.tcan.writeTerminal(sessionId, `${sshPassword}\r`)
      }
    }

    const outputCleanup = subscribeToTerminalOutput(sessionId, (data) => {
      terminal.write(data)
      maybeSendSshPassword(data)
    })

    if (canGetTerminalSession()) {
      void window.tcan.getTerminalSession(sessionId).then((snapshot) => {
        if (!disposed && snapshot?.output) {
          terminal.write(snapshot.output)
          maybeSendSshPassword(snapshot.output)
        }
      })
    }

    const pasteCleanup = subscribeToTerminalPaste(sessionId, (data) => {
      pasteText(data)
    })

    const dataDisposable = terminal.onData((data) => {
      void window.tcan.writeTerminal(sessionId, data)
    })

    return () => {
      disposed = true
      outputCleanup()
      pasteCleanup()
      host.removeEventListener('pointerdown', handleHostPointerFocus)
      host.removeEventListener('pointerenter', handleHostPointerFocus)
      host.removeEventListener('pointermove', handleHostPointerFocus)
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
      setIsReady(false)
      setIsFocused(false)
      setIsHovered(false)
      terminal.dispose()
    }
  }, [focusTerminal, node.title, pasteFromClipboard, pasteText, sendTerminalResize, sessionId, sshPassword])

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

  return (
    <article
      className={className}
      onContextMenu={handleContextMenu}
      onPointerEnter={handleTerminalHover}
      onPointerMove={handleTerminalHover}
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
