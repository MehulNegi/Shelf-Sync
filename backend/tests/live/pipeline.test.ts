import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Kafka } from 'kafkajs';
import { loadConfig } from '../../src/config/env.js';
import { loadKafkaConfig } from '../../src/config/kafka.js';
import { createOpenSearchClient, loadOpenSearchConfig } from '../../src/config/opensearch.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { indexCatalog } from '../../src/services/catalog-indexer.js';
import { SearchProjection, documentId } from '../../src/services/search-projection.js';
import { createKafkaProducer } from '../../src/services/kafka-producer.js';
import { publishNext, inventoryTopic } from '../../src/services/outbox.js';
import { runInventoryConsumer, type ConsumerLog } from '../../src/services/inventory-consumer.js';

test('live committed checkout -> outbox -> Aiven Kafka -> OpenSearch -> committed consumer offset', {
  skip: process.env.RUN_PIPELINE_TESTS !== '1' ? 'Set RUN_PIPELINE_TESTS=1 with PostgreSQL, Kafka, and OpenSearch credentials' : false,
  timeout: 90000
}, async t => {
  const db = loadConfig(); const kafka = loadKafkaConfig(); const search = loadOpenSearchConfig();
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `shelfsync_pipeline_${suffix}`;
  const index = `shelfsync-pipeline-${suffix}`;
  const admin = createPool(db);
  const pool = createPool({ ...db, database: { ...db.database, options: `-c search_path=${schema}` } });
  const client = createOpenSearchClient(search);
  const projection = new SearchProjection(client, index);
  const producer = createKafkaProducer(kafka);
  const controller = new AbortController();
  const groupId = `shelfsync-pipeline-${suffix}`;
  const consumer = new Kafka(kafka.client).consumer({ groupId, allowAutoTopicCreation: false, sessionTimeout: 60000, heartbeatInterval: 3000,
    retry: { ...kafka.client.retry, restartOnFailure: async () => false } });
  const kafkaAdmin = new Kafka(kafka.client).admin();
  let schemaCreated = false; let indexCreated = false;
  let running: Promise<void> | undefined;
  let consumerFailure: unknown;
  const logs: Parameters<ConsumerLog>[0][] = [];
  t.after(async () => {
    controller.abort();
    try { await running; }
    finally {
      try { await consumer.disconnect(); await producer.disconnect(); await kafkaAdmin.disconnect(); }
      finally {
        try { if (indexCreated) await client.indices.delete({ index }); }
        finally { try { await client.close(); await pool.end(); if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } }
      }
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  await migrate(pool);
  const productId = `test_pipeline_${suffix}`;
  await pool.query("INSERT INTO products (id, name, description, category, price, image_url) VALUES ($1, 'Pipeline Bluetooth Earphones', 'Live isolated fixture', 'electronics', 1999, '/images/test.jpg')", [productId]);
  await pool.query("INSERT INTO inventory (product_id, city, quantity) VALUES ($1, 'pune', 1)", [productId]);
  await projection.ensureIndex(); indexCreated = true;
  assert.equal(await indexCatalog(pool, projection), 3);
  running = runInventoryConsumer(consumer, projection, controller.signal, entry => logs.push(entry)).catch(error => { consumerFailure = error; });
  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (consumerFailure) throw new Error('Live Kafka consumer failed before synchronization');
      if (await check()) return;
      await delay(100);
    }
    throw new Error('Timed out waiting for live event synchronization');
  }
  await until(async () => logs.some(entry => entry.event === 'consumer_started'));
  await new PgOrderRepository(pool).checkout({ city: 'pune', items: [{ productId, quantity: 1 }] });
  const event = (await pool.query('SELECT id, payload FROM outbox_events')).rows[0];
  await producer.connect();
  assert.equal(await publishNext(pool, producer, new AbortController().signal), event.id);
  await until(async () => logs.some(entry => entry.event === 'inventory_projected' && entry.eventId === event.id));
  const source = (await client.get({ index, id: documentId(productId, 'pune') })).body._source;
  assert.equal(source.stock, 0); assert.equal(source.inventoryVersion, 2); assert.equal(source.lastEventId, event.id);
  assert.equal((await pool.query('SELECT published_at IS NOT NULL AS published FROM outbox_events WHERE id = $1', [event.id])).rows[0].published, true);
  await kafkaAdmin.connect();
  const offsets = await kafkaAdmin.fetchOffsets({ groupId, topics: [inventoryTopic] });
  const processed = logs.find(entry => entry.eventId === event.id && entry.event === 'inventory_projected')!;
  const committed = offsets.find(topic => topic.topic === inventoryTopic)!.partitions.find(partition => partition.partition === processed.partition)!;
  assert.ok(BigInt(committed.offset) > BigInt(processed.offset!));
  await client.indices.refresh({ index });
  const results = await projection.search({ city: 'pune', q: 'blutooth earphones' });
  assert.equal(results.find(product => product.id === productId)?.stock, 0);
  t.diagnostic(`Checkout event ${event.id} observed in ${inventoryTopic}, projected at inventoryVersion=2/stock=0, and consumer offset committed after processing.`);
});
