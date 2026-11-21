import { ApiError } from '../services/api-error'
import type { OrderCreated, OrderDetails, OrderRequest } from '../types/orders'
import { mockProduct, reduceMockStock } from './products'

const orders = new Map<string, OrderDetails>()
let nextId = 1

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
  const id = `ord_mock_${nextId++}`
  for (const { productId, quantity } of lines) reduceMockStock(productId, city, quantity)
  orders.set(id, { id, city, status: 'confirmed', total, items: lines })
  return { success: true, orderId: id, status: 'confirmed', total }
}

export function mockGetOrder(id: string): OrderDetails {
  const order = orders.get(id)
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  return order
}
