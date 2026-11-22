import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { PgDemoOrderRepository, type DemoOrder } from '../../src/repositories/demo-orders.js';

test('demo order feed reads existing persisted records in a strictly read-only PostgreSQL snapshot', {
  skip: process.env.RUN_DEMO_ORDER_FEED_TESTS !== '1' ? 'Set RUN_DEMO_ORDER_FEED_TESTS=1 for the owner-confirmed demo database read-only test' : false,
  timeout: 30000
}, async t => {
  const config = loadConfig();
  const pool = createPool({ ...config, database: { ...config.database, max: 1 } });
  const client = await pool.connect();
  const app = buildApp({ frontendOrigin: 'https://shelf-sync-tau.vercel.app',
    products: { async list() { assert.fail(); }, async findById() { assert.fail(); } },
    orders: { async checkout() { assert.fail('read-only verification must not check out'); }, async findById() { assert.fail(); } },
    demoOrders: { enabled: true, repository: new PgDemoOrderRepository(client) } });
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
    const expected = await client.query<{ id: string; city: DemoOrder['city']; status: DemoOrder['status']; total: string; created_at: Date }>(
      'SELECT id, city, status, total, created_at FROM orders ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT $1', [20]);
    const response = await app.inject('/api/demo/orders');
    assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { orders: expected.rows.map(r => ({ id: r.id, city: r.city, status: r.status, total: Number(r.total), created_at: r.created_at.toISOString() })) });
    assert.ok(response.json().orders.length <= 20);
    for (let index = 1; index < response.json().orders.length; index++) {
      assert.ok(Date.parse(response.json().orders[index - 1].created_at) >= Date.parse(response.json().orders[index].created_at));
    }
    for (const order of response.json().orders) assert.deepEqual(Object.keys(order).sort(), ['city', 'created_at', 'id', 'status', 'total']);
    assert.equal((await app.inject('/api/admin/orders')).json().error.code, 'ADMIN_DISABLED');
    t.diagnostic(`Read-only response matched ${expected.rows.length} existing persisted demo orders; no fixtures, migrations or inventory writes.`);
  } finally {
    await app.close();
    try { await client.query('ROLLBACK'); } finally { client.release(); await pool.end(); }
  }
});
