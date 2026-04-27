import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { extractFileSymbols, guessLanguageFromPath } from '../../shared/languageIntelligence'
import type { EditorNode as EditorNodeModel, EditorTab, NodeResizeDirection, WorkspaceSymbol } from '../../shared/types'

const RESIZE_DIRECTIONS: NodeResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const AUTOSAVE_DELAY_MS = 900
// Monaco language defaults are global for the whole renderer process, so configure them once.
let hasConfiguredMonacoLanguageIntelligence = false

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
  autoSave: boolean
  saveSignal: number
  saveAllSignal: number
  externalRefreshSignal: number
  onSelect(event: ReactPointerEvent<HTMLElement>): void
  onMoveStart(event: ReactPointerEvent<HTMLElement>): void
  onResizeStart(event: ReactPointerEvent<HTMLButtonElement>, direction: NodeResizeDirection): void
  onClose(): void
  onDirtyChange(nodeId: string, dirtyPaths: string[]): void
  onTabsChange(nodeId: string, tabs: EditorTab[], activeFilePath: string): void
  onSplit(filePath: string): void
}

function configureMonacoLanguageIntelligence(monaco: Parameters<BeforeMount>[0]) {
  if (hasConfiguredMonacoLanguageIntelligence) {
    return
  }

  const compilerOptions = {
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: true,
    allowNonTsExtensions: true,
    noEmit: true,
    strict: true,
  }

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false })
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false })
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(false)
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(false)
  hasConfiguredMonacoLanguageIntelligence = true
}

function getTitle(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

function normalizeTabs(node: EditorNodeModel): EditorTab[] {
  const legacyTab = { filePath: node.filePath, title: node.title || getTitle(node.filePath), language: node.language }
  const tabs = node.tabs && node.tabs.length > 0 ? node.tabs : [legacyTab]
  return tabs.map((tab) => ({ ...tab, title: tab.title || getTitle(tab.filePath) }))
}

function arePathListsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

export function EditorNode(props: EditorNodeProps) {
  const {
    node,
    canvasRect,
    workspaceId,
    scale,
    selected,
    autoSave,
    saveSignal,
    saveAllSignal,
    externalRefreshSignal,
    onSelect,
    onMoveStart,
    onResizeStart,
    onClose,
    onDirtyChange,
    onTabsChange,
    onSplit,
  } = props
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const gitDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const lastReportedDirtyStateRef = useRef<{ nodeId: string; dirtyPaths: readonly string[] } | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [savedContents, setSavedContents] = useState<Record<string, string>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set())
  const [savingPaths, setSavingPaths] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [showMinimap, setShowMinimap] = useState(true)
  const [wordWrap, setWordWrap] = useState(true)
  const [showOutline, setShowOutline] = useState(false)
  const [markerCounts, setMarkerCounts] = useState({ errors: 0, warnings: 0 })
  const [isEditorReady, setIsEditorReady] = useState(false)
  const tabs = useMemo(
    () => normalizeTabs(node),
    [node.filePath, node.language, node.tabs, node.title],
  )
  const tabByPath = useMemo(() => new Map(tabs.map((tab) => [tab.filePath, tab])), [tabs])
  const activeFilePath = node.activeFilePath && tabByPath.has(node.activeFilePath)
    ? node.activeFilePath
    : tabs[0]?.filePath ?? node.filePath
  const activeTab = tabByPath.get(activeFilePath) ?? tabs[0]
  const content = contents[activeFilePath] ?? ''
  const activeSavedContent = savedContents[activeFilePath] ?? ''
  const dirtyPaths = useMemo(
    () => tabs.map((tab) => tab.filePath).filter((filePath) => (contents[filePath] ?? '') !== (savedContents[filePath] ?? '')),
    [contents, savedContents, tabs],
  )
  const dirtyPathSet = useMemo(() => new Set(dirtyPaths), [dirtyPaths])
  const isDirty = dirtyPathSet.has(activeFilePath)
  const isLoading = loadingPaths.has(activeFilePath)
  const isSaving = savingPaths.has(activeFilePath)
  const language = activeTab?.language ?? guessLanguageFromPath(activeFilePath)
  const activeSymbols = useMemo(() => extractFileSymbols(activeFilePath, content), [activeFilePath, content])
  const editorOptions = useMemo(() => ({
    automaticLayout: true,
    fontFamily: 'Cascadia Mono, Consolas, SFMono-Regular, Menlo, monospace',
    fontSize: Math.max(10, 13 * scale),
    glyphMargin: true,
    lineNumbers: 'on' as const,
    minimap: {
      enabled: showMinimap,
      side: 'right' as const,
      showSlider: 'always' as const,
      renderCharacters: true,
      maxColumn: 120,
      scale: 1,
    },
    overviewRulerLanes: 3,
    renderLineHighlight: 'all' as const,
    rulers: [100, 120],
    scrollbar: {
      horizontal: 'visible' as const,
      vertical: 'visible' as const,
      useShadows: true,
      horizontalScrollbarSize: 12,
      verticalScrollbarSize: 12,
    },
    scrollBeyondLastLine: false,
    stickyScroll: { enabled: true },
    wordWrap: wordWrap ? 'on' as const : 'off' as const,
  }), [scale, showMinimap, wordWrap])

  useEffect(() => {
    const lastReportedDirtyState = lastReportedDirtyStateRef.current
    if (lastReportedDirtyState?.nodeId === node.id && arePathListsEqual(lastReportedDirtyState.dirtyPaths, dirtyPaths)) {
      return
    }
    lastReportedDirtyStateRef.current = { nodeId: node.id, dirtyPaths }
    onDirtyChange(node.id, dirtyPaths)
  }, [dirtyPaths, node.id, onDirtyChange])

  useEffect(() => {
    let cancelled = false
    if (!isEditorReady || !editorRef.current || !activeFilePath || !window.tcan?.getGitFileDiff) {
      return
    }

    void window.tcan.getGitFileDiff(workspaceId, activeFilePath).then((diff) => {
      if (cancelled || !editorRef.current) {
        return
      }
      const monacoEditor = editorRef.current
      const decorations = diff.lines.flatMap((line) => {
        if (line.type === 'add' && line.newLine) {
          return [{ range: { startLineNumber: line.newLine, startColumn: 1, endLineNumber: line.newLine, endColumn: 1 }, options: { isWholeLine: true, className: 'monaco-git-line--added', glyphMarginClassName: 'monaco-git-glyph--added' } }]
        }
        if (line.type === 'delete' && line.oldLine) {
          const targetLine = Math.max(1, line.newLine ?? line.oldLine)
          return [{ range: { startLineNumber: targetLine, startColumn: 1, endLineNumber: targetLine, endColumn: 1 }, options: { isWholeLine: true, className: 'monaco-git-line--deleted', glyphMarginClassName: 'monaco-git-glyph--deleted' } }]
        }
        return []
      })
      gitDecorationsRef.current?.clear()
      gitDecorationsRef.current = monacoEditor.createDecorationsCollection(decorations)
    }).catch(() => {
      gitDecorationsRef.current?.clear()
    })

    return () => {
      cancelled = true
    }
  }, [activeFilePath, activeSavedContent, isEditorReady, workspaceId])

  useEffect(() => {
    let cancelled = false
    const missingPaths = tabs.map((tab) => tab.filePath).filter((filePath) => contents[filePath] === undefined && !loadingPaths.has(filePath))
    if (missingPaths.length === 0) {
      return () => {
        cancelled = true
      }
    }

    setLoadingPaths((current) => new Set([...current, ...missingPaths]))
    setError(null)

    missingPaths.forEach((filePath) => {
      void window.tcan.readWorkspaceFile(workspaceId, filePath).then(
        (result) => {
          if (cancelled) {
            return
          }
          setContents((current) => ({ ...current, [filePath]: result.content }))
          setSavedContents((current) => ({ ...current, [filePath]: result.content }))
        },
        (readError) => {
          if (!cancelled) {
            setError(readError instanceof Error ? readError.message : String(readError))
          }
        },
      ).finally(() => {
        if (!cancelled) {
          setLoadingPaths((current) => {
            const next = new Set(current)
            next.delete(filePath)
            return next
          })
        }
      })
    })

    return () => {
      cancelled = true
    }
  }, [contents, loadingPaths, tabs, workspaceId])

  useEffect(() => {
    if (externalRefreshSignal === 0) {
      return
    }

    let cancelled = false
    const pathsToReload = tabs
      .map((tab) => tab.filePath)
      .filter((filePath) => contents[filePath] !== undefined && contents[filePath] === savedContents[filePath] && !loadingPaths.has(filePath) && !savingPaths.has(filePath))

    if (pathsToReload.length === 0) {
      return () => {
        cancelled = true
      }
    }

    setLoadingPaths((current) => new Set([...current, ...pathsToReload]))
    pathsToReload.forEach((filePath) => {
      void window.tcan.readWorkspaceFile(workspaceId, filePath).then(
        (result) => {
          if (cancelled) {
            return
          }
          setContents((current) => ({ ...current, [filePath]: result.content }))
          setSavedContents((current) => ({ ...current, [filePath]: result.content }))
        },
        (readError) => {
          if (!cancelled) {
            setError(readError instanceof Error ? readError.message : String(readError))
          }
        },
      ).finally(() => {
        if (!cancelled) {
          setLoadingPaths((current) => {
            const next = new Set(current)
            next.delete(filePath)
            return next
          })
        }
      })
    })

    return () => {
      cancelled = true
    }
    // Reloads only clean open tabs; dirty tabs are never overwritten by file-system events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRefreshSignal])

  async function saveFile(filePath: string): Promise<void> {
    if (loadingPaths.has(filePath)) {
      return
    }

    const nextContent = contents[filePath]
    if (nextContent === undefined || nextContent === savedContents[filePath]) {
      return
    }

    setSavingPaths((current) => new Set(current).add(filePath))
    setError(null)
    try {
      const result = await window.tcan.saveWorkspaceFile(workspaceId, filePath, nextContent)
      setSavedContents((current) => ({ ...current, [filePath]: result.content }))
      setContents((current) => ({ ...current, [filePath]: result.content }))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSavingPaths((current) => {
        const next = new Set(current)
        next.delete(filePath)
        return next
      })
    }
  }

  async function saveAllFiles(): Promise<void> {
    await Promise.all(dirtyPaths.map((filePath) => saveFile(filePath)))
  }

  useEffect(() => {
    if (saveSignal > 0 && selected) {
      void saveFile(activeFilePath)
    }
    // saveFile reads current editor state intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSignal])

  useEffect(() => {
    if (saveAllSignal > 0) {
      void saveAllFiles()
    }
    // saveAllFiles reads current editor state intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAllSignal])

  useEffect(() => {
    if (!autoSave || dirtyPaths.length === 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void saveAllFiles()
    }, AUTOSAVE_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
    // saveAllFiles reads current editor state intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, contents, dirtyPaths])

  function updateTabs(nextTabs: EditorTab[], nextActiveFilePath = activeFilePath) {
    onTabsChange(node.id, nextTabs, nextActiveFilePath)
  }

  function closeTab(filePath: string) {
    if (dirtyPathSet.has(filePath) && !window.confirm(`Close ${filePath} without saving changes?`)) {
      return
    }

    const nextTabs = tabs.filter((tab) => tab.filePath !== filePath)
    if (nextTabs.length === 0) {
      onDirtyChange(node.id, [])
      onClose()
      return
    }

    const nextActiveFilePath = filePath === activeFilePath ? nextTabs[Math.max(0, tabs.findIndex((tab) => tab.filePath === filePath) - 1)].filePath : activeFilePath
    updateTabs(nextTabs, nextActiveFilePath)
    setContents((current) => {
      const next = { ...current }
      delete next[filePath]
      return next
    })
    setSavedContents((current) => {
      const next = { ...current }
      delete next[filePath]
      return next
    })
  }

  function closeNode() {
    onClose()
  }

  function moveTab(filePath: string, direction: -1 | 1) {
    const index = tabs.findIndex((tab) => tab.filePath === filePath)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= tabs.length) {
      return
    }
    const nextTabs = [...tabs]
    const [tab] = nextTabs.splice(index, 1)
    nextTabs.splice(nextIndex, 0, tab)
    updateTabs(nextTabs, activeFilePath)
  }

  function togglePinned(filePath: string) {
    updateTabs(tabs.map((tab) => (tab.filePath === filePath ? { ...tab, pinned: !tab.pinned } : tab)), activeFilePath)
  }

  function runEditorAction(actionId: string) {
    void editorRef.current?.getAction(actionId)?.run()
  }

  function jumpToSymbol(symbol: WorkspaceSymbol) {
    editorRef.current?.setPosition({ lineNumber: symbol.line, column: symbol.column })
    editorRef.current?.revealLineInCenter(symbol.line)
    editorRef.current?.focus()
  }

  const handleEditorBeforeMount: BeforeMount = (monaco) => {
    configureMonacoLanguageIntelligence(monaco)
  }

  const handleEditorMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance
    setIsEditorReady(true)
  }

  const className = ['editor-node', selected ? 'editor-node--selected' : null].filter(Boolean).join(' ')
  const style = {
    transform: `translate(${canvasRect.left}px, ${canvasRect.top}px)`,
    width: canvasRect.width,
    height: canvasRect.height,
    '--node-scale': `${scale}`,
  } as CSSProperties
  const breadcrumbs = activeFilePath.split(/[\\/]/).filter(Boolean)

  return (
    <article className={className} onPointerDownCapture={onSelect} style={style}>
      <header className="editor-node__header" onPointerDown={onMoveStart}>
        <div className="editor-node__lights" aria-hidden="true">
          <span className="editor-node__light editor-node__light--red" />
          <span className="editor-node__light editor-node__light--amber" />
          <span className="editor-node__light editor-node__light--green" />
        </div>
        <div className="editor-node__titleblock">
          <strong>{getTitle(activeFilePath).toUpperCase()}{isDirty ? ' *' : ''}</strong>
          <span>{activeFilePath}</span>
        </div>
        <button className="icon-button" disabled={!isDirty || isSaving || isLoading} onClick={() => void saveFile(activeFilePath)} onPointerDown={(event) => event.stopPropagation()} type="button">
          {isSaving ? '...' : 'SAVE'}
        </button>
        <button aria-label={`Close ${node.title}`} className="icon-button" onClick={closeNode} onPointerDown={(event) => event.stopPropagation()} type="button">
          x
        </button>
      </header>
      <div className="editor-node__tabs" onPointerDown={(event) => event.stopPropagation()}>
        {tabs.map((tab, index) => {
          const tabDirty = dirtyPathSet.has(tab.filePath)
          return (
            <div className={tab.filePath === activeFilePath ? 'editor-node__tab editor-node__tab--active' : 'editor-node__tab'} key={tab.filePath} title={tab.filePath}>
              <button className="editor-node__tab-main" onClick={() => updateTabs(tabs, tab.filePath)} type="button">
                <span>{tab.pinned ? '● ' : ''}{tab.title}{tabDirty ? ' *' : ''}</span>
              </button>
              <button className="editor-node__tab-action" disabled={index === 0} onClick={() => moveTab(tab.filePath, -1)} title="Move tab left" type="button">‹</button>
              <button className="editor-node__tab-action" disabled={index === tabs.length - 1} onClick={() => moveTab(tab.filePath, 1)} title="Move tab right" type="button">›</button>
              <button className="editor-node__tab-action" onClick={() => togglePinned(tab.filePath)} title="Pin/unpin tab" type="button">⌖</button>
              <button className="editor-node__tab-action" onClick={() => onSplit(tab.filePath)} title="Split tab to new editor" type="button">⇱</button>
              <button className="editor-node__tab-action" disabled={tab.pinned} onClick={() => closeTab(tab.filePath)} title="Close tab" type="button">×</button>
            </div>
          )
        })}
      </div>
      <div className="editor-node__toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <span className="editor-node__breadcrumbs">{breadcrumbs.map((crumb, index) => <span key={`${crumb}-${index}`}>{crumb}</span>)}</span>
        <button type="button" onClick={() => runEditorAction('actions.find')}>Find</button>
        <button type="button" onClick={() => runEditorAction('editor.action.startFindReplaceAction')}>Replace</button>
        <button type="button" onClick={() => runEditorAction('editor.action.gotoLine')}>Line</button>
        <button type="button" onClick={() => runEditorAction('editor.action.formatDocument')}>Format</button>
        <button type="button" onClick={() => runEditorAction('editor.action.triggerSuggest')}>Suggest</button>
        <button type="button" onClick={() => runEditorAction('editor.action.showHover')}>Hover</button>
        <button type="button" onClick={() => runEditorAction('editor.action.revealDefinition')}>Definition</button>
        <button type="button" onClick={() => runEditorAction('editor.action.goToReferences')}>Refs</button>
        <button type="button" onClick={() => runEditorAction('editor.action.rename')}>Rename</button>
        <button type="button" onClick={() => runEditorAction('editor.action.quickFix')}>Fix</button>
        <button type="button" onClick={() => runEditorAction('editor.action.marker.next')}>Problems {markerCounts.errors}/{markerCounts.warnings}</button>
        <button type="button" onClick={() => setShowOutline((current) => !current)}>Outline {activeSymbols.length}</button>
        <button type="button" onClick={() => setWordWrap((current) => !current)}>Wrap {wordWrap ? 'On' : 'Off'}</button>
        <button type="button" onClick={() => setShowMinimap((current) => !current)}>Map {showMinimap ? 'On' : 'Off'}</button>
      </div>
      <div className="editor-node__body">
        {showOutline && (
          <aside className="editor-node__outline" onPointerDown={(event) => event.stopPropagation()}>
            <header>OUTLINE</header>
            {activeSymbols.length === 0 ? (
              <p>No symbols detected.</p>
            ) : activeSymbols.map((symbol) => (
              <button key={`${symbol.kind}-${symbol.name}-${symbol.line}-${symbol.column}`} onClick={() => jumpToSymbol(symbol)} type="button">
                <strong>{symbol.name}</strong>
                <span>{symbol.kind} · {symbol.line}:{symbol.column}</span>
              </button>
            ))}
          </aside>
        )}
        {error && <div className="editor-node__overlay">{error}</div>}
        {isLoading && <div className="editor-node__overlay">Loading file...</div>}
        <Editor
          beforeMount={handleEditorBeforeMount}
          height="100%"
          language={language}
          onChange={(value) => setContents((current) => ({ ...current, [activeFilePath]: value ?? '' }))}
          onMount={handleEditorMount}
          onValidate={(markers) => {
            let errors = 0
            let warnings = 0
            for (const marker of markers) {
              if (marker.severity >= 8) {
                errors += 1
              } else if (marker.severity === 4) {
                warnings += 1
              }
            }
            setMarkerCounts((current) => (
              current.errors === errors && current.warnings === warnings
                ? current
                : { errors, warnings }
            ))
          }}
          options={editorOptions}
          path={activeFilePath}
          theme="vs-dark"
          value={content}
        />
      </div>
      {RESIZE_DIRECTIONS.map((direction) => (
        <button
          aria-label={`Resize ${node.title} from ${direction}`}
          className={`editor-node__resize-handle editor-node__resize-handle--${direction}`}
          key={direction}
          onPointerDown={(event) => onResizeStart(event, direction)}
          type="button"
        />
      ))}
    </article>
  )
}
