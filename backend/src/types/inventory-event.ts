import { cities, type City } from './product.js';

interface InventoryBase {
  eventId: string; type: 'inventory.changed';
  productId: string; city: City; quantity: number; inventoryVersion: number; occurredAt: string;
}
export type InventoryCause = 'reservation.created' | 'reservation.updated' | 'reservation.released' | 'reservation.expired' | 'checkout.confirmed';
export type InventoryEvent = InventoryBase & ({ schemaVersion: 1 } | {
  schemaVersion: 2; reservedQuantity: number; availableQuantity: number; nextExpirationAt: string | null; causes: InventoryCause[];
});
export class InvalidInventoryEvent extends Error {
  constructor() { super('Invalid inventory event; offset remains uncommitted'); }
}
export function parseInventoryEvent(value: unknown): InventoryEvent {
  if (!value || typeof value !== 'object') throw new InvalidInventoryEvent();
  const p = value as Record<string, unknown>;
  if (typeof p.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.eventId) ||
      p.type !== 'inventory.changed' || ![1, 2].includes(Number(p.schemaVersion)) || typeof p.productId !== 'string' || p.productId.length === 0 ||
      !cities.some(city => city === p.city) || !Number.isSafeInteger(p.quantity) || Number(p.quantity) < 0 ||
      !Number.isSafeInteger(p.inventoryVersion) || Number(p.inventoryVersion) < 1 ||
      typeof p.occurredAt !== 'string' || !Number.isFinite(Date.parse(p.occurredAt))) throw new InvalidInventoryEvent();
  if (p.schemaVersion !== 1 && p.schemaVersion !== 2) throw new InvalidInventoryEvent();
  const cutoff = process.env.INVENTORY_V1_CUTOFF_AT;
  if (cutoff && !Number.isFinite(Date.parse(cutoff))) throw new InvalidInventoryEvent();
  if (p.schemaVersion === 1 && cutoff && Date.parse(String(p.occurredAt)) >= Date.parse(cutoff)) throw new InvalidInventoryEvent();
  if (p.schemaVersion === 2) {
    const causes = ['reservation.created', 'reservation.updated', 'reservation.released', 'reservation.expired', 'checkout.confirmed'];
    if (!Number.isSafeInteger(p.reservedQuantity) || Number(p.reservedQuantity) < 0 ||
        !Number.isSafeInteger(p.availableQuantity) || Number(p.availableQuantity) < 0 ||
        Number(p.quantity) !== Number(p.reservedQuantity) + Number(p.availableQuantity) ||
        !(p.nextExpirationAt === null || (typeof p.nextExpirationAt === 'string' && Number.isFinite(Date.parse(p.nextExpirationAt)))) ||
        !Array.isArray(p.causes) || p.causes.length === 0 || new Set(p.causes).size !== p.causes.length ||
        !p.causes.every(cause => typeof cause === 'string' && causes.includes(cause)) ||
        ((Number(p.reservedQuantity) === 0) !== (p.nextExpirationAt === null))) throw new InvalidInventoryEvent();
  }
  return p as unknown as InventoryEvent;
}
