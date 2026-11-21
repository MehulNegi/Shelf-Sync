import type { AdminOverview, AdminSnapshot, InventoryQuery } from '../types/admin'
import { cities } from '../types/products'
import { ApiError } from './api-error'
import { requestJson } from './backend'

export function isLocalAdminConfiguration(frontend: Location | URL, apiBase: string) {
  const loopback = ['localhost', '127.0.0.1', '[::1]']
  try {
    const api = new URL(apiBase)
    return frontend.protocol === 'http:' && loopback.includes(frontend.hostname) &&
      api.protocol === 'http:' && loopback.includes(api.hostname) && api.pathname === '/' &&
      !api.username && !api.password && !api.search && !api.hash
  } catch {
    return false
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown) => typeof value === 'string' && value.length > 0
const isCity = (value: unknown) => typeof value === 'string' && Object.hasOwn(cities, value)
const isAmount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isCount = (value: unknown) => isAmount(value) && Number.isSafeInteger(value)
const isTime = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+Z$/.test(value) && Number.isFinite(Date.parse(value))
const nullableText = (value: unknown) => value === null || isText(value)

function isOverview(value: unknown): value is AdminOverview {
  if (!isObject(value)) return false
  const today = value.ordersToday
  const byCity = value.inventoryByCity
  return isTime(value.asOf) && value.lowStockThreshold === 5 && isCount(value.totalStockUnits) &&
    isCount(value.lowStockRecords) && isCount(value.outOfStockRecords) && isCount(value.outboxBacklog) &&
    isObject(today) && isCount(today.count) && typeof today.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(today.date) && today.timeZone === 'Asia/Kolkata' &&
    isTime(today.startsAt) && isTime(today.endsAt) &&
    Array.isArray(byCity) && byCity.length === 3 &&
    byCity.every((row, index) => isObject(row) && row.city === Object.keys(cities)[index] &&
      isCount(row.stockUnits) && isCount(row.lowStockRecords) && isCount(row.outOfStockRecords))
}

type ListName = 'inventory' | 'orders' | 'events'

const isRow: Record<ListName, (row: Record<string, unknown>) => boolean> = {
  inventory: (row) => isText(row.productId) && isText(row.name) && isText(row.category) &&
    isCity(row.city) && isCount(row.stock) && isAmount(row.price) &&
    (row.stockStatus === 'in_stock' || row.stockStatus === 'low_stock' || row.stockStatus === 'out_of_stock'),
  orders: (row) => isText(row.orderId) && isTime(row.createdAt) && isCity(row.city) &&
    isAmount(row.total) && (row.status === 'pending' || row.status === 'confirmed' || row.status === 'cancelled'),
  events: (row) => isText(row.eventId) && isText(row.eventType) && nullableText(row.orderId) &&
    nullableText(row.productId) && (row.city === null || isCity(row.city)) && isTime(row.createdAt) &&
    (row.publicationState === 'pending' && row.publishedAt === null ||
      row.publicationState === 'published' && isTime(row.publishedAt)),
}

function isPage<K extends ListName>(value: unknown, name: K): value is AdminSnapshot[K] {
  if (!isObject(value) || !isTime(value.asOf) || !isObject(value.page)) return false
  const { limit, nextCursor } = value.page
  const rows = value[name]
  return typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 100 &&
    (nextCursor === null || typeof nextCursor === 'string' && nextCursor.length > 0 && nextCursor.length <= 2048) &&
    Array.isArray(rows) && rows.every((row) => isObject(row) && isRow[name](row))
}

async function readAdmin(path: string, signal: AbortSignal) {
  try {
    return await requestJson<unknown>(`/admin/${path}`, 200, { signal, credentials: 'omit', redirect: 'error' })
  } catch (error) {
    if (error instanceof SyntaxError) throw invalidResponse()
    throw error
  }
}

function invalidResponse() {
  return new ApiError(502, 'INVALID_ADMIN_RESPONSE', 'The backend returned an invalid dashboard response.')
}

export async function loadAdminSnapshot(query: InventoryQuery, signal: AbortSignal): Promise<AdminSnapshot> {
  const params = new URLSearchParams({ limit: String(query.limit) })
  for (const key of ['city', 'category', 'stockStatus', 'cursor'] as const) {
    const value = query[key]
    if (value) params.set(key, value)
  }
  const requests = await Promise.allSettled([
    readAdmin('overview', signal),
    readAdmin(`inventory?${params}`, signal),
    readAdmin('orders?limit=10', signal),
    readAdmin('events?limit=10', signal),
  ])
  const denied = requests.find((result) => result.status === 'rejected' && clearsAdminData(result.reason))
  if (denied?.status === 'rejected') throw denied.reason
  const [overview, inventory, orders, events] = requests.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
  if (!isOverview(overview) || !isPage(inventory, 'inventory') || !isPage(orders, 'orders') || !isPage(events, 'events')) {
    throw invalidResponse()
  }
  return { overview, inventory, orders, events }
}

export function clearsAdminData(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 ||
    error.status === 404 || error.code === 'ADMIN_DISABLED')
}

export function adminErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Admin authentication is required. Use the authorized backend in local-demo mode on this laptop.'
    if (error.status === 403) return 'Admin access was denied. Open the frontend from the exact localhost origin allowed by the backend.'
    if (error.status === 404 || error.code === 'ADMIN_DISABLED') return 'Admin monitoring is disabled. Start the backend with its authorized local-demo configuration.'
    if (error.status === 503 && error.code === 'DATABASE_UNAVAILABLE') return 'PostgreSQL is temporarily unavailable. Try refreshing when the database is reachable.'
    if (error.status === 503) return 'The admin service is temporarily unavailable. Check its local-demo configuration and try again.'
    if (error.code === 'INVALID_CURSOR') return 'This inventory page expired. Return to the first page to continue.'
    if (error.code === 'INVALID_ADMIN_RESPONSE') return error.message
    if (error.status === 0) return 'Couldn’t reach the admin API. Check that the local-demo backend is running on this laptop.'
  }
  return 'Couldn’t load operational data. Try refreshing.'
}
