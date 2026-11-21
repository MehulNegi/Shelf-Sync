import { mockGetOrder, mockPlaceOrder } from '../mocks/orders'
import type { OrderCreated, OrderDetails, OrderRequest } from '../types/orders'
import { ApiError } from './api-error'
import { isMockMode, requestJson } from './backend'
import { rememberOrder } from './order-history'

interface ReservedCheckout {
  reservationIds: string[]
  key: string
}

export async function placeOrder({ city, items }: OrderRequest, hold?: ReservedCheckout): Promise<OrderCreated> {
  const order = { city, items: items.map(({ productId, quantity }) => ({ productId, quantity })) }
  const confirmation = isMockMode ? mockPlaceOrder(order) : await requestJson<OrderCreated>('/orders', 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(hold && { 'Idempotency-Key': hold.key }) },
    ...(hold && { credentials: 'include', redirect: 'error' }),
    body: JSON.stringify(hold ? { ...order, reservationIds: hold.reservationIds } : order),
  })
  if (confirmation?.success !== true || confirmation.status !== 'confirmed' ||
      typeof confirmation.orderId !== 'string' || !confirmation.orderId.trim() ||
      !Number.isFinite(confirmation.total)) {
    throw new ApiError(502, 'INVALID_CONFIRMATION', 'The store returned an invalid confirmation.')
  }
  rememberOrder(confirmation.orderId)
  return confirmation
}

export async function getOrder(id: string, signal: AbortSignal): Promise<OrderDetails> {
  if (isMockMode) return mockGetOrder(id)
  return requestJson<OrderDetails>(`/orders/${encodeURIComponent(id)}`, 200, { signal })
}
