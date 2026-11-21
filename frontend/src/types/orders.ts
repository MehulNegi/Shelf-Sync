import type { City } from './products'

export interface OrderItem {
  productId: string
  quantity: number
}

export interface OrderRequest {
  city: City
  items: OrderItem[]
}

export interface OrderCreated {
  success: true
  orderId: string
  status: 'confirmed'
  total: number
}

export type OrderStatus = 'pending' | 'cancelled' | 'confirmed' | 'processing' | 'shipped' | 'delivered'

export interface OrderDetails {
  id: string
  city: City
  status: OrderStatus
  total: number
  items: (OrderItem & { name: string; unitPrice: number })[]
}

export type PersistedOrderStatus = Extract<OrderStatus, 'pending' | 'confirmed' | 'cancelled'>

export interface TrackingEvent {
  status: PersistedOrderStatus
  occurredAt: string | null
  recordedAt: string
  source: 'order_created' | 'legacy_snapshot'
}

export interface OrderTrackingData {
  orderId: string
  status: PersistedOrderStatus
  createdAt: string
  history: TrackingEvent[]
}
