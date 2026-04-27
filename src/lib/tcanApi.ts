import type { TCanApi } from '../../shared/api'
import type { TerminalSessionInfo } from '../../shared/types'

type TCanApiRuntime = Partial<TCanApi> & {
  getTerminalSession?: TCanApi['getTerminalSession']
  getTerminalSessionInfo?: TCanApi['getTerminalSessionInfo']
}

type WindowLike = {
  tcan?: TCanApiRuntime
}

const PRELOAD_MISSING_MESSAGE = 'T-CAN preload API is unavailable. Rebuild the Electron bundles and restart the app.'

async function getTerminalSessionInfoFallback(api: TCanApiRuntime, sessionId: string): Promise<TerminalSessionInfo | null> {
  if (typeof api.getTerminalSessionInfo === 'function') {
    return api.getTerminalSessionInfo(sessionId)
  }

  if (typeof api.getTerminalSession === 'function') {
    const snapshot = await api.getTerminalSession(sessionId)
    return snapshot?.info ?? null
  }

  throw new Error('T-CAN terminal session APIs are unavailable. Rebuild the Electron bundles and restart the app.')
}

export function getApi(windowLike: WindowLike = window): TCanApi {
  const api = windowLike.tcan
  if (!api) {
    throw new Error(PRELOAD_MISSING_MESSAGE)
  }

  if (typeof api.getTerminalSessionInfo === 'function') {
    return api as TCanApi
  }

  return {
    ...(api as TCanApi),
    getTerminalSessionInfo(sessionId: string) {
      return getTerminalSessionInfoFallback(api, sessionId)
    },
  }
}

export { PRELOAD_MISSING_MESSAGE }
