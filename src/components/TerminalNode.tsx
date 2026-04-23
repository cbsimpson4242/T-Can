import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { FitAddon } from 'xterm-addon-fit'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'
import type { ClipboardTextMode, TerminalNode as TerminalNodeModel } from '../../shared/types'
import { subscribeToTerminalOutput, subscribeToTerminalPaste, useTerminalExit } from '../lib/terminalEvents'

interface TerminalNodeProps {
  node: TerminalNodeModel
  sessionId?: string
  shell?: string
  workspacePath: string | null
  scale: number
  onMove(delta: { x: number; y: number }): void
  onResize(delta: { width: number; height: number }): void
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
  const { node, sessionId, shell, workspacePath, scale, onMove, onResize, onClose } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const exitCode = useTerminalExit(sessionId)

  const sessionLabel = useMemo(() => workspacePath ?? 'Home shell', [workspacePath])
  const shellLabel = useMemo(() => getShellLabel(shell), [shell])

  function focusTerminal() {
    terminalRef.current?.focus()
  }

  function pasteText(text: string) {
    if (!text) {
      return
    }

    terminalRef.current?.paste(text)
    focusTerminal()
  }

  async function pasteFromClipboard(mode: ClipboardTextMode, allowClipboardFallback = false) {
    let text = await window.tcan.readClipboardText(mode)

    if (!text && allowClipboardFallback && mode !== 'clipboard') {
      text = await window.tcan.readClipboardText('clipboard')
    }

    pasteText(text)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host || !sessionId) {
      return
    }

    const terminal = new Terminal({
      convertEol: true,
      fontFamily: 'Cascadia Mono, Consolas, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
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
    if (helperTextarea instanceof HTMLTextAreaElement) {
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

    const handleHostPointerDown = () => {
      focusTerminal()
    }

    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      pasteText(event.clipboardData?.getData('text/plain') ?? event.clipboardData?.getData('text') ?? '')
    }

    host.addEventListener('pointerdown', handleHostPointerDown)
    helperTextarea?.addEventListener('paste', handlePaste, true)

    void window.tcan.resizeTerminal(sessionId, terminal.cols, terminal.rows)

    const outputCleanup = subscribeToTerminalOutput(sessionId, (data) => {
      terminal.write(data)
    })

    const pasteCleanup = subscribeToTerminalPaste(sessionId, (data) => {
      pasteText(data)
    })

    const dataDisposable = terminal.onData((data) => {
      void window.tcan.writeTerminal(sessionId, data)
    })

    const handleFocus = () => {
      setIsFocused(true)
    }

    const handleBlur = () => {
      setIsFocused(false)
    }

    helperTextarea?.addEventListener('focus', handleFocus)
    helperTextarea?.addEventListener('blur', handleBlur)

    return () => {
      outputCleanup()
      pasteCleanup()
      host.removeEventListener('pointerdown', handleHostPointerDown)
      helperTextarea?.removeEventListener('paste', handlePaste, true)
      dataDisposable.dispose()
      helperTextarea?.removeEventListener('focus', handleFocus)
      helperTextarea?.removeEventListener('blur', handleBlur)
      fitAddonRef.current = null
      terminalRef.current = null
      setIsReady(false)
      setIsFocused(false)
      terminal.dispose()
    }
  }, [node.title, sessionId])

  useLayoutEffect(() => {
    if (!sessionId || !fitAddonRef.current || !terminalRef.current) {
      return
    }

    fitAddonRef.current.fit()
    const terminal = terminalRef.current
    void window.tcan.resizeTerminal(sessionId, terminal.cols, terminal.rows)
  }, [node.width, node.height, scale, sessionId])

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    focusTerminal()
    event.preventDefault()
    let previousX = event.clientX
    let previousY = event.clientY

    const move = (pointerEvent: PointerEvent) => {
      onMove({
        x: (pointerEvent.clientX - previousX) / scale,
        y: (pointerEvent.clientY - previousY) / scale,
      })
      previousX = pointerEvent.clientX
      previousY = pointerEvent.clientY
    }

    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return
    }

    focusTerminal()
    event.preventDefault()
    event.stopPropagation()
    let previousX = event.clientX
    let previousY = event.clientY

    const move = (pointerEvent: PointerEvent) => {
      onResize({
        width: (pointerEvent.clientX - previousX) / scale,
        height: (pointerEvent.clientY - previousY) / scale,
      })
      previousX = pointerEvent.clientX
      previousY = pointerEvent.clientY
    }

    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function handleAuxClick(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 1) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    focusTerminal()
    void pasteFromClipboard('selection', true)
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

  return (
    <article
      className={isFocused ? 'terminal-node terminal-node--active' : 'terminal-node'}
      onAuxClick={handleAuxClick}
      onContextMenu={handleContextMenu}
      onPointerDown={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.width,
        height: node.height,
      }}
    >
      <header className="terminal-node__header" onPointerDown={beginDrag}>
        <div className="terminal-node__lights" aria-hidden="true">
          <span className="terminal-node__light terminal-node__light--red" />
          <span className="terminal-node__light terminal-node__light--amber" />
          <span className="terminal-node__light terminal-node__light--green" />
        </div>
        <div className="terminal-node__titleblock">
          <strong>{node.title.toUpperCase()}</strong>
          <span>{shellLabel ? `${sessionLabel} • ${shellLabel}` : sessionLabel}</span>
        </div>
        <button aria-label={`Close ${node.title}`} className="icon-button" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="terminal-node__body">
        {!sessionId && <div className="terminal-node__overlay">Starting terminal…</div>}
        {sessionId && exitCode !== null && (
          <div className="terminal-node__overlay">Terminal exited with code {exitCode}</div>
        )}
        <div className="terminal-node__terminal" data-ready={isReady} ref={hostRef} />
      </div>
      <button
        aria-label={`Resize ${node.title}`}
        className="terminal-node__resize-handle"
        onPointerDown={beginResize}
        type="button"
      />
    </article>
  )
}
