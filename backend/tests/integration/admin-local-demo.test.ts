import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadAdminConfig } from '../../src/config/admin.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { createAdminApi } from '../../src/services/admin.js';

test('local-demo over a real loopback HTTP socket and PostgreSQL', {
  skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests' : false
}, async t => {
  const runtime = { ...loadConfig(), host: '127.0.0.1', nodeEnv: 'test', frontendOrigin: 'http://localhost:5173' };
  const adminConfig = loadAdminConfig(runtime, {
    ADMIN_AUTH_MODE: 'local-demo', ADMIN_CURSOR_SECRET: randomBytes(32).toString('base64url')
  });
  assert.equal(adminConfig.mode, 'local-demo');
  const schema = `shelfsync_local_${randomUUID().replaceAll('-', '')}`;
  const database = createPool(runtime);
  const pool = createPool({ ...runtime, database: { ...runtime.database, options: `-c search_path=${schema}` } });
  const products = new PgProductRepository(pool);
  const orders = new PgOrderRepository(pool);
  const options = { products, orders, tracking: orders, frontendOrigin: runtime.frontendOrigin };
  const app = buildApp({ ...options, admin: createAdminApi(pool, adminConfig)! });
  let created = false;
  t.after(async () => {
    try {
      await app.close(); await pool.end();
      if (created) await database.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await database.end(); }
  });
  await database.query(`CREATE SCHEMA "${schema}"`); created = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  await migrate(pool);
  const productId = `local_${randomUUID()}`;
  await pool.query(`INSERT INTO products (id, name, description, category, price, image_url)
    VALUES ($1, 'Local demo fixture', 'Isolated test product', 'electronics', 1999, '/images/test.jpg')`, [productId]);
  await pool.query(`INSERT INTO inventory (product_id, city, quantity) VALUES ($1, 'pune', 2), ($1, 'delhi', 8), ($1, 'bengaluru', 0)`, [productId]);
  const address = await app.listen({ host: runtime.host, port: 0 });
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${address}${path}`, {
    headers: { origin: runtime.frontendOrigin, ...headers }
  });
  let orderId = '';

  await t.test('public health, products and checkout need no admin authorization', async () => {
    assert.deepEqual(await (await get('/api/health')).json(), { status: 'ok' });
    const product = await get(`/api/products/${productId}?city=pune`);
    assert.equal(product.status, 200);
    assert.equal((await product.json()).stock, 2);
    const checkout = await fetch(`${address}/api/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: runtime.frontendOrigin },
      body: JSON.stringify({ city: 'pune', items: [{ productId, quantity: 1 }] })
    });
    assert.equal(checkout.status, 201);
    const body = await checkout.json();
    assert.equal(body.status, 'confirmed'); assert.equal(body.total, 1999); orderId = body.orderId;
    const details = await get(`/api/orders/${orderId}`);
    assert.equal(details.status, 200); assert.equal((await details.json()).status, 'confirmed');
    const insufficient = await fetch(`${address}/api/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city: 'pune', items: [{ productId, quantity: 2 }] })
    });
    assert.equal(insufficient.status, 409);
    assert.equal((await insufficient.json()).error.code, 'INSUFFICIENT_STOCK');
  });

  const snapshot = async () => (await pool.query(`SELECT
    (SELECT sum(quantity)::int FROM inventory) AS stock,
    (SELECT sum(version)::int FROM inventory) AS version,
    (SELECT count(*)::int FROM orders) AS orders,
    (SELECT count(*)::int FROM outbox_events) AS events`)).rows[0];
  const before = await snapshot();

  await t.test('all four read-only endpoints return persisted data without a Bearer token', async () => {
    const bodies: Record<string, any> = {};
    for (const endpoint of ['overview', 'inventory', 'orders', 'events']) {
      const response = await get(`/api/admin/${endpoint}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('access-control-allow-origin'), runtime.frontendOrigin);
      bodies[endpoint] = await response.json();
    }
    assert.equal(bodies.overview.totalStockUnits, 9);
    assert.equal(bodies.overview.lowStockRecords, 1); assert.equal(bodies.overview.outOfStockRecords, 1);
    assert.equal(bodies.overview.outboxBacklog, 1); assert.equal(bodies.overview.ordersToday.count, 1);
    assert.deepEqual(bodies.inventory.inventory.map((row: { city: string; stock: number }) => [row.city, row.stock]),
      [['bengaluru', 0], ['delhi', 8], ['pune', 1]]);
    assert.deepEqual(bodies.orders.orders.map((row: { orderId: string; total: number; status: string }) => [row.orderId, row.total, row.status]),
      [[orderId, 1999, 'confirmed']]);
    const event = (await pool.query('SELECT id FROM outbox_events')).rows[0];
    assert.equal(bodies.events.events.length, 1);
    assert.equal(bodies.events.events[0].eventId, event.id);
    assert.equal(bodies.events.events[0].productId, productId);
    assert.equal(bodies.events.events[0].publicationState, 'pending');
    assert.equal(bodies.events.events[0].publishedAt, null);
  });

  await t.test('every admin route rejects non-loopback Hosts, foreign origins and forwarding headers', async () => {
    for (const endpoint of ['overview', 'inventory', 'orders', 'events']) {
      // Fetch controls Host itself. Use a raw HTTP client so this hostile Host
      // actually reaches the server instead of testing a stripped header.
      const hostStatus = await new Promise<number>((resolve, reject) => {
        httpGet(`${address}/api/admin/${endpoint}`, { headers: { host: '192.0.2.10:3000' } }, response => {
          response.resume();
          response.on('end', () => resolve(response.statusCode!));
        }).on('error', reject);
      });
      assert.equal(hostStatus, 403);
      for (const headers of [
        { origin: 'http://192.0.2.10:5173' }, { origin: 'null' },
        { forwarded: 'for=127.0.0.1' }, { 'x-forwarded-for': '127.0.0.1' },
        { 'x-forwarded-host': 'localhost' }, { 'x-forwarded-proto': 'https' }
      ]) {
        const response = await get(`/api/admin/${endpoint}`, headers);
        assert.equal(response.status, 403, `${endpoint}: rejected headers ${JSON.stringify(headers)}`);
        assert.equal((await response.json()).error.code, 'FORBIDDEN');
      }
      const remote = await app.inject({ url: `/api/admin/${endpoint}`, remoteAddress: '192.0.2.10', headers: { host: 'localhost' } });
      assert.equal(remote.statusCode, 403);
    }
  });

  await t.test('query validation and unsupported mutations remain enforced', async () => {
    for (const path of ['overview?city=pune', 'inventory?city=Pune', 'inventory?limit=101',
      'orders?status=shipped', 'events?publicationState=indexed']) {
      const response = await get(`/api/admin/${path}`);
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    }
    for (const endpoint of ['overview', 'inventory', 'orders', 'events']) {
      const response = await fetch(`${address}/api/admin/${endpoint}`, { method: 'POST' });
      assert.equal(response.status, 404);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('without explicit opt-in all four endpoints still fail closed', async () => {
    const disabled = buildApp(options);
    try {
      for (const endpoint of ['overview', 'inventory', 'orders', 'events']) {
        const response = await disabled.inject(`/api/admin/${endpoint}`);
        assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'ADMIN_DISABLED');
      }
    } finally { await disabled.close(); }
  });
});
