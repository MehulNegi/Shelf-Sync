import type { OrderItem, OrderRequest } from './orders'
import type { City } from './products'

export interface Reservation {
  reservationId: string
  productId: string
  city: City
  quantity: number
  status: 'active' | 'expired' | 'released' | 'consumed'
  createdAt: string
  expiresAt: string
  updatedAt: string
  requiresReservation: boolean
  orderId: string | null
}

export interface ReservationEnvelope {
  serverTime: string
  reservations: Reservation[]
}

export type ReservationOperation = { key: string } & (
  | { kind: 'create'; city: City; item: OrderItem }
  | { kind: 'update'; city: City; item: OrderItem; reservationId: string }
  | { kind: 'remove'; city: City; productId: string; reservationIds: string[] }
  | { kind: 'switch'; city: City; reservationIds: string[] }
  | { kind: 'checkout'; order: OrderRequest; reservationIds: string[] }
)

export interface TimedReservation extends Reservation {
  deadline: number
}
