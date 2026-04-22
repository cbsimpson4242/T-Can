import type { TCanApi } from '../shared/api'

declare global {
  interface Window {
    tcan: TCanApi
  }
}

export {}
