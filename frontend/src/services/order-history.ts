import { baseUrl, isMockMode } from './backend'

type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>

const key = `shelfsync.order-ids.v1:${isMockMode ? 'mock' : `live:${baseUrl}`}`
let orderIds: string[] = []

function readOrderIds(storage: HistoryStorage): string[] {
  const saved: unknown = JSON.parse(storage.getItem(key) ?? '[]')
  return Array.isArray(saved)
    ? [...new Set(saved.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))]
    : []
}

export function getOrderIds(): string[] {
  try {
    const saved = readOrderIds(window.localStorage)
    return [...new Set([...orderIds, ...saved])]
  } catch {
    return orderIds
  }
}

export function rememberOrder(id: string) {
  const previous = getOrderIds()
  if (previous.includes(id)) return

  orderIds = [id, ...previous]
  try {
    window.localStorage.setItem(key, JSON.stringify(orderIds))
    orderIds = []
  } catch {
    // Keep the reference available for the current session if storage is blocked.
  }
}
