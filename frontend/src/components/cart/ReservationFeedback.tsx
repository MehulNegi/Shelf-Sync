import { AlertCircle } from 'lucide-react'
import type { CartReservations } from '../../hooks/use-cart-reservations'

export function ReservationFeedback({ reservations }: { reservations: CartReservations }) {
  const { message, pending, busy, retry } = reservations
  if (!message && (!pending || busy)) return null

  return (
    <div className="checkout-alert" role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <div>
        <strong>Cart reservation</strong>
        <p>{message || 'A cart request has no confirmed result yet.'}</p>
        <button type="button" className="text-button" disabled={busy} onClick={() => void retry()}>
          {pending ? 'Retry same request' : 'Refresh reservations'}
        </button>
      </div>
    </div>
  )
}
