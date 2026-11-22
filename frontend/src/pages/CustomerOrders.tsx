import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RecentOrders } from '../components/admin/DashboardPanels'
import { RetailerHeader } from '../components/admin/RetailerHeader'
import { retainLastLive } from '../hooks/use-admin-dashboard'
import { adminErrorMessage, type AdminPanel } from '../services/admin'
import { ApiError } from '../services/api-error'
import { isMockMode } from '../services/backend'
import { loadRetailerOrders } from '../services/retailer-orders'
import { startVisibleRefresh } from '../services/visible-refresh'
import type { AdminOrderRow } from '../types/admin'

export function CustomerOrders({ sample }: { sample: AdminOrderRow[] }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const refresh = useRef<() => void>(() => {})
  const [state, setState] = useState<{ panel?: AdminPanel<AdminOrderRow[]>; loading: boolean }>()
  const panel = isMockMode ? { source: 'demo' } as const : state?.panel
  const data = panel?.source === 'demo' ? sample : panel?.data
  const loading = !isMockMode && (!state || state.loading)

  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (isMockMode) return
    const polling = startVisibleRefresh(document, loadRetailerOrders, (event) => {
      setState((previous) => {
        if ('loading' in event) return { panel: previous?.panel, loading: true }
        const next: AdminPanel<AdminOrderRow[]> = 'data' in event ? event.data : { source: 'unavailable', error: event.error } as const
        return { panel: retainLastLive(next, previous?.panel), loading: false }
      })
    })
    refresh.current = polling.refresh
    return () => {
      polling.stop()
      refresh.current = () => {}
    }
  }, [])

  return (
    <>
      <RetailerHeader active="orders" />
      <main className="shell command-center retailer-page">
        <div className="retailer-welcome">
          <div>
            <h1 ref={heading} tabIndex={-1}>Customer Orders</h1>
            <p>See the latest orders placed in your shop and their current status.</p>
          </div>
          <span className="command-state">{panel?.source === 'live' ? 'Live orders'
            : panel?.source === 'demo' ? 'Demo data' : panel?.data ? 'Last available orders'
              : loading ? 'Loading…' : 'Data unavailable'}</span>
        </div>
        {panel?.source === 'demo' && (
          <section className="command-notice" aria-label="Demo data">
            <div><h2>Hackathon demo</h2><p>Recent orders are fictional sample data.</p></div>
          </section>
        )}
        {!isMockMode && <div className="command-refresh">
          <p role="status">{!data && loading ? 'Loading customer orders…' : panel?.source === 'live' ? 'Refreshes every 5 seconds while open.' : ''}</p>
          <button className="clear-filters" type="button" disabled={loading} onClick={() => refresh.current()}>
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        </div>}
        {panel?.source === 'unavailable' && (
          <div className="command-notice" role="alert">
            <div>
              <h2>{panel.data ? 'Showing the last available orders' : 'Recent orders unavailable'}</h2>
              <p>{panel.error instanceof ApiError && panel.error.code === 'INVALID_ORDER_FEED'
                ? panel.error.message : adminErrorMessage(panel.error)}</p>
            </div>
          </div>
        )}
        {data ? <RecentOrders orders={data} /> : loading &&
          <div className="command-panel command-metric-skeleton motion-safe:animate-pulse" aria-hidden="true" />}
      </main>
    </>
  )
}
