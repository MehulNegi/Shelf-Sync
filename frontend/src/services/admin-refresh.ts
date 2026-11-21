export function startAdminRefresh<T>(
  load: (signal: AbortSignal) => Promise<T>,
  publish: (event: { loading: true } | { data: T; completedAt: Date } | { error: unknown }) => void,
  interval = 5_000,
) {
  const controller = new AbortController()
  let busy = false

  async function refresh() {
    if (busy || controller.signal.aborted) return
    busy = true
    publish({ loading: true })
    try {
      const data = await load(controller.signal)
      if (!controller.signal.aborted) publish({ data, completedAt: new Date() })
    } catch (error) {
      if (!controller.signal.aborted) publish({ error })
    } finally {
      busy = false
    }
  }

  const timer = setInterval(refresh, interval)
  void refresh()
  return {
    refresh,
    stop() {
      clearInterval(timer)
      controller.abort()
    },
  }
}
