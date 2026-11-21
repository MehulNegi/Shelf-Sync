import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { createAdminApi } from '../../src/services/admin.js';
import { adminCredentials } from '../helpers/admin.js';

test('authenticated Command Center with real PostgreSQL snapshots', {
  skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests' : false
}, async t => {
  const config = loadConfig();
  const schema = `shelfsync_admin_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(config);
  // Force a different session timezone to verify that reporting still uses IST.
  const pool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${schema} -c timezone=Pacific/Honolulu` } });
  const credentials = await adminCredentials();
  const token = await credentials.token();
  const headers = credentials.headers(token);
  const api = buildApp({ frontendOrigin: credentials.config.frontendOrigin,
    products: new PgProductRepository(pool), orders: new PgOrderRepository(pool),
    admin: createAdminApi(pool, credentials.config, credentials.resolver)! });
  let created = false;
  t.after(async () => { try { await api.close(); await pool.end(); if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } });
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  await migrate(pool);
  const get = async (path: string) => {
    const response = await api.inject({ url: `/api/admin/${path}`, headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    return response.json();
  };

  await t.test('empty authoritative tables return correct zero aggregates and bounded empty lists', async () => {
    const result = await get('overview');
    assert.equal(result.totalStockUnits, 0); assert.equal(result.lowStockRecords, 0); assert.equal(result.outOfStockRecords, 0);
    assert.equal(result.ordersToday.count, 0); assert.equal(result.outboxBacklog, 0);
    assert.deepEqual(result.inventoryByCity, ['pune', 'delhi', 'bengaluru'].map(city => ({ city, stockUnits: 0, lowStockRecords: 0, outOfStockRecords: 0 })));
    for (const endpoint of ['inventory', 'orders', 'events']) {
      const list = await get(endpoint);
      assert.deepEqual(list[endpoint], []); assert.deepEqual(list.page, { limit: 50, nextCursor: null });
    }
  });

  for (const [id, category, price] of [['product_a', 'electronics', '1999'], ['product_b', 'groceries', '159.50'], ['product_c', 'apparel', '499'], ['missing_inventory', 'groceries', '1']]) {
    await pool.query('INSERT INTO products (id, name, description, category, price, image_url) VALUES ($1, $1, $1, $2, $3, $1)', [id, category, price]);
  }
  for (const [id, city, quantity] of [
    ['product_a', 'pune', 0], ['product_a', 'delhi', 1], ['product_a', 'bengaluru', 6],
    ['product_b', 'pune', 5], ['product_b', 'delhi', 8], ['product_c', 'bengaluru', 2]
  ]) await pool.query('INSERT INTO inventory (product_id, city, quantity) VALUES ($1, $2, $3)', [id, city, quantity]);
  const bounds = (await pool.query(`SELECT to_char((transaction_timestamp() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS date,
    (transaction_timestamp() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata' AS start`)).rows[0];
  // All seven orders are actual persisted fixtures. Boundary rows and microsecond
  // ties specifically exercise the UTC window and lossless pagination keys.
  const offsets: [string, string, string, string][] = [
    ['order_old', 'pune', 'confirmed', "- interval '1 microsecond'"],
    ['order_start', 'pune', 'confirmed', "+ interval '0 second'"],
    ['order_late', 'delhi', 'confirmed', "+ interval '1 day' - interval '1 microsecond'"],
    ['order_end', 'pune', 'confirmed', "+ interval '1 day'"],
    ['order_a', 'pune', 'confirmed', "+ interval '12 hours 0.123455 second'"],
    ['order_b', 'delhi', 'pending', "+ interval '12 hours 0.123456 second'"],
    ['order_c', 'bengaluru', 'cancelled', "+ interval '12 hours 0.123455 second'"]
  ];
  for (const [id, city, status, offset] of offsets) {
    // Offset expressions are fixed test literals; all record values are parameters.
    await pool.query(`INSERT INTO orders (id, city, status, total, created_at) VALUES ($1, $2, $3, 1999, $4::timestamptz ${offset})`, [id, city, status, bounds.start]);
  }
  const eventIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  for (const [index, payload] of [
    { productId: 'product_a', city: 'pune' }, { productId: 'product_b', city: 'delhi', orderId: 'order_a' },
    { productId: 42, city: 'invalid', orderId: false, secret: 'must never appear in API data' }
  ].entries()) {
    await pool.query(`INSERT INTO outbox_events (id, event_type, payload, created_at, published_at) VALUES ($1, $2, $3,
      $4::timestamptz, $5::timestamptz)`, [eventIds[index], index === 2 ? 'unsupported' : 'inventory.changed', JSON.stringify(payload),
      `2026-11-21T10:00:00.${index === 0 ? '123456' : '123455'}Z`, index === 1 ? '2026-11-21T10:00:01Z' : null]);
  }
  const before = (await pool.query(`SELECT (SELECT sum(quantity)::text FROM inventory) AS stock,
    (SELECT sum(version)::text FROM inventory) AS version,
    (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM order_status_history) AS history,
    (SELECT count(*)::int FROM outbox_events WHERE published_at IS NULL) AS pending`)).rows[0];

  await t.test('overview uses actual records, threshold 1–5, every city, and Asia/Kolkata day boundaries', async () => {
    const result = await get('overview');
    assert.equal(result.lowStockThreshold, 5); assert.equal(result.totalStockUnits, 22);
    assert.equal(result.lowStockRecords, 3); assert.equal(result.outOfStockRecords, 1); assert.equal(result.outboxBacklog, 2);
    assert.deepEqual(result.inventoryByCity, [
      { city: 'pune', stockUnits: 5, lowStockRecords: 1, outOfStockRecords: 1 },
      { city: 'delhi', stockUnits: 9, lowStockRecords: 1, outOfStockRecords: 0 },
      { city: 'bengaluru', stockUnits: 8, lowStockRecords: 1, outOfStockRecords: 0 }
    ]);
    assert.deepEqual(result.ordersToday, { count: 5, date: bounds.date, timeZone: 'Asia/Kolkata', startsAt: bounds.start.toISOString(),
      endsAt: new Date(bounds.start.getTime() + 86400000).toISOString() });
  });

  await t.test('city/category/stock-status filters use PostgreSQL and omit missing inventory rows', async () => {
    const all = (await get('inventory')).inventory;
    assert.equal(all.length, 6);
    assert.deepEqual(all.map((row: { city: string; productId: string }) => [row.city, row.productId]), [
      ['bengaluru', 'product_a'], ['bengaluru', 'product_c'], ['delhi', 'product_a'], ['delhi', 'product_b'], ['pune', 'product_a'], ['pune', 'product_b']
    ]);
    assert.equal((await get('inventory?stockStatus=low_stock')).inventory.length, 3);
    assert.equal((await get('inventory?stockStatus=in_stock')).inventory.length, 2);
    const out = (await get('inventory?city=pune&category=electronics&stockStatus=out_of_stock')).inventory;
    assert.deepEqual(out, [{ productId: 'product_a', name: 'product_a', category: 'electronics', city: 'pune', stock: 0, price: 1999, stockStatus: 'out_of_stock' }]);
    assert.equal((await get('inventory?category=groceries')).inventory[0].price, 159.5);
    assert.deepEqual((await get('inventory?category=Electronics')).inventory, []);
    assert.deepEqual((await get('inventory?category=' + encodeURIComponent("electronics' OR 1=1 --"))).inventory, []);
  });

  await t.test('inventory keyset pagination returns each row once and rejects changed filters/limits/scopes', async () => {
    const first = await get('inventory?limit=2');
    assert.equal(first.inventory.length, 2); assert.ok(first.page.nextCursor);
    const second = await get(`inventory?limit=2&cursor=${first.page.nextCursor}`);
    const third = await get(`inventory?limit=2&cursor=${second.page.nextCursor}`);
    assert.equal(third.page.nextCursor, null);
    assert.equal(new Set([...first.inventory, ...second.inventory, ...third.inventory].map(row => `${row.productId}:${row.city}`)).size, 6);
    for (const url of [`inventory?limit=3&cursor=${first.page.nextCursor}`, `inventory?limit=2&city=pune&cursor=${first.page.nextCursor}`]) {
      const response = await api.inject({ url: `/api/admin/${url}`, headers });
      assert.equal(response.statusCode, 400); assert.equal(response.json().error.code, 'INVALID_CURSOR');
    }
    const differentIdentity = await api.inject({ url: `/api/admin/inventory?limit=2&cursor=${first.page.nextCursor}`, headers: credentials.headers(await credentials.token({ sub: 'another-admin' })) });
    assert.equal(differentIdentity.statusCode, 400); assert.equal(differentIdentity.json().error.code, 'INVALID_CURSOR');
  });

  await t.test('order pagination retains PostgreSQL microseconds and persisted statuses/totals', async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await get(`orders?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(result.orders.length, 1);
      ids.push(result.orders[0].orderId); cursor = result.page.nextCursor;
      assert.deepEqual(Object.keys(result.orders[0]).sort(), ['orderId', 'createdAt', 'city', 'total', 'status'].sort());
    } while (cursor);
    assert.deepEqual(ids, ['order_end', 'order_late', 'order_b', 'order_c', 'order_a', 'order_start', 'order_old']);
    assert.deepEqual((await get('orders?city=delhi&status=pending')).orders.map((row: { orderId: string }) => row.orderId), ['order_b']);
    assert.equal((await get('orders?status=cancelled')).orders[0].status, 'cancelled');
    const today = await get(`orders?createdFrom=${encodeURIComponent(bounds.start.toISOString())}&createdTo=${encodeURIComponent(new Date(bounds.start.getTime() + 86400000).toISOString())}`);
    assert.equal(today.orders.length, 5);
  });

  await t.test('events expose only real publication markers and explicit payload associations', async () => {
    const result = await get('events');
    assert.deepEqual(result.events.map((row: { eventId: string }) => row.eventId), [eventIds[0], eventIds[2], eventIds[1]]);
    assert.equal(result.events[0].orderId, null); assert.equal(result.events[0].publicationState, 'pending'); assert.equal(result.events[0].publishedAt, null);
    assert.equal(result.events[1].productId, null); assert.equal(result.events[1].city, null); assert.equal(result.events[1].orderId, null);
    assert.equal(result.events[2].orderId, 'order_a'); assert.equal(result.events[2].publicationState, 'published'); assert.equal(result.events[2].publishedAt, '2026-11-21T10:00:01.000Z');
    assert.ok(!JSON.stringify(result).includes('must never appear'));
    for (const row of result.events) assert.deepEqual(Object.keys(row).sort(), ['eventId', 'eventType', 'orderId', 'productId', 'city', 'createdAt', 'publicationState', 'publishedAt'].sort());
    assert.equal((await get('events?publicationState=pending')).events.length, 2);
    assert.equal((await get('events?publicationState=published&productId=product_b&city=delhi&eventType=inventory.changed')).events.length, 1);
    assert.deepEqual((await get('events?eventType=does-not-exist')).events, []);
    assert.equal((await get('events?createdFrom=2026-11-21T10:00:00.123456Z')).events.length, 1);
    const ids: string[] = []; let cursor: string | null = null;
    do {
      const page = await get(`events?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      ids.push(page.events[0].eventId); cursor = page.page.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, [eventIds[0], eventIds[2], eventIds[1]]);
  });

  await t.test('database failure returns 503 rather than fabricated counters', async () => {
    const closed = createPool(config); await closed.end();
    const failed = buildApp({ frontendOrigin: credentials.config.frontendOrigin, products: new PgProductRepository(pool), orders: new PgOrderRepository(pool),
      admin: createAdminApi(closed, credentials.config, credentials.resolver)! });
    try {
      const response = await failed.inject({ url: '/api/admin/overview', headers });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Operational data is temporarily unavailable' } });
    } finally { await failed.close(); }
  });

  await t.test('admin reads and unsupported mutation requests leave operational data unchanged', async () => {
    for (const endpoint of ['overview', 'inventory', 'orders', 'events']) {
      const response = await api.inject({ method: 'POST', url: `/api/admin/${endpoint}`, headers, payload: { stock: 999, status: 'shipped' } });
      assert.equal(response.statusCode, 404);
    }
    const after = (await pool.query(`SELECT (SELECT sum(quantity)::text FROM inventory) AS stock,
      (SELECT sum(version)::text FROM inventory) AS version,
      (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM order_status_history) AS history,
      (SELECT count(*)::int FROM outbox_events WHERE published_at IS NULL) AS pending`)).rows[0];
    assert.deepEqual(after, before);
  });
});
