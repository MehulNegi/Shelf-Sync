import { AlertCircle, Clock3, ShoppingBag } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { CartReservations } from '../../hooks/use-cart-reservations'
import { useResource } from '../../hooks/use-resource'
import { formatPrice } from '../../lib/format-price'
import { ApiError, checkoutErrorMessage } from '../../services/api-error'
import { isMockMode } from '../../services/backend'
import { placeOrder } from '../../services/orders'
import { checkoutReservationIds, remainingSeconds } from '../../services/reservations'
import { getProduct } from '../../services/products'
import type { OrderCreated, OrderItem } from '../../types/orders'
import { cities, type City } from '../../types/products'
import { Dialog } from '../ui/dialog'
import { ReservationFeedback } from './ReservationFeedback'
import { OrderConfirmation } from './OrderConfirmation'

interface CartDialogProps {
  city: City
  items: OrderItem[]
  onAdjust: (productId: string, delta: number, stock: number) => void
  onRemove: (productId: string) => void
  onPlaced: () => void
  refreshCatalog: () => void
  onClose: () => void
  stockRevision?: number
  reservations?: CartReservations
}

export function CartDialog({ city, items, onAdjust, onRemove, onPlaced, refreshCatalog, onClose, stockRevision = 0, reservations }: CartDialogProps) {
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [message, setMessage] = useState('')
  const [legacyOrder, setOrder] = useState<OrderCreated>()
  const order = reservations ? reservations.order : legacyOrder
  const reservationLocked = Boolean(reservations?.busy || reservations?.pending)
  const busy = pending || reservationLocked
  const productIds = JSON.stringify(items.map((item) => item.productId))
  const load = useCallback((signal: AbortSignal) => {
    const ids: string[] = JSON.parse(productIds)
    return Promise.all(ids.map(async (id) => {
      try {
        return await getProduct(id, city, signal)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    }))
  }, [city, productIds])
  const result = useResource(load, attempt + stockRevision)
  const products = result && 'data' in result ? result.data : undefined
  const lines = items.map((item, index) => ({ ...item, product: products?.[index] }))
  const canCheckout = Boolean(products && (reservations
    ? lines.every(({ product }) => product) &&
      checkoutReservationIds(city, items, reservations.holds, reservations.now)
    : items.length && lines.every(({ quantity, product }) => product?.available && quantity <= product.stock)))
  const subtotal = lines.reduce((sum, { quantity, product }) => sum + (product?.price ?? 0) * quantity, 0)

  async function checkout() {
    if (submitting.current || !canCheckout) return
    if (reservations) {
      await reservations.checkout(city, items)
      return
    }
    submitting.current = true
    setPending(true)
    setMessage('')
    try {
      const confirmation = await placeOrder({ city, items })
      setOrder(confirmation)
      onPlaced()
      refreshCatalog()
    } catch (error) {
      setMessage(checkoutErrorMessage(error))
      if (error instanceof ApiError && error.status === 409 && error.code === 'INSUFFICIENT_STOCK') {
        refreshCatalog()
        setAttempt((value) => value + 1)
      }
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <Dialog title={order ? 'Order confirmation' : `Cart · ${cities[city]}`} onClose={onClose} busy={pending || reservations?.busy}>
      {order ? <OrderConfirmation order={order} city={city} onClose={onClose} /> : (
        <div className="checkout-content">
          <p className="cart-context">Your items for {cities[city]}. Carts are saved separately by city.</p>
          {reservations && <ReservationFeedback reservations={reservations} />}
          {isMockMode && <p className="mock-notice">Mock checkout · Orders and stock changes are simulated for this session.</p>}
          {message && (
            <div className="checkout-alert" role="alert">
              <AlertCircle size={20} aria-hidden="true" />
              <div><strong>Checkout needs attention</strong><p>{message}</p></div>
            </div>
          )}
          {!items.length ? (
            <div className="cart-empty">
              <span className="placeholder-icon"><ShoppingBag size={25} aria-hidden="true" /></span>
              <p>Your cart is empty.</p>
              <button type="button" className="primary-button" onClick={onClose}>Continue shopping</button>
            </div>
          ) : (
            <>
              {!result && <p className="progress-note" role="status">Checking cart availability in {cities[city]}…</p>}
              {result && 'error' in result && (
                <div>
                  <p role="alert">{result.error}</p>
                  <button type="button" className="text-button" onClick={() => setAttempt(attempt + 1)}>Refresh availability</button>
                </div>
              )}
              <ul className="cart-list">
                {lines.map(({ productId, product, quantity }) => {
                  const stock = product?.available ? product.stock : 0
                  const name = product?.name ?? productId
                  const hold = reservations?.holds.find((row) => row.city === city && row.productId === productId)
                  const seconds = remainingSeconds(hold, reservations?.now ?? 0)
                  function adjust(delta: number) {
                    if (reservations) void reservations.changeQuantity(city, { productId, quantity: quantity + delta }, false)
                    else onAdjust(productId, delta, stock)
                  }

                  return (
                    <li key={productId} className="cart-line">
                      <div className="cart-line-info">
                        <strong>{name}</strong>
                        {product && <p>{formatPrice(product.price)} each</p>}
                        {reservations && (
                          seconds > 0 && hold?.quantity === quantity ? (
                            <span className="reservation-clock" data-urgent={seconds <= 10}>
                              <Clock3 size={15} aria-hidden="true" />
                              <span role="timer" aria-label="Reservation remaining">Reserved · {seconds}s</span>
                            </span>
                          ) : (
                            <div className="reservation-retry">
                              <p className="checkout-error">
                                {hold?.status === 'expired' || hold?.status === 'active' && seconds === 0
                                  ? 'Reservation expired' : 'Reservation required'}
                              </p>
                              <button className="text-button" type="button" disabled={busy}
                                onClick={() => void reservations.changeQuantity(city, { productId, quantity }, true)}>
                                {reservations.workingProduct === productId ? 'Reserving…' : 'Reserve again'}
                              </button>
                            </div>
                          )
                        )}
                        {products && !reservations && <p className={quantity > stock ? 'checkout-error' : ''}>
                          {stock === 0 ? 'Out of stock. Remove this item to continue.'
                            : quantity > stock ? `Only ${stock} left. Reduce the quantity to continue.`
                              : `${stock} left in ${cities[city]}`}
                        </p>}
                      </div>
                      <div className="cart-controls">
                        <div className="quantity-stepper">
                          <button type="button" className="icon-button" aria-label={`Decrease ${name} quantity`}
                            disabled={busy || quantity <= 1} onClick={() => adjust(-1)}>−</button>
                          <span aria-label={`${name} quantity`}>{quantity}</span>
                          <button type="button" className="icon-button" aria-label={`Increase ${name} quantity`}
                            disabled={busy || quantity >= (reservations ? 99 : stock)} onClick={() => adjust(1)}>+</button>
                        </div>
                        <button type="button" className="text-button" aria-label={`Remove ${name}`}
                          disabled={busy} onClick={() => {
                            if (reservations) void reservations.remove(city, productId)
                            else onRemove(productId)
                          }}>Remove</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="checkout-summary">
                <p className="checkout-subtotal">Subtotal <strong>{products && lines.every(({ product }) => product) ? formatPrice(subtotal) : '—'}</strong></p>
                <button type="button" className="primary-button" disabled={!canCheckout || busy} onClick={checkout}>
                  {pending || reservations?.busy && reservations.pending?.kind === 'checkout' ? 'Placing order…' : isMockMode ? 'Place mock order' : 'Place order'}
                </button>
              </div>
              {pending && <p className="sr-only" role="status">Placing your order…</p>}
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}
