import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { databaseDirectory } from '../../src/db/migrations.js';
import { buildApp } from '../../src/app.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { PgProductRepository } from '../../src/repositories/products.js';

test('PostgreSQL persisted order tracking and legacy migration', {
  skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests' : false
}, async t => {
  const config = loadConfig();
  const schema = `shelfsync_tracking_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(config);
  const pool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${schema}` } });
  const orders = new PgOrderRepository(pool);
  const api = buildApp({ frontendOrigin: 'http://localhost:5173', orders, tracking: orders, products: new PgProductRepository(pool) });
  let created = false;
  t.after(async () => {
    try { await api.close(); await pool.end(); if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  // Simulate a real pre-tracking deployment with existing orders of every legacy
  // status, then apply only the new migration in a transaction.
  await pool.query(await readFile(new URL('migrations/001_foundation.sql', databaseDirectory), 'utf8'));
  await pool.query("INSERT INTO products (id, name, description, category, price, image_url) VALUES ('fixture', 'Tracking fixture', 'Isolated data', 'electronics', 1999, '/images/test.jpg')");
  await pool.query("INSERT INTO inventory (product_id, city, quantity) VALUES ('fixture', 'pune', 10)");
  for (const status of ['pending', 'confirmed', 'cancelled']) {
    await pool.query("INSERT INTO orders (id, city, status, total, created_at) VALUES ($1, 'pune', $2, 1999, '2026-01-01T00:00:00Z')", [`legacy_${status}`, status]);
    await pool.query("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, 'fixture', 1, 1999)", [`legacy_${status}`]);
  }
  const legacyBefore = (await pool.query('SELECT * FROM orders ORDER BY id')).rows;
  const migration = await readFile(new URL('migrations/002_order_tracking.sql', databaseDirectory), 'utf8');
  const migrationClient = await pool.connect();
  try { await migrationClient.query('BEGIN'); await migrationClient.query(migration); await migrationClient.query('COMMIT'); }
  catch (error) { await migrationClient.query('ROLLBACK'); throw error; }
  finally { migrationClient.release(); }

  await pool.query(await readFile(new URL('migrations/003_cart_reservations.sql', databaseDirectory),'utf8'));

  await t.test('migration preserves legacy orders and marks historical transition times unknown', async () => {
    assert.deepEqual((await pool.query('SELECT * FROM orders ORDER BY id')).rows, legacyBefore);
    for (const status of ['pending', 'confirmed', 'cancelled']) {
      const response = await api.inject(`/api/orders/legacy_${status}/tracking`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, status);
      assert.equal(response.json().createdAt, '2026-01-01T00:00:00.000Z');
      assert.deepEqual(response.json().history, [{ status, occurredAt: null, recordedAt: response.json().history[0].recordedAt, source: 'legacy_snapshot' }]);
      assert.ok(Number.isFinite(Date.parse(response.json().history[0].recordedAt)));
      const details = await api.inject(`/api/orders/legacy_${status}`);
      assert.equal(details.json().status, status);
      assert.ok(!('history' in details.json()));
    }
  });

  await t.test('checkout atomically initializes confirmed history with a real PostgreSQL timestamp', async () => {
    const before: Date = (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const response = await api.inject({ method: 'POST', url: '/api/orders', payload: { city: 'pune', items: [{ productId: 'fixture', quantity: 1 }] } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().status, 'confirmed');
    const orderId = response.json().orderId;
    const tracking = (await api.inject(`/api/orders/${orderId}/tracking`)).json();
    assert.equal(tracking.status, 'confirmed');
    assert.equal(tracking.history.length, 1);
    const entry = tracking.history[0];
    assert.equal(entry.status, 'confirmed'); assert.equal(entry.source, 'order_created');
    assert.equal(entry.occurredAt, entry.recordedAt);
    const after: Date = (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
    assert.ok(Date.parse(entry.occurredAt) >= before.getTime() && Date.parse(entry.occurredAt) <= after.getTime());
    const persisted = (await pool.query('SELECT occurred_at, recorded_at FROM order_status_history WHERE order_id = $1', [orderId])).rows[0];
    assert.equal(entry.occurredAt, persisted.occurred_at.toISOString());
    const details = (await api.inject(`/api/orders/${orderId}`)).json();
    assert.deepEqual(details, { id: orderId, city: 'pune', status: 'confirmed', total: 1999,
      items: [{ productId: 'fixture', name: 'Tracking fixture', quantity: 1, unitPrice: 1999 }] });
  });

  await t.test('history is chronological even if legacy fixture observation IDs arrive out of order', async () => {
    // Imported observation fixtures, not fabricated fulfillment transitions.
    for (const recordedAt of ['2026-02-02T00:00:00Z', '2026-02-01T00:00:00Z']) {
      await pool.query("INSERT INTO order_status_history (order_id, status, occurred_at, recorded_at, source) VALUES ('legacy_pending', 'pending', NULL, $1, 'legacy_snapshot')", [recordedAt]);
    }
    const history = (await api.inject('/api/orders/legacy_pending/tracking')).json().history;
    const timestamps = history.map((entry: { recordedAt: string }) => entry.recordedAt);
    assert.deepEqual(timestamps, [...timestamps].sort());
    assert.equal(history.length, 3);
    assert.ok(history.every((entry: { occurredAt: null; status: string }) => entry.occurredAt === null && entry.status === 'pending'));
  });

  await t.test('all status transitions remain disabled without authorization, including invalid jumps', async () => {
    const before = (await pool.query("SELECT count(*)::int AS count FROM order_status_history WHERE order_id = 'legacy_confirmed'")).rows[0].count;
    for (const status of ['processing', 'shipped', 'delivered', 'cancelled', 'pending']) {
      await assert.rejects(pool.query("UPDATE orders SET status = $1 WHERE id = 'legacy_confirmed'", [status]), { code: '23514', constraint: 'order_status_transitions_disabled' });
    }
    await pool.query("UPDATE orders SET status = status WHERE id = 'legacy_confirmed'");
    assert.equal((await pool.query("SELECT status FROM orders WHERE id = 'legacy_confirmed'")).rows[0].status, 'confirmed');
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM order_status_history WHERE order_id = 'legacy_confirmed'")).rows[0].count, before);
  });

  await t.test('history insertion failure rolls back checkout inventory, order, and outbox', async () => {
    const inventoryBefore = (await pool.query("SELECT quantity, version FROM inventory WHERE product_id = 'fixture' AND city = 'pune'")).rows[0];
    const ordersBefore = (await pool.query('SELECT count(*)::int AS count FROM orders')).rows[0].count;
    const outboxBefore = (await pool.query('SELECT count(*)::int AS count FROM outbox_events')).rows[0].count;
    await pool.query(`CREATE FUNCTION fail_test_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected history write failure'; END $$`);
    await pool.query('CREATE TRIGGER fail_test_history BEFORE INSERT ON order_status_history FOR EACH ROW EXECUTE FUNCTION fail_test_history()');
    try {
      const response = await api.inject({ method: 'POST', url: '/api/orders', payload: { city: 'pune', items: [{ productId: 'fixture', quantity: 1 }] } });
      assert.equal(response.statusCode, 500);
      assert.deepEqual((await pool.query("SELECT quantity, version FROM inventory WHERE product_id = 'fixture' AND city = 'pune'")).rows[0], inventoryBefore);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM orders')).rows[0].count, ordersBefore);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM outbox_events')).rows[0].count, outboxBefore);
    } finally { await pool.query('DROP TRIGGER fail_test_history ON order_status_history'); }
  });
});
