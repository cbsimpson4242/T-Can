import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react'
import type { WorkspaceFileEntry } from '../../shared/types'

interface FileExplorerProps {
  entries: WorkspaceFileEntry[]
  loading: boolean
  workspaceName: string | null
  onOpenFile(relativePath: string): void
  onRefresh(): void
}

function FileEntryView(props: {
  entry: WorkspaceFileEntry
  depth: number
  expandedPaths: Set<string>
  onOpenFile(relativePath: string): void
  onToggleDirectory(relativePath: string): void
}) {
  const { entry, depth, expandedPaths, onOpenFile, onToggleDirectory } = props
  const isDirectory = entry.type === 'directory'
  const isExpanded = isDirectory && expandedPaths.has(entry.relativePath)

  return (
    <li className="file-explorer__item">
      <button
        className={isDirectory ? 'file-explorer__entry file-explorer__entry--directory' : 'file-explorer__entry'}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(entry.relativePath)
          } else {
            onOpenFile(entry.relativePath)
          }
        }}
        style={{ '--depth': depth } as CSSProperties}
        title={entry.relativePath}
        type="button"
      >
        <span className="file-explorer__icon">{isDirectory ? (isExpanded ? '▾' : '▸') : '•'}</span>
        <span className="file-explorer__name">{entry.name}</span>
      </button>
      {isExpanded && entry.children && entry.children.length > 0 && (
        <ul className="file-explorer__list">
          {entry.children.map((child) => (
            <FileEntryView
              entry={child}
              expandedPaths={expandedPaths}
              key={child.relativePath}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function FileExplorer(props: FileExplorerProps) {
  const { entries, loading, workspaceName, onOpenFile, onRefresh } = props
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const body = bodyRef.current
    if (!body) {
      return
    }

    const stopNativeWheelPropagation = (event: globalThis.WheelEvent) => {
      event.stopPropagation()
    }

    body.addEventListener('wheel', stopNativeWheelPropagation, { passive: false, capture: true })
    return () => body.removeEventListener('wheel', stopNativeWheelPropagation, { capture: true })
  }, [])

  function toggleDirectory(relativePath: string) {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(relativePath)) {
        next.delete(relativePath)
      } else {
        next.add(relativePath)
      }
      return next
    })
  }

  function stopExplorerWheelPropagation(event: WheelEvent<HTMLElement>) {
    event.stopPropagation()
  }

  function stopExplorerPointerPropagation(event: PointerEvent<HTMLElement>) {
    event.stopPropagation()
  }

  return (
    <aside
      className="file-explorer"
      aria-label="Workspace files"
      onPointerDown={stopExplorerPointerPropagation}
      onPointerMove={stopExplorerPointerPropagation}
      onPointerUp={stopExplorerPointerPropagation}
      onWheel={stopExplorerWheelPropagation}
    >
      <header className="file-explorer__header">
        <div>
          <span className="file-explorer__eyebrow">EXPLORER</span>
          <strong>{workspaceName ?? 'NO WORKSPACE'}</strong>
        </div>
        <button className="file-explorer__refresh" disabled={!workspaceName || loading} onClick={onRefresh} type="button">
          ↻
        </button>
      </header>
      <div className="file-explorer__body" onWheel={stopExplorerWheelPropagation} ref={bodyRef}>
        {loading && <p className="file-explorer__empty">Loading files...</p>}
        {!loading && !workspaceName && <p className="file-explorer__empty">Open a workspace to browse files.</p>}
        {!loading && workspaceName && entries.length === 0 && <p className="file-explorer__empty">No files found.</p>}
        {!loading && entries.length > 0 && (
          <ul className="file-explorer__list file-explorer__list--root">
            {entries.map((entry) => (
              <FileEntryView
                entry={entry}
                expandedPaths={expandedPaths}
                key={entry.relativePath}
                depth={0}
                onOpenFile={onOpenFile}
                onToggleDirectory={toggleDirectory}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
