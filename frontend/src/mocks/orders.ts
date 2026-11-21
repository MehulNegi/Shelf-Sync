import { ApiError } from '../services/api-error'
import type { OrderCreated, OrderDetails, OrderRequest } from '../types/orders'
import { mockProduct, reduceMockStock } from './products'

const orders = new Map<string, OrderDetails>()
const mockOrderPrefix = 'shelfsync.mock-order.v1:'

function saveMockOrder(order: OrderDetails) {
  orders.set(order.id, order)
  try {
    window.localStorage.setItem(mockOrderPrefix + order.id, JSON.stringify(order))
  } catch {
    // The mock order is still available for the current session.
  }
}

export function mockPlaceOrder({ city, items }: OrderRequest): OrderCreated {
  if (!items.length || new Set(items.map((item) => item.productId)).size !== items.length) {
    throw new ApiError(400, 'INVALID_ORDER', 'Choose at least one product and list each product once.')
  }

  const lines = items.map(({ productId, quantity }) => {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new ApiError(400, 'INVALID_ORDER', 'Choose a whole quantity for each product.')
    }
    const product = mockProduct(productId, city)
    if (!product.available || quantity > product.stock) {
      throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Not enough stock available.')
    }
    return { productId, quantity, name: product.name, unitPrice: product.price }
  })

  const total = lines.reduce((sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity, 0) / 100
  const suffix = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
    part.toString(16).padStart(8, '0'),
  ).join('')
  const id = `ord_mock_${suffix}`
  for (const { productId, quantity } of lines) reduceMockStock(productId, city, quantity)
  saveMockOrder({ id, city, status: 'confirmed', total, items: lines })
  return { success: true, orderId: id, status: 'confirmed', total }
}

export function mockGetOrder(id: string): OrderDetails {
  let order = orders.get(id)
  if (!order) {
    try {
      const saved: OrderDetails | null = JSON.parse(window.localStorage.getItem(mockOrderPrefix + id) ?? 'null')
      if (saved?.id === id && saved.status === 'confirmed' && Array.isArray(saved.items)) order = saved
    } catch {
      // Unavailable or unreadable storage is treated as a missing mock order.
    }
  }
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  return order
}
