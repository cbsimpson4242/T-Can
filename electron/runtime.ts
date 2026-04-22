import fs from 'node:fs'
import path from 'node:path'

function getPathModule(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

function toFileUrl(filePath: string, platform: NodeJS.Platform): string {
  const normalized = platform === 'win32' ? filePath.replace(/\\/g, '/') : filePath
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return new URL(`file://${encodeURI(withLeadingSlash)}`).toString()
}

export function getRuntimeRoot(appPath: string, platform = process.platform): string {
  const pathModule = getPathModule(platform)
  return pathModule.basename(appPath) === 'dist-electron' ? pathModule.resolve(appPath, '..') : appPath
}

export function getRendererUrl(appPath: string, devServerUrl?: string, platform = process.platform): string {
  if (devServerUrl) {
    return devServerUrl
  }

  const pathModule = getPathModule(platform)
  return toFileUrl(pathModule.join(getRuntimeRoot(appPath, platform), 'dist', 'index.html'), platform)
}

export function getPreloadPath(appPath: string, platform = process.platform): string {
  const pathModule = getPathModule(platform)
  return pathModule.join(getRuntimeRoot(appPath, platform), 'dist-electron', 'preload.cjs')
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

export function resolvePreferredCwd(args: {
  requestedCwd?: string | null
  workspacePath?: string | null
  homePath: string
  isDirectoryFn?: (filePath: string) => boolean
}): string {
  const { requestedCwd, workspacePath, homePath, isDirectoryFn = isDirectory } = args

  for (const candidate of [requestedCwd, workspacePath, homePath]) {
    if (candidate && isDirectoryFn(candidate)) {
      return candidate
    }
  }

  return process.cwd()
}
