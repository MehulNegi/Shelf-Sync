import { readOrderPanel, type AdminPanel } from './admin'
import { ApiError } from './api-error'
import { isMockMode } from './backend'
import type { AdminOrderRow, AdminSnapshot } from '../types/admin'

const configuredPath: string | undefined = import.meta.env.VITE_DEMO_ORDERS_API_PATH

export function retailerOrderPath(path: string | undefined, cursor?: string) {
  const endpoint = path?.trim() || '/api/admin/orders'
  if (!/^\/api\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(endpoint)) {
    throw new ApiError(0, 'INVALID_ORDER_FEED', 'The order feed must use a relative /api path.')
  }
  const params = new URLSearchParams({ limit: '10' })
  if (cursor) params.set('cursor', cursor)
  return `${endpoint.slice(5)}?${params}`
}

export function newestOrders(rows: AdminOrderRow[]) {
  const sorted = rows.map(({ orderId, city, createdAt, status, total }) => ({ orderId, city, createdAt, status, total }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.orderId.localeCompare(a.orderId))
  const seen = new Set<string>()
  return sorted.filter(({ orderId }) => {
    if (seen.has(orderId)) return false
    seen.add(orderId)
    return true
  })
}

export async function loadRetailerOrders(cursor: string | undefined, signal: AbortSignal): Promise<AdminPanel<AdminSnapshot['orders']>> {
  if (isMockMode) return { source: 'demo' } as const
  const panel = await readOrderPanel(retailerOrderPath(configuredPath, cursor), signal)
  if (panel.source !== 'live') return panel
  const { asOf, orders, page } = panel.data
  return { source: 'live', data: { asOf, orders: newestOrders(orders), page: { limit: page.limit, nextCursor: page.nextCursor } } } as const
}
