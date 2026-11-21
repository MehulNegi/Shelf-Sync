import { ArrowRight, RefreshCw, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EventActivity, OverviewPanels, RecentOrders } from '../components/admin/DashboardPanels'
import { RetailerHeader, type RetailerView } from '../components/admin/RetailerHeader'
import { InventoryPanel } from '../components/admin/InventoryPanel'
import { useAdminDashboard } from '../hooks/use-admin-dashboard'
import { adminErrorMessage, type AdminPanel } from '../services/admin'
import { demoAdminSnapshot, demoInventoryRows, demoStockUpdate } from '../mocks/admin'
import { ApiError } from '../services/api-error'
import type { AdminInventoryRow, InventoryQuery } from '../types/admin'

const refreshTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

const titles = { shop: 'My Shop', products: 'My Products', orders: 'Customer Orders' }
const descriptions = {
  shop: '',
  products: 'Check what is in stock and find products that need restocking.',
  orders: 'See the latest orders placed in your shop and their current status.',
}

function panelData<T>(panel: AdminPanel<T> | undefined, demo: T): T | undefined {
  return panel?.source === 'demo' ? demo : panel?.data
}

export function InventoryCommandCenter({ view = 'shop' }: { view?: Exclude<RetailerView, 'earnings'> }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [demoStock, setDemoStock] = useState(demoInventoryRows)
  const [demoDate] = useState(() => new Date())
  const [filters, setFilters] = useState<InventoryQuery>({ limit: 50 })
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const cursor = cursors.at(-1)
  const query = useMemo(() => ({ ...filters, cursor }), [filters, cursor])
  const { state, refresh, canRefresh } = useAdminDashboard(query)
  const data = state?.data
  const loading = !state || state.loading
  const sample = useMemo(() => demoAdminSnapshot(demoStock, query, demoDate), [demoStock, query, demoDate])
  const overview = panelData(data?.overview, sample.overview)
  const inventory = panelData(data?.inventory, sample.inventory)
  const orders = panelData(data?.orders, sample.orders)
  const events = panelData(data?.events, sample.events)
  const panels = view === 'shop'
    ? [{ name: 'Shop totals', panel: data?.overview }, { name: 'Shop update history', panel: data?.events }]
    : view === 'products' ? [{ name: 'Inventory', panel: data?.inventory }] : [{ name: 'Recent orders', panel: data?.orders }]
  const demoSections = panels.filter(({ panel }) => panel?.source === 'demo').map(({ name }) => name)
  const liveSections = panels.some(({ panel }) => panel?.source === 'live' || panel?.source === 'unavailable' && panel.data)
  const demoInventory = data?.inventory.source === 'demo'

  useEffect(() => {
    if (cursor && data && data.inventory.source !== 'unavailable' && demoInventory !== cursor.startsWith('demo:')) setCursors([undefined])
  }, [cursor, data, demoInventory])

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
          <span className="command-state">{demoSections.length
            ? liveSections ? 'Live and demo data' : 'Demo data'
            : liveSections ? 'Live data' : loading ? 'Loading…' : 'Data unavailable'}</span>
        </div>
        {demoSections.length > 0 && (
          <section className="command-notice" aria-label="Demo data">
            <div>
              <h2>Hackathon demo</h2>
              <p>{demoSections.join(' and ')} use fictional sample data. Demo edits stay in this browser view and do not update live inventory or orders.</p>
            </div>
          </section>
        )}
        {canRefresh && (
          <div className="command-refresh">
            <p role="status">
              {loading ? 'Refreshing shop information…' : state?.completedAt
                ? <>Last successful live refresh <time dateTime={state.completedAt.toISOString()}>{refreshTime.format(state.completedAt)}</time></>
                : demoSections.length ? 'Demo data is ready' : 'Shop information checked'}
            </p>
            <button className="clear-filters" type="button" disabled={loading} onClick={refresh}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </div>
        )}
        {panels.map(({ name, panel }) => panel?.source === 'unavailable' && (
          <div className="command-notice" role="alert" key={name}>
            <div>
              <h2>{name}{panel.data ? ' · Last available data' : ' unavailable'}</h2>
              <p>{adminErrorMessage(panel.error)}</p>
              {panel.error instanceof ApiError && panel.error.code === 'INVALID_CURSOR' && (
                <button className="text-button" type="button" onClick={() => setCursors([undefined])}>Return to first page</button>
              )}
            </div>
          </div>
        ))}
        {view === 'shop' && (
          <>
            {overview ? <OverviewPanels overview={overview} /> : loading && (
              <div className="command-metrics retailer-summary motion-safe:animate-pulse" aria-hidden="true">
                {Array.from({ length: 3 }, (_, index) => <div className="command-panel command-metric-skeleton" key={index} />)}
              </div>
            )}
            {events && (
              <details className="command-panel retailer-details">
                <summary>Shop update history</summary>
                <EventActivity events={events.events} />
              </details>
            )}
          </>
        )}
        {view === 'products' && (
          <InventoryPanel data={inventory} loading={loading} pageNumber={cursors.length} filters={filters}
            onFilters={applyFilters} onPage={changePage}
            onDemoStockChange={demoInventory ? (row: AdminInventoryRow, stock: number) => {
              setDemoStock((previous) => demoStockUpdate(previous, row, stock))
              if (filters.stockStatus) setCursors([undefined])
            } : undefined} />
        )}
        {view === 'orders' && (orders ? <RecentOrders orders={orders.orders} /> : loading &&
          <div className="command-panel command-metric-skeleton motion-safe:animate-pulse" aria-hidden="true" />)}
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
