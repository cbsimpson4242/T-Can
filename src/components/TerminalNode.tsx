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
import type { ClipboardTextMode, TerminalNode as TerminalNodeModel } from '../../shared/types'
import { subscribeToTerminalOutput, subscribeToTerminalPaste, useTerminalExit } from '../lib/terminalEvents'

const BASE_TERMINAL_FONT_SIZE = 13

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
  workspacePath: string | null
  scale: number
  selected: boolean
  onSelect(event: ReactPointerEvent<HTMLElement>): void
  onMoveStart(event: ReactPointerEvent<HTMLElement>): void
  onResizeStart(event: ReactPointerEvent<HTMLButtonElement>): void
  onClose(): void
}

function getShellLabel(shell?: string): string | null {
  if (!shell) {
    return null
  }

  const label = shell.split(/[/\\]/).pop()
  return label && label.length > 0 ? label : shell
}

export function TerminalNode(props: TerminalNodeProps) {
  const { node, canvasRect, sessionId, shell, workspacePath, scale, selected, onSelect, onMoveStart, onResizeStart, onClose } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const exitCode = useTerminalExit(sessionId)

  const sessionLabel = useMemo(() => workspacePath ?? 'Home shell', [workspacePath])
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

  const pasteFromClipboard = useCallback(
    async (mode: ClipboardTextMode, allowClipboardFallback = false) => {
      if (!sessionId) {
        return
      }

      let text = await window.tcan.readClipboardForTerminal({ sessionId, mode })

      if (!text && allowClipboardFallback && mode !== 'clipboard') {
        text = await window.tcan.readClipboardForTerminal({ sessionId, mode: 'clipboard' })
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

    void window.tcan.resizeTerminal(sessionId, terminal.cols, terminal.rows)

    let disposed = false
    const outputCleanup = subscribeToTerminalOutput(sessionId, (data) => {
      terminal.write(data)
    })

    void window.tcan.getTerminalSession(sessionId).then((snapshot) => {
      if (!disposed && snapshot?.output) {
        terminal.write(snapshot.output)
      }
    })

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
      fitAddonRef.current = null
      terminalRef.current = null
      setIsReady(false)
      setIsFocused(false)
      terminal.dispose()
    }
  }, [focusTerminal, node.title, pasteFromClipboard, pasteText, sessionId])

  useLayoutEffect(() => {
    if (!sessionId || !fitAddonRef.current || !terminalRef.current) {
      return
    }

    terminalRef.current.options.fontSize = BASE_TERMINAL_FONT_SIZE * scale
    fitAddonRef.current.fit()
    const terminal = terminalRef.current
    void window.tcan.resizeTerminal(sessionId, terminal.cols, terminal.rows)
  }, [canvasRect.height, canvasRect.width, scale, sessionId])

  function handleAuxClick(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 1) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    focusTerminal()
    void pasteFromClipboard('selection', true)
  }

  function handleTerminalHover() {
    focusTerminal()
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!sessionId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    focusTerminal()
    void window.tcan.showTerminalContextMenu(sessionId)
  }

  const className = [
    'terminal-node',
    selected ? 'terminal-node--selected' : null,
    isFocused ? 'terminal-node--active' : null,
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
      onAuxClick={handleAuxClick}
      onContextMenu={handleContextMenu}
      onPointerEnter={handleTerminalHover}
      onPointerMove={handleTerminalHover}
      onPointerDown={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          event.stopPropagation()
          focusTerminal()
        }
      }}
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
      <button
        aria-label={`Resize ${node.title}`}
        className="terminal-node__resize-handle"
        onPointerDown={onResizeStart}
        type="button"
      />
    </article>
  )
}
