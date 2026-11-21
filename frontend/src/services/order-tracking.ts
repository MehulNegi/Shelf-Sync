import type { OrderStatus } from '../types/orders'

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

export function orderTracking(status: OrderStatus) {
  const current = trackingStages.findIndex((stage) => stage === status)

  return trackingStages.map((stage, index) => ({
    label: statusLabels[stage],
    state: index === current ? 'current' : index < current ? 'completed' : 'pending',
  } as const))
}
