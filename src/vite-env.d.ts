import type { QuickCutApi } from './types'

declare global {
  interface Window {
    quickCut: QuickCutApi
  }
}

export {}
