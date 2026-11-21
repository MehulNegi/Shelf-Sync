import type { OrderStatus, OrderTrackingData, TrackingEvent } from '../types/orders'
import { ApiError } from './api-error'
import { requestJson } from './backend'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStatus(value: unknown): value is OrderStatus {
  return value === 'pending' || value === 'confirmed' || value === 'cancelled' ||
    value === 'processing' || value === 'shipped' || value === 'delivered'
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function isTrackingEvent(value: unknown): value is TrackingEvent {
  return isRecord(value) && isStatus(value.status) &&
    (value.occurredAt === null || isTimestamp(value.occurredAt)) && isTimestamp(value.recordedAt) &&
    typeof value.source === 'string' && value.source.trim() !== ''
}

function isTrackingData(value: unknown, id: string): value is OrderTrackingData {
  return isRecord(value) && value.orderId === id && isStatus(value.status) && isTimestamp(value.createdAt) &&
    Array.isArray(value.history) && value.history.every(isTrackingEvent)
}

function invalidTracking() {
  return new ApiError(502, 'INVALID_TRACKING', 'The store returned invalid tracking data.')
}

export async function getOrderTracking(id: string, signal: AbortSignal): Promise<OrderTrackingData | null> {
  let response: unknown
  try {
    response = await requestJson<unknown>(`/orders/${encodeURIComponent(id)}/tracking`, 200, { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    if (error instanceof SyntaxError) throw invalidTracking()
    throw error
  }

  if (!isTrackingData(response, id)) throw invalidTracking()
  return response
}
