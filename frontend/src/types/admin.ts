import type { PersistedOrderStatus } from './orders'
import type { City } from './products'

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'

export interface AdminOverview {
  asOf: string
  lowStockThreshold: number
  totalStockUnits: number
  lowStockRecords: number
  outOfStockRecords: number
  ordersToday: { count: number; date: string; timeZone: string; startsAt: string; endsAt: string }
  inventoryByCity: { city: City; stockUnits: number; lowStockRecords: number; outOfStockRecords: number }[]
  outboxBacklog: number
}

export interface AdminInventoryRow {
  productId: string
  name: string
  category: string
  city: City
  stock: number
  price: number
  stockStatus: StockStatus
}

export interface AdminOrderRow {
  orderId: string
  createdAt: string
  city: City
  total: number
  status: PersistedOrderStatus
}

export interface AdminEventRow {
  eventId: string
  eventType: string
  orderId: string | null
  productId: string | null
  city: City | null
  createdAt: string
  publicationState: 'pending' | 'published'
  publishedAt: string | null
}

interface PagedResponse {
  asOf: string
  page: { limit: number; nextCursor: string | null }
}

export interface AdminSnapshot {
  overview: AdminOverview
  inventory: PagedResponse & { inventory: AdminInventoryRow[] }
  orders: PagedResponse & { orders: AdminOrderRow[] }
  events: PagedResponse & { events: AdminEventRow[] }
}

export interface InventoryQuery {
  city?: City
  category?: string
  stockStatus?: StockStatus
  limit: number
  cursor?: string
}
