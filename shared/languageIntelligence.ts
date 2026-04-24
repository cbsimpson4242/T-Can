import type { WorkspaceSymbol } from './types'

export function guessLanguageFromPath(filePath: string): string | undefined {
  const extension = filePath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    case 'py':
      return 'python'
    case 'rs':
      return 'rust'
    case 'go':
      return 'go'
    default:
      return undefined
  }
}

interface SymbolPattern {
  kind: WorkspaceSymbol['kind']
  pattern: RegExp
}

const LANGUAGE_SYMBOL_PATTERNS: Record<string, SymbolPattern[]> = {
  typescript: [
    { kind: 'class', pattern: /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'interface', pattern: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'type', pattern: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'enum', pattern: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'function', pattern: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'method', pattern: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/gm },
    { kind: 'variable', pattern: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g },
  ],
  javascript: [
    { kind: 'class', pattern: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'function', pattern: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'method', pattern: /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{]/gm },
    { kind: 'variable', pattern: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g },
  ],
  python: [
    { kind: 'class', pattern: /^\s*class\s+([A-Za-z_][\w]*)/gm },
    { kind: 'function', pattern: /^\s*def\s+([A-Za-z_][\w]*)/gm },
  ],
  rust: [
    { kind: 'function', pattern: /(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/g },
    { kind: 'struct', pattern: /(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/g },
    { kind: 'enum', pattern: /(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/g },
    { kind: 'trait', pattern: /(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/g },
  ],
  go: [
    { kind: 'function', pattern: /func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/g },
    { kind: 'struct', pattern: /type\s+([A-Za-z_][\w]*)\s+struct/g },
    { kind: 'interface', pattern: /type\s+([A-Za-z_][\w]*)\s+interface/g },
  ],
}

function positionFromOffset(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset)
  const lines = before.split(/\r?\n/)
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  }
}

export function extractFileSymbols(relativePath: string, content: string): WorkspaceSymbol[] {
  const language = guessLanguageFromPath(relativePath)
  if (!language) {
    return []
  }

  const patterns = LANGUAGE_SYMBOL_PATTERNS[language] ?? []
  const symbols: WorkspaceSymbol[] = []
  const seen = new Set<string>()

  for (const { kind, pattern } of patterns) {
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) {
      const name = match[1]
      if (!name) {
        continue
      }
      const position = positionFromOffset(content, match.index ?? 0)
      const key = `${name}:${kind}:${position.line}:${position.column}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      symbols.push({
        name,
        kind,
        relativePath,
        line: position.line,
        column: position.column,
        language,
      })
    }
  }

  return symbols.sort((a, b) => a.line - b.line || a.column - b.column || a.name.localeCompare(b.name))
}
