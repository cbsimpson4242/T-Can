import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import Editor from '@monaco-editor/react'
import type { EditorNode as EditorNodeModel } from '../../shared/types'

interface ProjectedNodeRect {
  left: number
  top: number
  width: number
  height: number
}

interface EditorNodeProps {
  node: EditorNodeModel
  canvasRect: ProjectedNodeRect
  workspaceId: string
  scale: number
  selected: boolean
  onSelect(event: ReactPointerEvent<HTMLElement>): void
  onMoveStart(event: ReactPointerEvent<HTMLElement>): void
  onResizeStart(event: ReactPointerEvent<HTMLButtonElement>): void
  onClose(): void
}

function guessLanguage(filePath: string): string | undefined {
  const extension = filePath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    default:
      return undefined
  }
}

export function EditorNode(props: EditorNodeProps) {
  const { node, canvasRect, workspaceId, scale, selected, onSelect, onMoveStart, onResizeStart, onClose } = props
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const language = useMemo(() => node.language ?? guessLanguage(node.filePath), [node.filePath, node.language])
  const isDirty = content !== savedContent

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setIsLoading(true)
      setError(null)

      void window.tcan.readWorkspaceFile(workspaceId, node.filePath).then(
        (result) => {
          if (cancelled) {
            return
          }
          setContent(result.content)
          setSavedContent(result.content)
        },
        (readError) => {
          if (!cancelled) {
            setError(readError instanceof Error ? readError.message : String(readError))
          }
        },
      ).finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })
    })

    return () => {
      cancelled = true
    }
  }, [node.filePath, workspaceId])

  async function saveFile() {
    setIsSaving(true)
    setError(null)
    try {
      const result = await window.tcan.saveWorkspaceFile(workspaceId, node.filePath, content)
      setSavedContent(result.content)
      setContent(result.content)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const className = ['editor-node', selected ? 'editor-node--selected' : null].filter(Boolean).join(' ')
  const style = {
    transform: `translate(${canvasRect.left}px, ${canvasRect.top}px)`,
    width: canvasRect.width,
    height: canvasRect.height,
    '--node-scale': `${scale}`,
  } as CSSProperties

  return (
    <article className={className} onPointerDownCapture={onSelect} style={style}>
      <header className="editor-node__header" onPointerDown={onMoveStart}>
        <div className="editor-node__titleblock">
          <strong>{node.title.toUpperCase()}{isDirty ? ' *' : ''}</strong>
          <span>{node.filePath}</span>
        </div>
        <button className="icon-button" disabled={!isDirty || isSaving || isLoading} onClick={() => void saveFile()} onPointerDown={(event) => event.stopPropagation()} type="button">
          {isSaving ? '...' : 'SAVE'}
        </button>
        <button aria-label={`Close ${node.title}`} className="icon-button" onClick={onClose} onPointerDown={(event) => event.stopPropagation()} type="button">
          x
        </button>
      </header>
      <div className="editor-node__body">
        {error && <div className="editor-node__overlay">{error}</div>}
        {isLoading && <div className="editor-node__overlay">Loading file...</div>}
        <Editor
          height="100%"
          language={language}
          onChange={(value) => setContent(value ?? '')}
          options={{
            fontFamily: 'Cascadia Mono, Consolas, SFMono-Regular, Menlo, monospace',
            fontSize: Math.max(10, 13 * scale),
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
          }}
          path={node.filePath}
          theme="vs-dark"
          value={content}
        />
      </div>
      <button aria-label={`Resize ${node.title}`} className="editor-node__resize-handle" onPointerDown={onResizeStart} type="button" />
    </article>
  )
}
