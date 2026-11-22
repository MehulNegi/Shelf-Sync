import { startAdminRefresh } from './admin-refresh'

export function startVisibleRefresh<T>(
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  load: (signal: AbortSignal) => Promise<T>,
  publish: Parameters<typeof startAdminRefresh<T>>[1],
) {
  let polling: ReturnType<typeof startAdminRefresh<T>> | undefined

  function update() {
    if (document.visibilityState === 'visible') {
      polling ??= startAdminRefresh(load, publish)
    } else {
      polling?.stop()
      polling = undefined
    }
  }

  document.addEventListener('visibilitychange', update)
  update()
  return {
    refresh: () => polling?.refresh(),
    stop() {
      polling?.stop()
      polling = undefined
      document.removeEventListener('visibilitychange', update)
    },
  }
}
