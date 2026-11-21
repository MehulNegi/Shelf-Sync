import type { OrderStatus, TrackingEvent } from '../types/orders'

const trackingStages = ['confirmed', 'processing', 'shipped', 'delivered'] as const

const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pending',
  cancelled: 'Cancelled',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
}

export function orderStatusLabel(status: OrderStatus): string {
  return statusLabels[status] ?? 'Status unavailable'
}

export function orderTracking(status: OrderStatus, history: readonly TrackingEvent[] = []) {
  const current = trackingStages.findIndex((stage) => stage === status)
  const observed = new Map<OrderStatus, string | null>()
  for (const event of history) {
    if (event.occurredAt !== null || !observed.has(event.status)) {
      observed.set(event.status, event.occurredAt)
    }
  }

  return trackingStages.map((stage, index) => {
    const completed = observed.has(stage) && (index < current || status === 'cancelled')
    const state = index === current ? 'current' : completed ? 'completed' : 'pending'
    return {
      label: statusLabels[stage],
      state,
      occurredAt: state === 'pending' ? null : (observed.get(stage) ?? null),
    }
  })
}

export function sortOrderIds(ids: readonly string[], dates: ReadonlyMap<string, string>): string[] {
  return [...ids].sort((left, right) => {
    const leftDate = dates.get(left)
    const rightDate = dates.get(right)
    if (leftDate && rightDate) return Date.parse(rightDate) - Date.parse(leftDate)
    if (leftDate) return -1
    return rightDate ? 1 : 0
  })
}

export function formatOrderDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}
