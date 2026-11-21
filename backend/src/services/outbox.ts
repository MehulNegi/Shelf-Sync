import type { Pool } from 'pg';
import { parseInventoryEvent } from '../types/inventory-event.js';

export const inventoryTopic = 'inventory-events';
export interface OutboxMessage { topic: string; key: string; value: string }
export interface EventProducer {
  connect(): Promise<void>;
  publish(message: OutboxMessage): Promise<void>;
  disconnect(): Promise<void>;
}
export class OutboxError extends Error {
  constructor(public readonly eventId: string | undefined, public readonly reason: 'invalid_event' | 'kafka_publish' | 'database' = 'database') {
    super('Outbox publication failed; the event remains pending for retry');
  }
}

interface OutboxRow { id: string; event_type: string; payload: Record<string, unknown> }
function message(row: OutboxRow): OutboxMessage {
  const p = row.payload;
  try {
    parseInventoryEvent(p);
    if (p.eventId !== row.id || p.type !== row.event_type) throw new Error();
  } catch { throw new OutboxError(row.id, 'invalid_event'); }
  return { topic: inventoryTopic, key: `${p.productId}:${p.city}`, value: JSON.stringify(p) };
}

// A row remains locked through Kafka acknowledgement and the PostgreSQL commit.
// A crash between those operations can duplicate a message, but cannot lose it.
export async function publishNext(pool: Pool, producer: EventProducer, signal: AbortSignal): Promise<string | undefined> {
  if (signal.aborted) return undefined;
  const client = await pool.connect();
  let eventId: string | undefined;
  let reason: 'kafka_publish' | 'database' = 'database';
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const { rows } = await client.query<OutboxRow>(`SELECT id, event_type, payload FROM outbox_events
      WHERE published_at IS NULL ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = rows[0];
    if (!row || signal.aborted) {
      await client.query('ROLLBACK');
      return undefined;
    }
    eventId = row.id;
    const outgoing = message(row);
    reason = 'kafka_publish';
    await producer.publish(outgoing);
    reason = 'database';
    const updated = await client.query('UPDATE outbox_events SET published_at = clock_timestamp() WHERE id = $1 AND published_at IS NULL', [eventId]);
    if (updated.rowCount !== 1) throw new OutboxError(eventId);
    await client.query('COMMIT');
    return eventId;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error instanceof OutboxError ? error : new OutboxError(eventId, reason);
  } finally { client.release(discard); }
}
