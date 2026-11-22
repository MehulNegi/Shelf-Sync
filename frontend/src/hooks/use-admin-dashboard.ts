import { useEffect, useRef, useState } from 'react'
import { clearsAdminData, loadAdminPanels, type AdminPanel, type AdminPanels } from '../services/admin'
import { startAdminRefresh } from '../services/admin-refresh'
import { isMockMode } from '../services/backend'
import type { InventoryQuery } from '../types/admin'

interface RefreshState {
  query: InventoryQuery
  loading: boolean
  data?: AdminPanels
  completedAt?: Date
}

const offlineDemo: AdminPanels = {
  overview: { source: 'demo' }, inventory: { source: 'demo' }, orders: { source: 'demo' }, events: { source: 'demo' },
}

export function retainLastLive<T>(next: AdminPanel<T>, previous?: AdminPanel<T>): AdminPanel<T> {
  if (next.source === 'unavailable' && !clearsAdminData(next.error) && previous && 'data' in previous) {
    return { ...next, data: previous.data }
  }
  return next
}

export function useAdminDashboard(query: InventoryQuery, enabled = true) {
  const [state, setState] = useState<RefreshState>()
  const refresh = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled || isMockMode) return
    const polling = startAdminRefresh((signal) => loadAdminPanels(query, signal), (event) => {
      setState((previous) => {
        const current = previous?.query === query ? previous : undefined
        if ('loading' in event) return { ...current, query, loading: true }
        if ('data' in event) {
          const { overview, inventory, orders, events } = event.data
          const data = {
            overview: retainLastLive(overview, current?.data?.overview),
            inventory: retainLastLive(inventory, current?.data?.inventory),
            orders: retainLastLive(orders, current?.data?.orders),
            events: retainLastLive(events, current?.data?.events),
          }
          return { query, loading: false, data,
            completedAt: Object.values(event.data).some(({ source }) => source === 'live') ? event.completedAt : current?.completedAt }
        }
        return { ...current, query, loading: false }
      })
    })
    refresh.current = polling.refresh
    return () => {
      polling.stop()
      refresh.current = () => {}
    }
  }, [query, enabled])

  return {
    state: isMockMode ? { query, loading: false, data: offlineDemo } : state?.query === query ? state : undefined,
    canRefresh: !isMockMode,
    refresh: () => refresh.current(),
  }
}
