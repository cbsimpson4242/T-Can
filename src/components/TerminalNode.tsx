import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FitAddon } from 'xterm-addon-fit'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'
import type { TerminalNode as TerminalNodeModel } from '../../shared/types'
import { subscribeToTerminalOutput, useTerminalExit } from '../lib/terminalEvents'

interface TerminalNodeProps {
  node: TerminalNodeModel
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
  const { node, sessionId, shell, workspacePath, scale, selected, onSelect, onMoveStart, onResizeStart, onClose } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isReady, setIsReady] = useState(false)
  const exitCode = useTerminalExit(sessionId)

  const sessionLabel = useMemo(() => workspacePath ?? 'Home shell', [workspacePath])
  const shellLabel = useMemo(() => getShellLabel(shell), [shell])

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

    void window.tcan.resizeTerminal(sessionId, terminal.cols, terminal.rows)

    const outputCleanup = subscribeToTerminalOutput(sessionId, (data) => {
      terminal.write(data)
    })

    const dataDisposable = terminal.onData((data) => {
      void window.tcan.writeTerminal(sessionId, data)
    })

    return () => {
      outputCleanup()
      dataDisposable.dispose()
      fitAddonRef.current = null
      terminalRef.current = null
      setIsReady(false)
      terminal.dispose()
    }
  }, [sessionId])

  useLayoutEffect(() => {
    if (!sessionId || !fitAddonRef.current || !terminalRef.current) {
      return
    }

    fitAddonRef.current.fit()
    const terminal = terminalRef.current
    void window.tcan.resizeTerminal(sessionId, terminal.cols, terminal.rows)
  }, [node.width, node.height, scale, sessionId])

  return (
    <article
      className={selected ? 'terminal-node terminal-node--selected' : 'terminal-node'}
      onPointerDownCapture={onSelect}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.width,
        height: node.height,
      }}
    >
      <header className="terminal-node__header" onPointerDown={onMoveStart}>
        <div className="terminal-node__lights" aria-hidden="true">
          <span className="terminal-node__light terminal-node__light--red" />
          <span className="terminal-node__light terminal-node__light--amber" />
          <span className="terminal-node__light terminal-node__light--green" />
        </div>
        <div className="terminal-node__titleblock">
          <strong>{node.title.toUpperCase()}</strong>
          <span>{shellLabel ? `${sessionLabel} • ${shellLabel}` : sessionLabel}</span>
        </div>
        <button
          aria-label={`Close ${node.title}`}
          className="icon-button"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
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
        onPointerDown={onResizeStart}
        type="button"
      />
    </article>
  )
}
