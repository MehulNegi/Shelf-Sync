import { cities, type City } from './product.js';

export interface InventoryEvent {
  eventId: string; type: 'inventory.changed'; schemaVersion: 1;
  productId: string; city: City; quantity: number; inventoryVersion: number; occurredAt: string;
}
export class InvalidInventoryEvent extends Error {
  constructor() { super('Invalid inventory event; offset remains uncommitted'); }
}
export function parseInventoryEvent(value: unknown): InventoryEvent {
  if (!value || typeof value !== 'object') throw new InvalidInventoryEvent();
  const p = value as Record<string, unknown>;
  if (typeof p.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.eventId) ||
      p.type !== 'inventory.changed' || p.schemaVersion !== 1 || typeof p.productId !== 'string' || p.productId.length === 0 ||
      !cities.some(city => city === p.city) || !Number.isSafeInteger(p.quantity) || Number(p.quantity) < 0 ||
      !Number.isSafeInteger(p.inventoryVersion) || Number(p.inventoryVersion) < 1 ||
      typeof p.occurredAt !== 'string' || !Number.isFinite(Date.parse(p.occurredAt))) throw new InvalidInventoryEvent();
  return p as unknown as InventoryEvent;
}
