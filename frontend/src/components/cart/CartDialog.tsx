import { useCallback, useRef, useState } from 'react'
import { useResource } from '../../hooks/use-resource'
import { formatPrice } from '../../lib/format-price'
import { ApiError, checkoutErrorMessage } from '../../services/api-error'
import { isMockMode } from '../../services/backend'
import { placeOrder } from '../../services/orders'
import { getProduct } from '../../services/products'
import type { OrderCreated, OrderItem } from '../../types/orders'
import { cities, type City } from '../../types/products'
import { Dialog } from '../ui/dialog'
import { OrderConfirmation } from './OrderConfirmation'

interface CartDialogProps {
  city: City
  items: OrderItem[]
  onAdjust: (productId: string, delta: number, stock: number) => void
  onRemove: (productId: string) => void
  onPlaced: () => void
  refreshCatalog: () => void
  onClose: () => void
}

export function CartDialog({ city, items, onAdjust, onRemove, onPlaced, refreshCatalog, onClose }: CartDialogProps) {
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [message, setMessage] = useState('')
  const [order, setOrder] = useState<OrderCreated>()
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
  const result = useResource(load, attempt)
  const products = result && 'data' in result ? result.data : undefined
  const lines = items.map((item, index) => ({ ...item, product: products?.[index] }))
  const canCheckout = Boolean(items.length && products && lines.every(({ quantity, product }) =>
    product?.available && quantity <= product.stock,
  ))
  const subtotal = lines.reduce((sum, { quantity, product }) => sum + (product?.price ?? 0) * quantity, 0)

  async function checkout() {
    if (submitting.current || !canCheckout) return
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
    <Dialog title={order ? 'Order confirmation' : `Cart · ${cities[city]}`} onClose={onClose} busy={pending}>
      {order ? <OrderConfirmation order={order} onClose={onClose} /> : (
        <div className="checkout-content">
          <p>Each city has its own cart. Switch cities to browse your other carts.</p>
          {isMockMode && <p className="mock-notice">Mock checkout · Orders and stock changes are simulated for this session.</p>}
          {message && <p className="checkout-error" role="alert">{message}</p>}
          {!items.length ? (
            <>
              <p>Your cart is empty.</p>
              <button type="button" className="primary-button" onClick={onClose}>Continue shopping</button>
            </>
          ) : (
            <>
              {!result && <p role="status">Checking cart availability…</p>}
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
                  return (
                    <li key={productId} className="cart-line">
                      <div>
                        <strong>{name}</strong>
                        {product && <p>{formatPrice(product.price)} each</p>}
                        {products && <p className={quantity > stock ? 'checkout-error' : ''}>
                          {stock === 0 ? 'Out of stock. Remove this item to continue.'
                            : quantity > stock ? `Only ${stock} left. Reduce the quantity to continue.`
                              : `${stock} left`}
                        </p>}
                      </div>
                      <div className="cart-controls">
                        <button type="button" className="icon-button" aria-label={`Decrease ${name} quantity`}
                          disabled={pending || quantity <= 1} onClick={() => onAdjust(productId, -1, stock)}>−</button>
                        <span aria-label={`${name} quantity`}>{quantity}</span>
                        <button type="button" className="icon-button" aria-label={`Increase ${name} quantity`}
                          disabled={pending || quantity >= stock} onClick={() => onAdjust(productId, 1, stock)}>+</button>
                        <button type="button" className="text-button" aria-label={`Remove ${name}`}
                          disabled={pending} onClick={() => onRemove(productId)}>Remove</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="checkout-summary">
                <p>Subtotal <strong>{products && lines.every(({ product }) => product) ? formatPrice(subtotal) : '—'}</strong></p>
                <button type="button" className="primary-button" disabled={!canCheckout || pending} onClick={checkout}>
                  {pending ? 'Placing order…' : isMockMode ? 'Place mock order' : 'Place order'}
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
