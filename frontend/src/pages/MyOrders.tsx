import { ChevronDown, Layers3, Package, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { OrderItems } from '../components/orders/OrderItems'
import { OrderTracking } from '../components/orders/OrderTracking'
import { Card } from '../components/ui/card'
import { useResource } from '../hooks/use-resource'
import { formatPrice } from '../lib/format-price'
import { ApiError } from '../services/api-error'
import { isMockMode } from '../services/backend'
import { getOrderIds } from '../services/order-history'
import { formatOrderDate, orderStatusLabel, sortOrderIds } from '../services/order-tracking'
import { getOrder } from '../services/orders'
import { getOrderTracking } from '../services/tracking-api'
import { cities } from '../types/products'

interface OrderCardProps {
  id: string
  onCreationDate: (id: string, createdAt: string) => void
}

function OrderCard({ id, onCreationDate }: OrderCardProps) {
  const [attempt, setAttempt] = useState(0)
  const [trackingAttempt, setTrackingAttempt] = useState(0)
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      return await getOrder(id, signal)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }, [id])
  const result = useResource(load, attempt)
  const order = result && 'data' in result ? result.data : undefined

  const loadTracking = useCallback(async (signal: AbortSignal) => (
    isMockMode ? null : getOrderTracking(id, signal)
  ), [id])
  const trackingResult = useResource(loadTracking, trackingAttempt)
  const tracking = trackingResult && 'data' in trackingResult ? trackingResult.data : undefined
  const createdAt = tracking?.createdAt
  const status = tracking?.status ?? order?.status

  useEffect(() => {
    if (createdAt) onCreationDate(id, createdAt)
  }, [createdAt, id, onCreationDate])
  return (
    <Card className="history-card">
      <div className="history-card-header">
        <div>
          <p className="history-card-label">Order ID</p>
          <h2>{order?.id ?? id}</h2>
        </div>
        {order && status && <span className="history-status" data-status={status}>{orderStatusLabel(status)}</span>}
      </div>
      {!result ? <p className="progress-note" role="status">Loading order…</p>
        : 'error' in result ? (
          <div>
            <p role="alert">Couldn’t load order details. {result.error}</p>
            <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry order</button>
          </div>
        ) : order === null ? <p role="status">This saved order could not be found.</p>
        : order && (
          <>
            <dl className="history-summary">
              <div><dt>City</dt><dd>{cities[order.city]}</dd></div>
              <div>
                <dt>Purchase date</dt>
                <dd>{createdAt ? <time dateTime={createdAt}>{formatOrderDate(createdAt)}</time>
                  : !isMockMode && !trackingResult ? 'Loading…' : 'Unavailable'}</dd>
              </div>
              <div><dt>Total</dt><dd>{formatPrice(order.total)}</dd></div>
            </dl>
            <p className="history-items-preview">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(' · ')}</p>
            <details className="history-details">
              <summary>View order details <ChevronDown size={17} aria-hidden="true" /></summary>
              <h3>Purchased products</h3>
              <OrderItems items={order.items} />
              <h3>Tracking</h3>
              {isMockMode ? <OrderTracking status={order.status} />
                : tracking ? <OrderTracking status={tracking.status} history={tracking.history} createdAt={tracking.createdAt} />
                : !trackingResult ? <p className="progress-note" role="status">Loading tracking…</p>
                : (
                  <div>
                    {'error' in trackingResult
                      ? <p role="alert">Couldn’t load tracking. {trackingResult.error}</p>
                      : <p role="status">Tracking is unavailable for this order.</p>}
                    <button type="button" className="text-button"
                      onClick={() => setTrackingAttempt((value) => value + 1)}>Retry tracking</button>
                  </div>
                )}
            </details>
          </>
        )}
    </Card>
  )
}

export function MyOrders() {
  const [ids] = useState(getOrderIds)
  const [dates, setDates] = useState<ReadonlyMap<string, string>>(() => new Map())
  const noteCreationDate = useCallback((id: string, createdAt: string) => {
    setDates((previous) => previous.get(id) === createdAt ? previous : new Map(previous).set(id, createdAt))
  }, [])
  const sortedIds = sortOrderIds(ids, dates)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <header className="site-header">
        <nav className="shell history-nav" aria-label="Main navigation">
          <a href="#top" className="brand">
            <span className="brand-icon"><Layers3 size={22} aria-hidden="true" /></span>
            ShelfSync
          </a>
          <a href="#top" className="orders-nav-link">Back to shopping</a>
        </nav>
      </header>
      <main className="shell order-history">
        <div className="history-heading">
          <h1 ref={heading} tabIndex={-1}>My Orders</h1>
          <span className="history-mode"><ReceiptText size={16} aria-hidden="true" /> {isMockMode ? 'Mock orders' : 'Live orders'}</span>
          <p>{isMockMode ? 'Simulated purchases saved in this browser.' : 'Orders placed from this browser.'}</p>
        </div>
        {ids.length ? (
          <ul className="history-list" aria-label="Saved orders">
            {sortedIds.map((id) => <li key={id}><OrderCard id={id} onCreationDate={noteCreationDate} /></li>)}
          </ul>
        ) : (
          <div className="state-panel history-empty">
            <Package size={30} aria-hidden="true" />
            <h2>No saved orders yet</h2>
            <p>Your orders will appear here after checkout.</p>
            <a href="#top" className="primary-button">Back to shopping</a>
          </div>
        )}
      </main>
    </>
  )
}
