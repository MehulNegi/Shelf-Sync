import { useEffect, useRef, useState } from 'react'
import { clearsAdminData, loadAdminSnapshot } from '../services/admin'
import { startAdminRefresh } from '../services/admin-refresh'
import type { AdminSnapshot, InventoryQuery } from '../types/admin'

interface RefreshState {
  query: InventoryQuery
  loading: boolean
  data?: AdminSnapshot
  completedAt?: Date
  error?: unknown
}

export function useAdminDashboard(query: InventoryQuery, enabled: boolean) {
  const [state, setState] = useState<RefreshState>()
  const refresh = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return
    const polling = startAdminRefresh((signal) => loadAdminSnapshot(query, signal), (event) => {
      setState((previous) => {
        const current = previous?.query === query ? previous : undefined
        if ('loading' in event) return { ...current, query, loading: true, error: undefined }
        if ('data' in event) return { query, loading: false, ...event }
        return { ...(clearsAdminData(event.error) ? undefined : current), query, loading: false, error: event.error }
      })
    })
    refresh.current = polling.refresh
    return () => {
      polling.stop()
      refresh.current = () => {}
    }
  }, [query, enabled])

  return {
    state: enabled && state?.query === query ? state : undefined,
    refresh: () => refresh.current(),
  }
}
