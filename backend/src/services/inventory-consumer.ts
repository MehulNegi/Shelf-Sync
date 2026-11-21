import type { Consumer, EachBatchPayload } from 'kafkajs';
import { InvalidInventoryEvent, parseInventoryEvent, type InventoryEvent } from '../types/inventory-event.js';
import { inventoryTopic } from './outbox.js';
import { pause } from './publisher.js';
import { isTransientSearchError } from './search-projection.js';

export interface InventoryProjection { applyInventory(event: InventoryEvent): Promise<void> }
export type ConsumerLog = (entry: { event: string; eventId?: string; partition?: number; offset?: string; reason?: string; retryInMs?: number }) => void;

export async function processInventoryBatch(options: {
  payload: EachBatchPayload; consumer: Pick<Consumer, 'commitOffsets'>; projection: InventoryProjection;
  signal: AbortSignal; log: ConsumerLog; sleep?: typeof pause;
}) {
  const { payload, consumer, projection, signal, log } = options;
  const active = () => !signal.aborted && payload.isRunning() && !payload.isStale();
  for (const message of payload.batch.messages) {
    if (!active()) return;
    let event: InventoryEvent;
    try {
      event = parseInventoryEvent(JSON.parse(message.value?.toString() ?? 'null'));
      if (message.key?.toString() !== `${event.productId}:${event.city}`) throw new InvalidInventoryEvent();
    } catch {
      log({ event: 'consumer_blocked', reason: 'invalid_event', partition: payload.batch.partition, offset: message.offset });
      throw new InvalidInventoryEvent();
    }
    let attempts = 0;
    while (active()) {
      try { await projection.applyInventory(event); break; }
      catch (error) {
        if (!active()) return;
        if (!isTransientSearchError(error)) {
          log({ event: 'consumer_blocked', reason: 'opensearch_permanent', eventId: event.eventId, partition: payload.batch.partition, offset: message.offset });
          throw new Error('Permanent OpenSearch failure; offset remains uncommitted');
        }
        const retryInMs = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
        log({ event: 'consumer_retry', reason: 'opensearch_transient', eventId: event.eventId, retryInMs });
        // Keep the group alive during backoff; each client request also has a
        // short timeout and finite retries, below the 60-second session timeout.
        for (let remaining = retryInMs; remaining > 0 && active(); remaining -= 1000) {
          await payload.heartbeat();
          await (options.sleep ?? pause)(Math.min(1000, remaining), signal);
        }
      }
    }
    if (!active()) return;
    await payload.heartbeat();
    if (!active()) return;
    await consumer.commitOffsets([{ topic: payload.batch.topic, partition: payload.batch.partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    payload.resolveOffset(message.offset);
    log({ event: 'inventory_projected', eventId: event.eventId, partition: payload.batch.partition, offset: message.offset });
  }
}

export async function runInventoryConsumer(consumer: Consumer, projection: InventoryProjection, signal: AbortSignal, log: ConsumerLog) {
  let finish!: () => void;
  const stopped = new Promise<void>(resolve => { finish = resolve; });
  let crashed = false;
  const removeCrashListener = consumer.on(consumer.events.CRASH, () => { crashed = true; finish(); });
  signal.addEventListener('abort', finish, { once: true });
  try {
    if (signal.aborted) return;
    await consumer.connect();
    if (signal.aborted) return;
    await consumer.subscribe({ topic: inventoryTopic, fromBeginning: true });
    if (signal.aborted) return;
    await consumer.run({ autoCommit: false, eachBatchAutoResolve: false,
      eachBatch: payload => processInventoryBatch({ payload, consumer, projection, signal, log }) });
    log({ event: 'consumer_started' });
    if (!signal.aborted) await stopped;
    if (crashed) throw new Error('Inventory consumer stopped after processing failure; inspect sanitized worker logs');
  } finally {
    signal.removeEventListener('abort', finish);
    removeCrashListener();
    await consumer.disconnect();
    log({ event: 'consumer_stopped' });
  }
}
