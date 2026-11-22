import type { AdminPanel } from './admin'
import { ApiError } from './api-error'
import { isMockMode, requestJson } from './backend'
import type { AdminOrderRow } from '../types/admin'
import { cities } from '../types/products'

function parseOrder(value: unknown): AdminOrderRow {
  if (value && typeof value === 'object') {
    const { id, city, status, total, created_at } = value as Record<string, unknown>
    if (typeof id === 'string' && id.trim() && typeof city === 'string' && Object.hasOwn(cities, city) &&
      (status === 'confirmed' || status === 'pending' || status === 'cancelled') &&
      typeof total === 'number' && Number.isFinite(total) && total >= 0 &&
      typeof created_at === 'string' && Number.isFinite(Date.parse(created_at))) {
      return { orderId: id, city: city as AdminOrderRow['city'], status, total, createdAt: created_at }
    }
  }
  throw invalidFeed()
}

function invalidFeed() {
  return new ApiError(502, 'INVALID_ORDER_FEED', 'The order feed returned an invalid response.')
}

export async function loadRetailerOrders(signal: AbortSignal): Promise<AdminPanel<AdminOrderRow[]>> {
  if (isMockMode) return { source: 'demo' }
  try {
    const feed = await requestJson<{ orders?: unknown }>('/demo/orders', 200, { signal, credentials: 'omit', redirect: 'error' })
    if (!Array.isArray(feed?.orders)) throw invalidFeed()

    const sorted = feed.orders.map(parseOrder)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const seen = new Set<string>()
    return { source: 'live', data: sorted.filter(({ orderId }) => {
      if (seen.has(orderId)) return false
      seen.add(orderId)
      return true
    }) }
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError && error.status === 503 && error.code === 'DEMO_ORDERS_DISABLED') return { source: 'demo' }
    return { source: 'unavailable', error: error instanceof SyntaxError ? invalidFeed() : error }
  }
}
