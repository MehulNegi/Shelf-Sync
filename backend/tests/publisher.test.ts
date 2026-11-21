import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { publishNext, type EventProducer, type OutboxMessage } from '../src/services/outbox.js';
import { pause, retryDelay, runPublisher } from '../src/services/publisher.js';

const settings = { batchSize: 2, pollIntervalMs: 10, retryInitialMs: 100, retryMaxMs: 1000 };
function fixture() {
  const id = randomUUID();
  const payload = { eventId: id, type: 'inventory.changed', schemaVersion: 1, productId: 'prod_001', city: 'pune', quantity: 0, inventoryVersion: 8, occurredAt: new Date().toISOString() };
  const calls: string[] = [];
  let pending = true;
  let marked = false;
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push(sql);
      if (sql.startsWith('SELECT')) return { rows: pending ? [{ id, event_type: 'inventory.changed', payload }] : [], rowCount: pending ? 1 : 0 };
      if (sql.startsWith('UPDATE')) { assert.deepEqual(values, [id]); marked = true; return { rowCount: 1 }; }
      if (sql === 'COMMIT' && marked) { pending = false; marked = false; }
      if (sql === 'ROLLBACK') marked = false;
      return { rows: [], rowCount: 0 };
    },
    release(discard: boolean) { calls.push(discard ? 'discard' : 'release'); }
  };
  const pool = { async connect() { return client; }, async end() { calls.push('pool_end'); } } as unknown as Pool;
  const messages: OutboxMessage[] = [];
  const producer: EventProducer = {
    async connect() { calls.push('kafka_connect'); },
    async publish(message) { calls.push('kafka_ack'); messages.push(message); },
    async disconnect() { calls.push('kafka_disconnect'); }
  };
  return { id, payload, calls, pool, producer, messages, isPending: () => pending };
}

test('pending event payload and key are preserved, and ACK precedes database marking', async () => {
  const f = fixture();
  assert.equal(await publishNext(f.pool, f.producer, new AbortController().signal), f.id);
  assert.deepEqual(f.messages, [{ topic: 'inventory-events', key: 'prod_001:pune', value: JSON.stringify(f.payload) }]);
  assert.match(f.calls.find(sql => sql.startsWith('SELECT'))!, /LIMIT 1 FOR UPDATE SKIP LOCKED/);
  assert.ok(f.calls.indexOf('kafka_ack') < f.calls.findIndex(sql => sql.startsWith('UPDATE')));
  assert.ok(f.calls.findIndex(sql => sql.startsWith('UPDATE')) < f.calls.indexOf('COMMIT'));
  assert.equal(f.isPending(), false);
  assert.equal(await publishNext(f.pool, f.producer, new AbortController().signal), undefined);
  assert.equal(f.messages.length, 1);
});

test('Kafka failure rolls back and repeated polling retries the same event', async () => {
  const f = fixture();
  const broken = { ...f.producer, async publish() { throw new Error('private broker or credentials'); } };
  await assert.rejects(publishNext(f.pool, broken, new AbortController().signal), error => error instanceof Error && !error.message.includes('private'));
  assert.ok(f.calls.includes('ROLLBACK'));
  assert.ok(!f.calls.some(sql => sql.startsWith('UPDATE')));
  assert.equal(f.isPending(), true);
  assert.equal(await publishNext(f.pool, f.producer, new AbortController().signal), f.id);
  assert.equal(f.isPending(), false);
});

test('malformed outbox payload is left pending instead of being silently acknowledged', async () => {
  const f = fixture();
  f.payload.eventId = randomUUID();
  await assert.rejects(publishNext(f.pool, f.producer, new AbortController().signal));
  assert.equal(f.messages.length, 0);
  assert.equal(f.isPending(), true);
});

test('shutdown waits for an in-flight ACK and database commit before disconnecting', async () => {
  const f = fixture();
  const controller = new AbortController();
  const producer = { ...f.producer, async publish(message: OutboxMessage) {
    controller.abort();
    await Promise.resolve();
    await f.producer.publish(message);
  } };
  await runPublisher({ pool: f.pool, producer, signal: controller.signal, settings, log() {} });
  assert.equal(f.isPending(), false);
  assert.ok(f.calls.indexOf('COMMIT') < f.calls.indexOf('kafka_disconnect'));
  assert.ok(f.calls.indexOf('kafka_disconnect') < f.calls.indexOf('pool_end'));
});

test('bounded polling sleeps between batches and retry backoff recovers', async () => {
  const f = fixture();
  const controller = new AbortController();
  const sleeps: number[] = [];
  let attempts = 0;
  const producer = { ...f.producer, async connect() {
    if (++attempts === 1) throw new Error('private error');
    await f.producer.connect();
  } };
  await runPublisher({ pool: f.pool, producer, settings, signal: controller.signal, log() {}, async sleep(ms) {
    sleeps.push(ms);
    if (!f.isPending()) controller.abort();
  } });
  assert.equal(attempts, 2);
  assert.equal(f.messages.length, 1);
  assert.ok(sleeps[0]! >= 50 && sleeps[0]! <= 100);
  assert.equal(sleeps[1], settings.pollIntervalMs);
  for (const failures of [1, 2, 30, 100]) assert.ok(retryDelay(failures, settings, () => 1) <= settings.retryMaxMs);
});

test('idle wait is interrupted immediately on shutdown and resources close even before connect', async () => {
  const controller = new AbortController();
  const waiting = pause(60000, controller.signal);
  controller.abort();
  await waiting;
  const f = fixture();
  await runPublisher({ pool: f.pool, producer: f.producer, settings, signal: controller.signal, log() {} });
  assert.deepEqual(f.calls, ['kafka_disconnect', 'pool_end']);
});
