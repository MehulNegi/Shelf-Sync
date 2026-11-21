import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { City } from '../types/product.js';
import type { InventoryCause } from '../types/inventory-event.js';

export interface InventoryKey { productId: string; city: City }
export const keyOf = (key: InventoryKey) => JSON.stringify([key.productId, key.city]);
export class InventoryTransaction {
  readonly changed = new Map<string, { key: InventoryKey; causes: Set<InventoryCause> }>();
  private constructor(readonly client: PoolClient, readonly keys: InventoryKey[], readonly now: string) {}
  static async lock(client: PoolClient, keys: InventoryKey[], skipLocked = false) {
    const unique = [...new Map(keys.map(key => [keyOf(key), key])).values()];
    const { rows } = await client.query<{ product_id: string; city: City }>(`SELECT i.product_id, i.city FROM inventory i
      JOIN unnest($1::text[], $2::text[]) k(product_id, city) USING (product_id, city)
      ORDER BY i.product_id COLLATE "C", i.city COLLATE "C" FOR UPDATE OF i ${skipLocked ? 'SKIP LOCKED' : ''}`,
    [unique.map(k => k.productId), unique.map(k => k.city)]);
    // A fresh statement/snapshot and real DB clock AFTER all row-lock waits.
    const time = (await client.query<{ time: string }>('SELECT clock_timestamp()::text AS time')).rows[0]!.time;
    return new InventoryTransaction(client, rows.map(r => ({ productId: r.product_id, city: r.city })), time);
  }
  mark(key: InventoryKey, cause: InventoryCause) {
    const entry = this.changed.get(keyOf(key)) ?? { key, causes: new Set<InventoryCause>() };
    entry.causes.add(cause); this.changed.set(keyOf(key), entry);
  }
  async reconcile() {
    const {rows}=await this.client.query<{product_id:string;city:City}>(`UPDATE cart_reservations r SET state='expired',updated_at=$3
      FROM unnest($1::text[],$2::text[]) k(product_id,city)
      WHERE r.product_id=k.product_id AND r.city=k.city AND r.state='active' AND r.expires_at<=$3
      RETURNING r.product_id,r.city`,[this.keys.map(k=>k.productId),this.keys.map(k=>k.city),this.now]);
    for (const row of rows) this.mark({productId:row.product_id,city:row.city},'reservation.expired');
  }
  async snapshot(key: InventoryKey) {
    const { rows } = await this.client.query<{ quantity: number; version: string; reserved: string; next: string | null }>(`SELECT i.quantity, i.version::text,
      COALESCE(sum(r.quantity),0)::text AS reserved, min(r.expires_at)::text AS next
      FROM inventory i LEFT JOIN cart_reservations r ON r.product_id=i.product_id AND r.city=i.city AND r.state='active' AND r.expires_at > $3
      WHERE i.product_id=$1 AND i.city=$2 GROUP BY i.product_id, i.city`, [key.productId, key.city, this.now]);
    const row = rows[0];
    if (!row) return undefined;
    const reserved = Number(row.reserved);
    const available = row.quantity - reserved;
    if (available < 0 || !Number.isSafeInteger(reserved)) throw new Error('Inventory reservation invariant failed');
    return { quantity: row.quantity, reserved, available, version: Number(row.version), next: row.next };
  }
  async flush() {
    for (const { key, causes } of this.changed.values()) {
      await this.client.query('UPDATE inventory SET version=version+1, updated_at=$3 WHERE product_id=$1 AND city=$2', [key.productId, key.city, this.now]);
      const row = (await this.snapshot(key))!;
      if (!Number.isSafeInteger(row.version)) throw new Error('Inventory version exceeds JSON safe range');
      const eventId = randomUUID();
      const event = { eventId, type: 'inventory.changed', schemaVersion: 2, productId: key.productId, city: key.city,
        quantity: row.quantity, reservedQuantity: row.reserved, availableQuantity: row.available, inventoryVersion: row.version,
        occurredAt: new Date(this.now).toISOString(), nextExpirationAt: row.next ? new Date(row.next).toISOString() : null, causes: [...causes].sort() };
      await this.client.query('INSERT INTO outbox_events(id,event_type,payload,created_at) VALUES ($1,$2,$3,$4)', [eventId, event.type, event, this.now]);
    }
  }
}
