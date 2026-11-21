import { Check, Circle, MapPin } from 'lucide-react'
import { orderTracking } from '../../services/order-tracking'
import type { OrderStatus } from '../../types/orders'

export function OrderTracking({ status }: { status: OrderStatus }) {
  return (
    <ol className="tracking-steps" aria-label="Order tracking">
      {orderTracking(status).map(({ label, state }) => {
        const Icon = state === 'completed' ? Check : state === 'current' ? MapPin : Circle
        return (
          <li key={label} className="tracking-step" data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}>
            <span className="tracking-symbol"><Icon size={16} aria-hidden="true" /></span>
            <div>
              <strong>{label}</strong>
              <span>{state === 'current' ? 'Current stage' : state === 'completed' ? 'Completed' : 'Pending'}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
