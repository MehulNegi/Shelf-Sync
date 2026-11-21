import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { publishNext, type EventProducer, type OutboxMessage } from '../../src/services/outbox.js';

test('real PostgreSQL outbox coordination (Kafka transport double)', { skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests' : false }, async t => {
  const config = loadConfig();
  const schema = `shelfsync_outbox_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(config);
  // Two connections still exercise concurrent publishers without a five-connection
  // fixture-insert burst competing with the running hackathon services.
  const pool = createPool({ ...config, database: { ...config.database, max: 2, options: `-c search_path=${schema}` } });
  let created = false;
  t.after(async () => {
    try { await pool.end(); if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  await migrate(pool);
  const signal = new AbortController().signal;
  const messages: OutboxMessage[] = [];
  const producer: EventProducer = { async connect() {}, async publish(message) { messages.push(message); }, async disconnect() {} };
  async function insert() {
    const eventId = randomUUID();
    // Current fixtures must respect the configured C7 schema-1 rollout cutoff.
    const payload = { eventId, type: 'inventory.changed', schemaVersion: 2, reservedQuantity: 0, availableQuantity: 0, nextExpirationAt: null, causes: ['checkout.confirmed'], productId: `test_${randomUUID()}`, city: 'pune', quantity: 0, inventoryVersion: 8, occurredAt: new Date().toISOString() };
    await pool.query("INSERT INTO outbox_events (id, event_type, payload) VALUES ($1, 'inventory.changed', $2)", [eventId, JSON.stringify(payload)]);
    return payload;
  }
  const pending = async (id: string) => (await pool.query('SELECT published_at FROM outbox_events WHERE id = $1', [id])).rows[0].published_at === null;

  await t.test('only committed rows are discovered and the ACK is recorded', async () => {
    const uncommitted = await pool.connect();
    try {
      await uncommitted.query('BEGIN');
      await uncommitted.query("INSERT INTO outbox_events (event_type, payload) VALUES ('inventory.changed', '{}')");
      assert.equal(await publishNext(pool, producer, signal), undefined);
    } finally { await uncommitted.query('ROLLBACK'); uncommitted.release(); }
    const event = await insert();
    assert.equal(await publishNext(pool, producer, signal), event.eventId);
    assert.equal(await pending(event.eventId), false);
    assert.deepEqual(JSON.parse(messages.at(-1)!.value), event);
    assert.equal(messages.at(-1)!.key, `${event.productId}:pune`);
    assert.equal(await publishNext(pool, producer, signal), undefined);
  });

  await t.test('send failure remains pending and the next poll recovers', async () => {
    const event = await insert();
    await assert.rejects(publishNext(pool, { ...producer, async publish() { throw new Error('Kafka unavailable'); } }, signal));
    assert.equal(await pending(event.eventId), true);
    assert.equal(await publishNext(pool, producer, signal), event.eventId);
    assert.equal(await pending(event.eventId), false);
  });

  await t.test('two publishers skip each other’s locked events and cannot falsely acknowledge them', async () => {
    const first = await insert();
    const second = await insert();
    let started!: () => void;
    const sending = new Promise<void>(resolve => { started = resolve; });
    let acknowledge!: () => void;
    const ack = new Promise<void>(resolve => { acknowledge = resolve; });
    const one = publishNext(pool, { ...producer, async publish(message) { started(); await ack; messages.push(message); } }, signal);
    try {
      await sending;
      assert.equal(await pending(first.eventId), true);
      assert.equal(await publishNext(pool, producer, signal), second.eventId);
      assert.equal(await pending(first.eventId), true);
      assert.equal(await publishNext(pool, producer, signal), undefined);
    } finally { acknowledge(); await one; }
    assert.equal(await pending(first.eventId), false);
    for (const event of [first, second]) assert.equal(messages.filter(message => JSON.parse(message.value).eventId === event.eventId).length, 1);
  });

  await t.test('failure after Kafka ACK leaves a retryable row and may duplicate publication', async () => {
    const event = await insert();
    await pool.query(`CREATE FUNCTION fail_test_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected acknowledgement failure'; END $$`);
    await pool.query('CREATE TRIGGER fail_test_ack BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_test_ack()');
    try {
      await assert.rejects(publishNext(pool, producer, signal));
      assert.equal(await pending(event.eventId), true);
    } finally { await pool.query('DROP TRIGGER fail_test_ack ON outbox_events'); }
    assert.equal(await publishNext(pool, producer, signal), event.eventId);
    assert.equal(await pending(event.eventId), false);
    assert.equal(messages.filter(message => JSON.parse(message.value).eventId === event.eventId).length, 2);
  });

  await t.test('repeated polls drain all events without losing or republishing acknowledged rows', async () => {
    const events = await Promise.all(Array.from({ length: 5 }, insert));
    const published = [];
    for (let i = 0; i < 8; i++) published.push(await publishNext(pool, producer, signal));
    assert.deepEqual(published.filter(Boolean).sort(), events.map(event => event.eventId).sort());
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM outbox_events WHERE published_at IS NULL')).rows[0].count, 0);
  });
});
