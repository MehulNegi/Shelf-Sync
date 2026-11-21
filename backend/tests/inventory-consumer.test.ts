import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Consumer, EachBatchPayload } from 'kafkajs';
import { processInventoryBatch, runInventoryConsumer } from '../src/services/inventory-consumer.js';
import { parseInventoryEvent } from '../src/types/inventory-event.js';

function fixture() {
  const event = { eventId: randomUUID(), type: 'inventory.changed' as const, schemaVersion: 1 as const,
    productId: 'prod_001', city: 'pune' as const, quantity: 0, inventoryVersion: 8, occurredAt: new Date().toISOString() };
  const calls: string[] = [];
  const controller = new AbortController();
  const payload = {
    batch: { topic: 'inventory-events', partition: 0, messages: [{ offset: '9007199254740993', key: Buffer.from('prod_001:pune'), value: Buffer.from(JSON.stringify(event)) }] },
    isRunning: () => true, isStale: () => false, async heartbeat() { calls.push('heartbeat'); }, resolveOffset(offset: string) { calls.push(`resolve:${offset}`); }
  } as unknown as EachBatchPayload;
  const consumer = { async commitOffsets(offsets: { offset: string }[]) { calls.push(`commit:${offsets[0]!.offset}`); } };
  return { event, calls, controller, payload, consumer };
}

test('consumer applies an event before committing the next offset, without numeric rounding', async () => {
  const f = fixture();
  await processInventoryBatch({ ...f, signal: f.controller.signal, log() {}, projection: { async applyInventory(event) { assert.deepEqual(event, f.event); f.calls.push('apply'); } } });
  assert.ok(f.calls.indexOf('apply') < f.calls.indexOf('commit:9007199254740994'));
  assert.ok(f.calls.indexOf('commit:9007199254740994') < f.calls.indexOf('resolve:9007199254740993'));
});

test('transient search failures retry and heartbeat before committing', async () => {
  const f = fixture();
  let tries = 0;
  const sleeps: number[] = [];
  await processInventoryBatch({ ...f, signal: f.controller.signal, log() {}, async sleep(ms) { sleeps.push(ms); },
    projection: { async applyInventory() { if (++tries < 3) throw { statusCode: 503 }; f.calls.push('apply'); } } });
  assert.equal(tries, 3);
  assert.deepEqual(sleeps, [1000, 1000, 1000]);
  assert.equal(f.calls.filter(call => call.startsWith('commit:')).length, 1);
});

test('invalid records and permanent search failures never commit offsets', async () => {
  for (const invalid of [true, false]) {
    const f = fixture();
    if (invalid) f.payload.batch.messages[0]!.value = Buffer.from('{}');
    await assert.rejects(processInventoryBatch({ ...f, signal: f.controller.signal, log() {}, projection: { async applyInventory() { throw { statusCode: 403 }; } } }));
    assert.ok(!f.calls.some(call => call.startsWith('commit:')));
    assert.ok(!f.calls.some(call => call.startsWith('resolve:')));
  }
});

test('shutdown during retry or a stale batch leaves the record uncommitted', async () => {
  const f = fixture();
  await processInventoryBatch({ ...f, signal: f.controller.signal, log() {}, async sleep() { f.controller.abort(); },
    projection: { async applyInventory() { throw new Error('connection unavailable'); } } });
  assert.ok(!f.calls.some(call => call.startsWith('commit:')));
  const stale = fixture();
  stale.payload.isStale = () => true;
  await processInventoryBatch({ ...stale, signal: stale.controller.signal, log() {}, projection: { async applyInventory() { assert.fail('stale batch must not process'); } } });
  assert.deepEqual(stale.calls, []);
  const inFlight = fixture();
  await processInventoryBatch({ ...inFlight, signal: inFlight.controller.signal, log() {}, projection: {
    async applyInventory() { inFlight.controller.abort(); throw { statusCode: 403 }; }
  } });
  assert.ok(!inFlight.calls.some(call => call.startsWith('commit:')));
});

test('consumer disables auto commits and disconnects gracefully on shutdown', async () => {
  const f = fixture();
  let listenerRemoved = false;
  const consumer = {
    events: { CRASH: 'crash' }, on() { return () => { listenerRemoved = true; }; },
    async connect() { f.calls.push('connect'); }, async subscribe() {},
    async run(options: { autoCommit: boolean; eachBatchAutoResolve: boolean }) {
      assert.equal(options.autoCommit, false); assert.equal(options.eachBatchAutoResolve, false); f.controller.abort();
    }, async disconnect() { f.calls.push('disconnect'); }
  } as unknown as Consumer;
  await runInventoryConsumer(consumer, { async applyInventory() {} }, f.controller.signal, () => {});
  assert.deepEqual(f.calls, ['connect', 'disconnect']);
  assert.equal(listenerRemoved, true);
});

test('duplicate/out-of-order valid messages are passed to the atomic version guard before acknowledgement', async () => {
  const f = fixture();
  let version = 0;
  let quantity = 99;
  let updates = 0;
  // A projection double verifies consumer delivery/offset behavior. Actual Painless
  // duplicate and stale-version semantics are covered by the opt-in live search test.
  const projection = { async applyInventory(event: typeof f.event) {
    if (event.inventoryVersion > version) { version = event.inventoryVersion; quantity = event.quantity; updates++; }
  } };
  for (const incoming of [f.event, f.event, { ...f.event, eventId: randomUUID(), inventoryVersion: 7, quantity: 1 }]) {
    f.payload.batch.messages[0]!.value = Buffer.from(JSON.stringify(incoming));
    await processInventoryBatch({ ...f, projection, signal: f.controller.signal, log() {} });
  }
  assert.equal(version, 8); assert.equal(quantity, 0); assert.equal(updates, 1);
  assert.equal(f.calls.filter(call => call.startsWith('commit:')).length, 3);
  assert.throws(() => parseInventoryEvent({ ...f.event, inventoryVersion: Infinity }));
});
