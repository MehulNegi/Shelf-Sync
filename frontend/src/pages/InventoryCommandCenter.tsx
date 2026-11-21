import { ArrowRight, LockKeyhole, RefreshCw, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EventActivity, OverviewPanels, RecentOrders } from '../components/admin/DashboardPanels'
import { RetailerHeader, type RetailerView } from '../components/admin/RetailerHeader'
import { InventoryPanel } from '../components/admin/InventoryPanel'
import { useAdminDashboard } from '../hooks/use-admin-dashboard'
import { adminErrorMessage, isLocalAdminConfiguration } from '../services/admin'
import { ApiError } from '../services/api-error'
import { baseUrl } from '../services/backend'
import type { InventoryQuery } from '../types/admin'

const refreshTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

const titles = { shop: 'My Shop', products: 'My Products', orders: 'Customer Orders' }
const descriptions = {
  shop: '',
  products: 'Check what is in stock and find products that need restocking.',
  orders: 'See the latest orders placed in your shop and their current status.',
}

export function InventoryCommandCenter({ view = 'shop' }: { view?: Exclude<RetailerView, 'earnings'> }) {
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
  }, [view])

  function applyFilters(next: InventoryQuery) {
    setFilters(next)
    setCursors([undefined])
  }

  function changePage(next?: string) {
    setCursors((previous) => next ? [...previous, next] : previous.slice(0, -1))
  }

  return (
    <>
      <RetailerHeader active={view} />
      <main className="shell command-center retailer-page">
        <div className="retailer-welcome">
          <div>
            <h1 ref={heading} tabIndex={-1}>{titles[view]}</h1>
            <p>{view === 'shop' ? 'Namaste! Welcome to your online shop.' : descriptions[view]}</p>
          </div>
          <span className="command-state">{data ? 'Connected · Local demo' : enabled ? 'Local demo' : 'Local setup required'}</span>
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
                  : loading ? 'Loading shop information…' : 'Waiting for shop information'}
              </p>
              <button className="clear-filters" type="button" disabled={loading} onClick={refresh}>
                <RefreshCw size={16} aria-hidden="true" /> Refresh
              </button>
            </div>
            {state?.error && (
              <div className="command-notice" role="alert">
                <div>
                  <h2>{data ? 'Showing the last successful refresh' : 'Shop information is unavailable'}</h2>
                  <p>{adminErrorMessage(state.error)}</p>
                  {expired && <button className="text-button" type="button" onClick={() => setCursors([undefined])}>Return to first page</button>}
                </div>
              </div>
            )}
            {view === 'shop' && (
              <>
                {data ? <OverviewPanels overview={data.overview} /> : loading && (
                  <div className="command-metrics retailer-summary motion-safe:animate-pulse" aria-hidden="true">
                    {Array.from({ length: 3 }, (_, index) => <div className="command-panel command-metric-skeleton" key={index} />)}
                  </div>
                )}
                {data && (
                  <details className="command-panel retailer-details">
                    <summary>Shop update history</summary>
                    <EventActivity events={data.events.events} />
                  </details>
                )}
              </>
            )}
            {view === 'products' && <InventoryPanel data={data?.inventory} loading={loading} pageNumber={cursors.length} filters={filters}
              onFilters={applyFilters} onPage={changePage} />}
            {view === 'orders' && (data ? <RecentOrders orders={data.orders.orders} /> : loading &&
              <div className="command-panel command-metric-skeleton motion-safe:animate-pulse" aria-hidden="true" />)}
          </>
        )}
        {view === 'shop' && (
          <a className="command-panel retailer-earnings-link" href="#/admin/profit-os">
            <Wallet size={24} aria-hidden="true" />
            <div><h2>See what you could earn</h2>
              <p>Choose a product and see how discounts and delivery costs affect the money left from a sale.</p>
            </div>
            <ArrowRight size={21} aria-hidden="true" />
          </a>
        )}
      </main>
    </>
  )
}
