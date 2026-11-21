import { CircleCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useResource } from '../../hooks/use-resource'
import { formatPrice } from '../../lib/format-price'
import { isMockMode } from '../../services/backend'
import { getOrder } from '../../services/orders'
import type { OrderCreated } from '../../types/orders'
import { cities, type City } from '../../types/products'

export function OrderConfirmation({ order, city, onClose }: { order: OrderCreated; city: City; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const [attempt, setAttempt] = useState(0)
  const load = useCallback((signal: AbortSignal) => getOrder(order.orderId, signal), [order.orderId])
  const result = useResource(load, attempt)
  const details = result && 'data' in result ? result.data : undefined

  return (
    <div className="checkout-content">
      <div className="confirmation-panel">
        <h3 ref={heading} tabIndex={-1}>
          <CircleCheck size={26} aria-hidden="true" />
          {isMockMode ? 'Mock order confirmed.' : 'Your order is confirmed.'}
        </h3>
        <dl className="order-summary">
          <div><dt>Order ID</dt><dd>{details?.id ?? order.orderId}</dd></div>
          <div><dt>City</dt><dd>{cities[details?.city ?? city]}</dd></div>
          <div><dt>Order total</dt><dd>{formatPrice(details?.total ?? order.total)}</dd></div>
        </dl>
      </div>
      {!result && <p className="progress-note" role="status">Loading order details…</p>}
      {result && 'error' in result && (
        <div>
          <p role="alert">The order is confirmed. Its item details could not load. {result.error}</p>
          <button type="button" className="text-button" onClick={() => setAttempt(attempt + 1)}>Retry order details</button>
        </div>
      )}
      {details && (
        <ul className="cart-list" aria-label="Ordered items">
          {details.items.map((item) => (
            <li key={item.productId} className="order-line">
              <span>{item.name} × {item.quantity}</span>
              <span>{formatPrice(item.unitPrice)} each</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="primary-button" onClick={onClose}>Continue shopping</button>
    </div>
  )
}
