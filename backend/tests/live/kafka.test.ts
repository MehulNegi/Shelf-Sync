import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Kafka } from 'kafkajs';
import { loadConfig } from '../../src/config/env.js';
import { loadKafkaConfig } from '../../src/config/kafka.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { createKafkaProducer } from '../../src/services/kafka-producer.js';
import { inventoryTopic, publishNext } from '../../src/services/outbox.js';

test('live Aiven round trip: committed checkout outbox -> inventory-events -> matching message', {
  skip: process.env.RUN_KAFKA_TESTS !== '1' ? 'Set RUN_KAFKA_TESTS=1 with PostgreSQL and Kafka Quick Connect settings for live verification' : false,
  timeout: 90000
}, async t => {
  const config = loadConfig();
  const kafka = loadKafkaConfig();
  const schema = `shelfsync_kafka_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(config);
  const pool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${schema}` } });
  const producer = createKafkaProducer(kafka);
  // Diagnostic reader only, not the application's future OpenSearch consumer.
  const consumer = new Kafka(kafka.client).consumer({ groupId: `shelfsync-smoke-${randomUUID()}`, allowAutoTopicCreation: false });
  let created = false;
  t.after(async () => {
    try { await consumer.disconnect(); }
    finally {
      try { await producer.disconnect(); }
      finally {
        try { await pool.end(); if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { await admin.end(); }
      }
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  await migrate(pool);
  const productId = `test_kafka_${randomUUID()}`;
  await pool.query("INSERT INTO products (id, name, description, category, price, image_url) VALUES ($1, 'Kafka verification fixture', 'Isolated test checkout', 'electronics', 1, '/images/test.jpg')", [productId]);
  await pool.query("INSERT INTO inventory (product_id, city, quantity) VALUES ($1, 'pune', 1)", [productId]);
  await new PgOrderRepository(pool).checkout({ city: 'pune', items: [{ productId, quantity: 1 }] });
  const event = (await pool.query('SELECT id, payload FROM outbox_events')).rows[0];
  let resolveMessage!: (message: { value: string; key: string }) => void;
  const received = new Promise<{ value: string; key: string }>(resolve => { resolveMessage = resolve; });
  let resolveJoined!: () => void;
  const joined = new Promise<void>(resolve => { resolveJoined = resolve; });
  consumer.on(consumer.events.GROUP_JOIN, resolveJoined);
  await consumer.connect();
  // Read from the beginning to avoid racing initial offset resolution and our send.
  await consumer.subscribe({ topic: inventoryTopic, fromBeginning: true });
  await consumer.run({ autoCommit: false, eachMessage: async ({ message }) => {
    if (!message.value) return;
    const value = message.value.toString();
    try {
      if (JSON.parse(value).eventId === event.id) resolveMessage({ value, key: message.key?.toString() ?? '' });
    } catch { /* Unrelated messages in the shared topic are ignored. */ }
  } });
  async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for the live Kafka verification')), ms);
      })]);
    } finally { clearTimeout(timer); }
  }
  await within(joined, 30000);
  await producer.connect();
  assert.equal(await publishNext(pool, producer, new AbortController().signal), event.id);
  const message = await within(received, 30000);
  assert.equal(message.key, `${productId}:pune`);
  assert.deepEqual(JSON.parse(message.value), event.payload);
  assert.notEqual((await pool.query('SELECT published_at FROM outbox_events WHERE id = $1', [event.id])).rows[0].published_at, null);
  t.diagnostic(`Observed event ${event.id} in Aiven topic ${inventoryTopic}; its outbox row was marked only after acknowledgement.`);
});
