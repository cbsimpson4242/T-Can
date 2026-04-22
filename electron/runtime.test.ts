import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPreloadPath, getRendererUrl, getRuntimeRoot, resolvePreferredCwd } from './runtime'

describe('runtime helpers', () => {
  it('resolves the runtime root from the electron build output directory', () => {
    expect(getRuntimeRoot(path.posix.join('/tmp/project', 'dist-electron'), 'linux')).toBe('/tmp/project')
    expect(getRuntimeRoot(path.win32.join('C:\\Apps\\T-CAN', 'dist-electron'), 'win32')).toBe('C:\\Apps\\T-CAN')
    expect(getRuntimeRoot('/opt/T-CAN/resources/app.asar', 'linux')).toBe('/opt/T-CAN/resources/app.asar')
  })

  it('builds a file URL that is valid on Windows and Unix', () => {
    expect(getRendererUrl('/tmp/project', undefined, 'linux')).toBe('file:///tmp/project/dist/index.html')
    expect(getRendererUrl('C:\\Apps\\T-CAN', undefined, 'win32')).toBe('file:///C:/Apps/T-CAN/dist/index.html')
    expect(getRendererUrl('/tmp/project', 'http://127.0.0.1:5173', 'linux')).toBe('http://127.0.0.1:5173')
  })

  it('builds the preload path from the runtime root', () => {
    expect(getPreloadPath('/tmp/project', 'linux')).toBe(path.posix.join('/tmp/project', 'dist-electron', 'preload.cjs'))
    expect(getPreloadPath('C:\\Apps\\T-CAN\\dist-electron', 'win32')).toBe(
      path.win32.join('C:\\Apps\\T-CAN', 'dist-electron', 'preload.cjs'),
    )
  })

  it('prefers the requested cwd, then the workspace, then the home directory', () => {
    const directories = new Set(['C:\\requested', 'C:\\workspace', 'C:\\Users\\Chris'])
    const isDirectoryFn = (filePath: string) => directories.has(filePath)

    expect(
      resolvePreferredCwd({
        requestedCwd: 'C:\\requested',
        workspacePath: 'C:\\workspace',
        homePath: 'C:\\Users\\Chris',
        isDirectoryFn,
      }),
    ).toBe('C:\\requested')

    expect(
      resolvePreferredCwd({
        requestedCwd: 'C:\\missing',
        workspacePath: 'C:\\workspace',
        homePath: 'C:\\Users\\Chris',
        isDirectoryFn,
      }),
    ).toBe('C:\\workspace')

    expect(
      resolvePreferredCwd({
        requestedCwd: 'C:\\missing',
        workspacePath: 'C:\\gone',
        homePath: 'C:\\Users\\Chris',
        isDirectoryFn,
      }),
    ).toBe('C:\\Users\\Chris')
    expect(
      resolvePreferredCwd({
        requestedCwd: 'C:\\missing',
        workspacePath: 'C:\\gone',
        homePath: 'C:\\also-missing',
        isDirectoryFn,
      }),
    ).toBe(process.cwd())
  })
})
