import type { OrderItem } from '../types/orders'
import type { ReservationEnvelope, ReservationOperation, TimedReservation } from '../types/reservations'
import { cities, type City } from '../types/products'
import { ApiError } from './api-error'
import { isMockMode, requestJson } from './backend'

export const reservationsEnabled = !isMockMode && import.meta.env.VITE_CART_RESERVATIONS === 'true'

export function newOperationKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function startCartSession() {
  return requestJson<{ serverTime: string; sessionExpiresAt: string }>('/cart/session', [200, 201], {
    method: 'POST', credentials: 'include', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
}

async function readEnvelope(path: string, status: number, init: RequestInit) {
  const response = await requestJson<ReservationEnvelope>(path, status, init)
  assertEnvelope(response)
  return response
}

export async function getReservations() {
  return readEnvelope('/cart/reservations', 200, { credentials: 'include', redirect: 'error' })
}

export async function mutateReservation(operation: Exclude<ReservationOperation, { kind: 'checkout' }>) {
  const init = {
    credentials: 'include', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key },
  } as const
  switch (operation.kind) {
    case 'create':
      return readEnvelope('/cart/reservations', 201, {
        ...init, method: 'POST', body: JSON.stringify({ city: operation.city, items: [operation.item] }),
      })
    case 'update':
      return readEnvelope('/cart/reservations', 200, {
        ...init, method: 'PATCH', body: JSON.stringify({ city: operation.city, items: [{
          reservationId: operation.reservationId, quantity: operation.item.quantity,
        }] }),
      })
    default:
      return readEnvelope('/cart/reservations/release', 200, {
        ...init, method: 'POST', body: JSON.stringify({ reservationIds: operation.reservationIds }),
      })
  }
}

function assertEnvelope(response: ReservationEnvelope) {
  const date = (value: unknown) => typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value))
  if (!response || !date(response.serverTime) || !Array.isArray(response.reservations) ||
      response.reservations.some((row) => !row || typeof row.reservationId !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.reservationId) ||
        typeof row.productId !== 'string' || !row.productId || !Object.hasOwn(cities, row.city) ||
        !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99 ||
        !['active', 'expired', 'released', 'consumed'].includes(row.status) ||
        typeof row.requiresReservation !== 'boolean' ||
        (row.status === 'consumed' ? typeof row.orderId !== 'string' || !row.orderId : row.orderId !== null) ||
        !date(row.createdAt) || !date(row.expiresAt) || !date(row.updatedAt) ||
        Date.parse(row.expiresAt) <= Date.parse(row.createdAt))) {
    throw new ApiError(502, 'INVALID_RESERVATION', 'The store returned invalid reservation data.')
  }
}

export function timedReservations(response: ReservationEnvelope, requestedAt: number, previous: TimedReservation[]) {
  const serverTime = Date.parse(response.serverTime)
  return response.reservations.map((row) => {
    const deadline = requestedAt + Date.parse(row.expiresAt) - serverTime
    const old = previous.find((entry) => entry.reservationId === row.reservationId)
    return { ...row, deadline: old ? Math.min(old.deadline, deadline) : deadline }
  })
}

export function remainingSeconds(hold: TimedReservation | undefined, now: number) {
  return hold?.status === 'active' ? Math.max(0, Math.ceil((hold.deadline - now) / 1000)) : 0
}

export type ReservationDisplay = { status: 'active'; seconds: number } | { status: 'expired' }

export function reservationDisplay(
  holds: TimedReservation[],
  city: City,
  { productId, quantity }: OrderItem,
  now: number,
): ReservationDisplay | undefined {
  if (quantity < 1) return
  const hold = holds.find((row) => row.city === city && row.productId === productId)
  if (!hold) return
  const seconds = remainingSeconds(hold, now)
  if (seconds > 0 && hold.quantity === quantity) return { status: 'active', seconds }
  if (hold.status === 'expired' || (hold.status === 'active' && seconds === 0)) return { status: 'expired' }
}

export function checkoutReservationIds(city: City, items: OrderItem[], holds: TimedReservation[], now: number) {
  if (!items.length || items.length > 20) return null
  const ids = items.map((item) => holds.find((row) =>
    row.city === city && row.productId === item.productId && row.quantity === item.quantity && remainingSeconds(row, now) > 0,
  )?.reservationId)
  return new Set(ids).size === ids.length && ids.every((id): id is string => Boolean(id)) ? ids : null
}

export function reservationError(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'INSUFFICIENT_STOCK': return 'This quantity is unavailable. Another customer may have reserved it.'
      case 'RESERVATION_EXPIRED': return 'A reservation expired. Reserve the item again before checkout.'
      case 'RESERVATION_NOT_ACTIVE':
      case 'RESERVATION_MISMATCH':
      case 'RESERVATION_CONSUMED':
      case 'RESERVATION_NOT_FOUND': return 'Your reservations changed. Review your cart before trying again.'
      case 'RESERVATION_EXISTS': return 'This item already has a hold in your browser session. Review the updated cart.'
      case 'RESERVATION_CITY_CONFLICT': return 'Release active holds in the other city before reserving here.'
      case 'RESERVATION_LIMIT': return 'Your cart has reached its reservation limit.'
      case 'RESERVATION_COOLDOWN':
      case 'RESERVATION_RATE_LIMITED':
        return error.retryAfterSeconds
          ? `Try reserving again in ${error.retryAfterSeconds} seconds.`
          : 'Wait a moment before trying to reserve again.'
      case 'CART_SESSION_REQUIRED': return 'The cart session is no longer available. Review your holds before trying again.'
      case 'CART_ORIGIN_FORBIDDEN': return 'This storefront address is not allowed to use cart reservations.'
      case 'RESERVATIONS_DISABLED': return 'Cart reservations are unavailable on this backend.'
    }
    if (error.status === 404) return 'Cart reservations are unavailable on this backend.'
  }
  return 'Couldn’t verify your cart with the store. Try again.'
}

export function isUncertainReservation(error: unknown) {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500 && error.code !== 'RESERVATIONS_DISABLED'
}
