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

export interface OrderDetails {
  id: string
  city: City
  status: 'confirmed'
  total: number
  items: (OrderItem & { name: string; unitPrice: number })[]
}
