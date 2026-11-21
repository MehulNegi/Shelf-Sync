import { Layers3, LockKeyhole, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EventActivity, OverviewPanels, RecentOrders } from '../components/admin/DashboardPanels'
import { InventoryPanel } from '../components/admin/InventoryPanel'
import { useAdminDashboard } from '../hooks/use-admin-dashboard'
import { adminErrorMessage, isLocalAdminConfiguration } from '../services/admin'
import { ApiError } from '../services/api-error'
import { baseUrl } from '../services/backend'
import type { InventoryQuery } from '../types/admin'

const refreshTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

export function InventoryCommandCenter() {
  const heading = useRef<HTMLHeadingElement>(null)
  const enabled = isLocalAdminConfiguration(window.location, baseUrl)
  const [filters, setFilters] = useState<InventoryQuery>({ limit: 50 })
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const cursor = cursors.at(-1)
  const query = useMemo(() => ({ ...filters, cursor }), [filters, cursor])
  const { state, refresh } = useAdminDashboard(query, enabled)
  const data = state?.data
  const loading = enabled && (!state || state.loading)
  const expired = state?.error instanceof ApiError && state.error.code === 'INVALID_CURSOR'

  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [])

  function applyFilters(next: InventoryQuery) {
    setFilters(next)
    setCursors([undefined])
  }

  function changePage(next?: string) {
    setCursors((previous) => next ? [...previous, next] : previous.slice(0, -1))
  }

  return (
    <>
      <header className="site-header">
        <nav className="shell history-nav" aria-label="Command Center navigation">
          <a href="#top" className="brand">
            <span className="brand-icon"><Layers3 size={22} aria-hidden="true" /></span>
            ShelfSync
          </a>
          <a href="#top" className="orders-nav-link">Back to shopping</a>
        </nav>
      </header>
      <main className="shell command-center">
        <div className="command-intro">
          <div>
            <h1 ref={heading} tabIndex={-1}>Inventory Command Center</h1>
            <p>City inventory, recent orders, and outbox publication activity.</p>
          </div>
          <span className="command-state">{data ? 'Local demo · PostgreSQL' : enabled ? 'Local demo' : 'Local setup required'}</span>
        </div>

        {!enabled ? (
          <section className="command-notice" aria-labelledby="command-notice-title">
            <span className="command-icon"><LockKeyhole size={22} aria-hidden="true" /></span>
            <div>
              <h2 id="command-notice-title">Local demo configuration required</h2>
              <p>Open the frontend at http://localhost:5173 on the same laptop as the authorized loopback backend. Set the frontend API base URL to http://127.0.0.1:3000/api.</p>
            </div>
          </section>
        ) : (
          <>
            <div className="command-refresh">
              <p role="status">
                {state?.completedAt
                  ? <>Last successful refresh <time dateTime={state.completedAt.toISOString()}>{refreshTime.format(state.completedAt)}</time>{loading && ' · Refreshing…'}</>
                  : loading ? 'Loading operational data…' : 'Waiting for an initial successful refresh'}
              </p>
              <button className="clear-filters" type="button" disabled={loading} onClick={refresh}>
                <RefreshCw size={16} aria-hidden="true" /> Refresh
              </button>
            </div>
            {state?.error && (
              <div className="command-notice" role="alert">
                <div>
                  <h2>{data ? 'Showing the last successful refresh' : 'Operational data unavailable'}</h2>
                  <p>{adminErrorMessage(state.error)}</p>
                  {expired && <button className="text-button" type="button" onClick={() => setCursors([undefined])}>Return to first page</button>}
                </div>
              </div>
            )}
            {data ? <OverviewPanels overview={data.overview} /> : loading && (
              <div className="command-metrics motion-safe:animate-pulse" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => <div className="command-panel command-metric-skeleton" key={index} />)}
              </div>
            )}
            <InventoryPanel data={data?.inventory} loading={loading} pageNumber={cursors.length}
              onFilters={applyFilters} onPage={changePage} />
            {data && (
              <div className="command-sections">
                <RecentOrders orders={data.orders.orders} />
                <EventActivity events={data.events.events} />
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
