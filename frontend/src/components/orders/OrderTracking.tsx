import { Check, Circle, MapPin } from 'lucide-react'
import { formatOrderDate, orderTracking } from '../../services/order-tracking'
import type { OrderStatus, TrackingEvent } from '../../types/orders'

interface OrderTrackingProps {
  status: OrderStatus
  history?: TrackingEvent[]
}

export function OrderTracking({ status, history }: OrderTrackingProps) {
  return (
    <ol className="tracking-steps" aria-label="Order tracking">
      {orderTracking(status, history).map(({ label, state, occurredAt }) => {
        const Icon = state === 'completed' ? Check : state === 'current' ? MapPin : Circle
        return (
          <li key={label} className="tracking-step" data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}>
            <span className="tracking-symbol"><Icon size={16} aria-hidden="true" /></span>
            <div>
              <strong>{label}</strong>
              <span>{state === 'current' ? 'Current stage' : state === 'completed' ? 'Completed' : 'Pending'}</span>
              {occurredAt ? <time className="tracking-time" dateTime={occurredAt}>{formatOrderDate(occurredAt)}</time>
                : history && state !== 'pending' ? <span>Time unavailable</span> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
