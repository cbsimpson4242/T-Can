import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react'
import type { WorkspaceFileEntry } from '../../shared/types'

interface FileExplorerProps {
  entries: WorkspaceFileEntry[]
  loading: boolean
  remote?: boolean
  workspaceName: string | null
  onOpenFile(relativePath: string): void
  onRefresh(): void
  onCreatePath(parentPath: string, type: 'file' | 'directory'): void
  onRenamePath(relativePath: string): void
  onDeletePath(relativePath: string): void
  onDuplicatePath(relativePath: string): void
  onCopyPath(relativePath: string): void
  onRevealPath(relativePath: string): void
}

function getFileIcon(name: string): { className: string; label: string } {
  const lowerName = name.toLowerCase()
  const extension = lowerName.split('.').pop() ?? ''

  if (lowerName === 'package.json' || lowerName === 'package-lock.json') {
    return { className: 'file-explorer__file-icon--npm', label: 'JS' }
  }

  if (lowerName === 'readme.md' || extension === 'md') {
    return { className: 'file-explorer__file-icon--markdown', label: 'MD' }
  }

  switch (extension) {
    case 'ts':
    case 'tsx':
      return { className: 'file-explorer__file-icon--typescript', label: 'TS' }
    case 'js':
    case 'jsx':
    case 'cjs':
    case 'mjs':
      return { className: 'file-explorer__file-icon--javascript', label: 'JS' }
    case 'json':
      return { className: 'file-explorer__file-icon--json', label: '{}' }
    case 'css':
      return { className: 'file-explorer__file-icon--css', label: '#' }
    case 'html':
      return { className: 'file-explorer__file-icon--html', label: '<>' }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return { className: 'file-explorer__file-icon--image', label: '◧' }
    default:
      return { className: 'file-explorer__file-icon--default', label: '·' }
  }
}

function findEntry(entries: WorkspaceFileEntry[], relativePath: string): WorkspaceFileEntry | null {
  for (const entry of entries) {
    if (entry.relativePath === relativePath) {
      return entry
    }
    const childEntry = entry.children ? findEntry(entry.children, relativePath) : null
    if (childEntry) {
      return childEntry
    }
  }
  return null
}

function FileEntryView(props: {
  entry: WorkspaceFileEntry
  depth: number
  expandedPaths: Set<string>
  selectedPath: string | null
  onOpenFile(relativePath: string): void
  onToggleDirectory(relativePath: string): void
  onSelectPath(relativePath: string): void
}) {
  const { entry, depth, expandedPaths, selectedPath, onOpenFile, onToggleDirectory, onSelectPath } = props
  const isDirectory = entry.type === 'directory'
  const isExpanded = isDirectory && expandedPaths.has(entry.relativePath)
  const fileIcon = isDirectory ? null : getFileIcon(entry.name)
  const className = [
    'file-explorer__entry',
    isDirectory ? 'file-explorer__entry--directory' : null,
    selectedPath === entry.relativePath ? 'file-explorer__entry--selected' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li className="file-explorer__item">
      <button
        className={className}
        onClick={() => {
          onSelectPath(entry.relativePath)
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
        <span className="file-explorer__chevron" aria-hidden="true">{isDirectory ? (isExpanded ? '⌄' : '›') : ''}</span>
        <span className={isDirectory ? 'file-explorer__folder-icon' : `file-explorer__file-icon ${fileIcon?.className ?? ''}`} aria-hidden="true">
          {isDirectory ? '' : fileIcon?.label}
        </span>
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
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
              onSelectPath={onSelectPath}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function FileExplorer(props: FileExplorerProps) {
  const {
    entries,
    loading,
    remote = false,
    workspaceName,
    onOpenFile,
    onRefresh,
    onCreatePath,
    onRenamePath,
    onDeletePath,
    onDuplicatePath,
    onCopyPath,
    onRevealPath,
  } = props
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [rootExpanded, setRootExpanded] = useState(true)
  const displayWorkspaceName = useMemo(() => workspaceName?.split(/[\\/]/).filter(Boolean).pop() ?? workspaceName, [workspaceName])

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

  function handleOpenFile(relativePath: string) {
    setSelectedPath(relativePath)
    onOpenFile(relativePath)
  }

  function getParentForCreate(): string {
    if (!selectedPath) {
      return ''
    }
    const entry = findEntry(entries, selectedPath)
    if (entry?.type === 'directory') {
      return selectedPath
    }
    return selectedPath.split('/').slice(0, -1).join('/')
  }

  function canMutateSelectedPath(): boolean {
    return Boolean(workspaceName && !loading && !remote && selectedPath)
  }

  function collapseAll() {
    setExpandedPaths(new Set())
    setRootExpanded(true)
  }

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
        <span className="file-explorer__eyebrow">EXPLORER</span>
        <div className="file-explorer__actions" aria-label="Explorer actions">
          <button className="file-explorer__action" disabled={!workspaceName || loading || remote} onClick={() => onCreatePath(getParentForCreate(), 'file')} title="New file" type="button">＋</button>
          <button className="file-explorer__action" disabled={!workspaceName || loading || remote} onClick={() => onCreatePath(getParentForCreate(), 'directory')} title="New folder" type="button">▣</button>
          <button className="file-explorer__action" disabled={!canMutateSelectedPath()} onClick={() => selectedPath && onRenamePath(selectedPath)} title="Rename selected" type="button">✎</button>
          <button className="file-explorer__action" disabled={!canMutateSelectedPath()} onClick={() => selectedPath && onDeletePath(selectedPath)} title="Delete selected" type="button">⌫</button>
          <button className="file-explorer__action" disabled={!canMutateSelectedPath()} onClick={() => selectedPath && onDuplicatePath(selectedPath)} title="Duplicate selected" type="button">⧉</button>
          <button className="file-explorer__action" disabled={!canMutateSelectedPath()} onClick={() => selectedPath && onCopyPath(selectedPath)} title="Copy full path" type="button">⎘</button>
          <button className="file-explorer__action" disabled={!canMutateSelectedPath()} onClick={() => selectedPath && onRevealPath(selectedPath)} title="Reveal in system explorer" type="button">↗</button>
          <button className="file-explorer__action" disabled={!workspaceName || loading || remote} onClick={onRefresh} title="Refresh explorer" type="button">↻</button>
          <button className="file-explorer__action" disabled={!workspaceName || loading || remote} onClick={collapseAll} title="Collapse folders" type="button">⇤</button>
        </div>
      </header>
      <div className="file-explorer__body" onWheel={stopExplorerWheelPropagation} ref={bodyRef}>
        {loading && <p className="file-explorer__empty">Loading files...</p>}
        {!loading && !workspaceName && <p className="file-explorer__empty">Open a workspace to browse files.</p>}
        {!loading && workspaceName && remote && <p className="file-explorer__empty">Remote SSH file browsing is not available yet.</p>}
        {!loading && workspaceName && !remote && entries.length === 0 && <p className="file-explorer__empty">No files found.</p>}
        {!loading && !remote && entries.length > 0 && workspaceName && (
          <section className="file-explorer__section">
            <button className="file-explorer__workspace-row" onClick={() => setRootExpanded((current) => !current)} type="button">
              <span className="file-explorer__chevron" aria-hidden="true">{rootExpanded ? '⌄' : '›'}</span>
              <strong>{displayWorkspaceName?.toUpperCase()}</strong>
            </button>
            {rootExpanded && (
              <ul className="file-explorer__list file-explorer__list--root">
                {entries.map((entry) => (
                  <FileEntryView
                    entry={entry}
                    expandedPaths={expandedPaths}
                    key={entry.relativePath}
                    depth={0}
                    selectedPath={selectedPath}
                    onOpenFile={handleOpenFile}
                    onToggleDirectory={toggleDirectory}
                    onSelectPath={setSelectedPath}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
