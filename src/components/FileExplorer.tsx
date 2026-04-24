import type { CSSProperties } from 'react'
import type { WorkspaceFileEntry } from '../../shared/types'

interface FileExplorerProps {
  entries: WorkspaceFileEntry[]
  loading: boolean
  workspaceName: string | null
  onOpenFile(relativePath: string): void
  onRefresh(): void
}

function FileEntryView(props: { entry: WorkspaceFileEntry; depth: number; onOpenFile(relativePath: string): void }) {
  const { entry, depth, onOpenFile } = props
  const isDirectory = entry.type === 'directory'

  return (
    <li className="file-explorer__item">
      <button
        className={isDirectory ? 'file-explorer__entry file-explorer__entry--directory' : 'file-explorer__entry'}
        onClick={() => {
          if (!isDirectory) {
            onOpenFile(entry.relativePath)
          }
        }}
        style={{ '--depth': depth } as CSSProperties}
        title={entry.relativePath}
        type="button"
      >
        <span className="file-explorer__icon">{isDirectory ? '▸' : '•'}</span>
        <span className="file-explorer__name">{entry.name}</span>
      </button>
      {isDirectory && entry.children && entry.children.length > 0 && (
        <ul className="file-explorer__list">
          {entry.children.map((child) => (
            <FileEntryView entry={child} key={child.relativePath} depth={depth + 1} onOpenFile={onOpenFile} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function FileExplorer(props: FileExplorerProps) {
  const { entries, loading, workspaceName, onOpenFile, onRefresh } = props

  return (
    <aside className="file-explorer" aria-label="Workspace files">
      <header className="file-explorer__header">
        <div>
          <span className="file-explorer__eyebrow">EXPLORER</span>
          <strong>{workspaceName ?? 'NO WORKSPACE'}</strong>
        </div>
        <button className="file-explorer__refresh" disabled={!workspaceName || loading} onClick={onRefresh} type="button">
          ↻
        </button>
      </header>
      <div className="file-explorer__body">
        {loading && <p className="file-explorer__empty">Loading files...</p>}
        {!loading && !workspaceName && <p className="file-explorer__empty">Open a workspace to browse files.</p>}
        {!loading && workspaceName && entries.length === 0 && <p className="file-explorer__empty">No files found.</p>}
        {!loading && entries.length > 0 && (
          <ul className="file-explorer__list file-explorer__list--root">
            {entries.map((entry) => (
              <FileEntryView entry={entry} key={entry.relativePath} depth={0} onOpenFile={onOpenFile} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
