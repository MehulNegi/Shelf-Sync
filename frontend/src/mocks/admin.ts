import type { AdminInventoryRow, AdminSnapshot, InventoryQuery, StockStatus } from '../types/admin'
import { cities, type City } from '../types/products'

const cityKeys = Object.keys(cities) as City[]
const products = [
  { productId: 'sample-earphones', name: 'Wireless Bluetooth Earphones', category: 'electronics', price: 1999, stock: [12, 3, 8] },
  { productId: 'sample-shirt', name: 'Classic Checked Shirt', category: 'apparel', price: 1099, stock: [4, 10, 0] },
  { productId: 'sample-honey', name: 'Wildflower Honey', category: 'groceries', price: 349, stock: [0, 20, 5] },
]
const threshold = 5
const stockStatus = (stock: number): StockStatus => stock === 0 ? 'out_of_stock' : stock <= threshold ? 'low_stock' : 'in_stock'

export function demoInventoryRows(): AdminInventoryRow[] {
  return products.flatMap(({ stock, ...product }) => cityKeys.map((city, index) => ({
    ...product, city, stock: stock[index], stockStatus: stockStatus(stock[index]),
  })))
}

export function demoStockUpdate(rows: AdminInventoryRow[], target: AdminInventoryRow, stock: number) {
  if (!Number.isSafeInteger(stock) || stock < 0) return rows
  return rows.map((row) => row.productId === target.productId && row.city === target.city
    ? { ...row, stock, stockStatus: stockStatus(stock) } : row)
}

export function demoAdminSnapshot(rows: AdminInventoryRow[], query: InventoryQuery, now = new Date()): AdminSnapshot {
  const asOf = now.toISOString()
  const midnight = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
  const startsAt = new Date(`${midnight}T00:00:00+05:30`)
  const endsAt = new Date(startsAt.getTime() + 86_400_000)
  const orders: AdminSnapshot['orders']['orders'] = [
    { orderId: 'demo-order-003', createdAt: asOf, city: 'delhi', total: 1999, status: 'confirmed' },
    { orderId: 'demo-order-002', createdAt: new Date(now.getTime() - 1_800_000).toISOString(), city: 'pune', total: 1099, status: 'pending' },
    { orderId: 'demo-order-001', createdAt: new Date(now.getTime() - 86_400_000).toISOString(), city: 'bengaluru', total: 698, status: 'cancelled' },
  ]
  const filtered = rows.filter((row) => (!query.city || row.city === query.city) &&
    (!query.category || row.category === query.category.trim().toLowerCase()) &&
    (!query.stockStatus || row.stockStatus === query.stockStatus))
  const demoCursor = /^demo:(\d+)$/.exec(query.cursor ?? '')
  const offset = demoCursor ? Math.min(filtered.length, Number(demoCursor[1])) : 0
  const next = offset + query.limit
  return {
    overview: {
      asOf, lowStockThreshold: threshold, outboxBacklog: 0, totalStockUnits: rows.reduce((sum, row) => sum + row.stock, 0),
      lowStockRecords: rows.filter((row) => row.stockStatus === 'low_stock').length,
      outOfStockRecords: rows.filter((row) => row.stockStatus === 'out_of_stock').length,
      ordersToday: { count: orders.filter((order) => Date.parse(order.createdAt) >= startsAt.getTime()).length, date: midnight,
        timeZone: 'Asia/Kolkata', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      inventoryByCity: cityKeys.map((city) => {
        const local = rows.filter((row) => row.city === city)
        return { city, stockUnits: local.reduce((sum, row) => sum + row.stock, 0),
          lowStockRecords: local.filter((row) => row.stockStatus === 'low_stock').length,
          outOfStockRecords: local.filter((row) => row.stockStatus === 'out_of_stock').length }
      }),
    },
    inventory: { asOf, inventory: filtered.slice(offset, next), page: { limit: query.limit, nextCursor: next < filtered.length ? `demo:${next}` : null } },
    orders: { asOf, orders, page: { limit: 10, nextCursor: null } },
    events: { asOf, events: [], page: { limit: 10, nextCursor: null } },
  }
}
