import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadDemoOrderFeedConfig } from '../src/config/demo-orders.js';
import { PgDemoOrderRepository, type DemoOrder, type DemoOrderRepository } from '../src/repositories/demo-orders.js';
import { ApiError } from '../src/services/products.js';

const row: DemoOrder = { id: 'ord_fixture', city: 'pune', status: 'confirmed', total: 1999.5, created_at: '2026-11-22T12:00:00.000Z' };
function app(repository?: DemoOrderRepository, enabled = true) {
  return buildApp({ frontendOrigin: 'https://shelf-sync-tau.vercel.app',
    products: { async list() { return []; }, async findById() { return undefined; } },
    orders: { async checkout() { assert.fail('the feed must never call checkout'); }, async findById() { return undefined; } },
    ...(repository ? { demoOrders: { enabled, repository } } : {}) });
}

test('demo feed config is off by default, opt-in only and rejects ambiguous flags', () => {
  assert.equal(loadDemoOrderFeedConfig({}).enabled, false);
  assert.equal(loadDemoOrderFeedConfig({ DEMO_ORDER_FEED_ENABLED: 'false' }).enabled, false);
  assert.equal(loadDemoOrderFeedConfig({ DEMO_ORDER_FEED_ENABLED: 'true' }).enabled, true);
  for (const value of ['TRUE', '1', '', ' true']) assert.throws(() => loadDemoOrderFeedConfig({ DEMO_ORDER_FEED_ENABLED: value }), /DEMO_ORDER_FEED_ENABLED/);
});

test('absent or disabled feed fails closed before query validation or database access', async t => {
  for (const api of [app(), app({ async listLatest() { assert.fail('disabled feed must not read data'); } }, false)]) {
    t.after(() => api.close());
    for (const url of ['/api/demo/orders', '/api/demo/orders?limit=9999']) {
      const response = await api.inject(url);
      assert.equal(response.statusCode, 503);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.json(), { success: false, error: { code: 'DEMO_ORDERS_DISABLED', message: 'Demo order feed is not enabled' } });
    }
  }
});

test('enabled feed returns only the five documented order fields and cannot return more than 20 rows', async t => {
  const api = app({ async listLatest() {
    return Array.from({ length: 25 }, (_, index) => ({ ...row, id: `ord_${index}`, email: 'private-fixture@example.test', sessionToken: 'private-fixture-token' }));
  } });
  t.after(() => api.close());
  const response = await api.inject('/api/demo/orders');
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(response.json()), ['orders']); assert.equal(response.json().orders.length, 20);
  assert.deepEqual(Object.keys(response.json().orders[0]).sort(), ['city', 'created_at', 'id', 'status', 'total']);
  assert.deepEqual(response.json().orders[0], { ...row, id: 'ord_0' });
  assert.ok(!response.body.includes('private-fixture')); assert.equal(response.headers['set-cookie'], undefined);
});

test('empty persisted dataset returns an empty list without fabricated orders', async t => {
  const api = app({ async listLatest() { return []; } }); t.after(() => api.close());
  const response = await api.inject('/api/demo/orders');
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { orders: [] });
});

test('the fixed feed rejects all query parameters before reading data', async t => {
  const api = app({ async listLatest() { assert.fail('invalid parameters must not reach SQL'); } }); t.after(() => api.close());
  for (const query of ['limit=1000', 'limit=20', 'city=pune', 'cursor=anything', 'id=one&id=two', 'q=%27%3BDROP%20TABLE%20orders']) {
    const response = await api.inject('/api/demo/orders?' + query);
    assert.equal(response.statusCode, 400, query); assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('global polling quota cannot be bypassed with forwarded IPs and recovers in the next minute', async t => {
  let now = 0, reads = 0;
  t.mock.method(performance, 'now', () => now);
  const api = app({ async listLatest() { reads++; return []; } }); t.after(() => api.close());
  for (let index = 0; index < 60; index++) {
    assert.equal((await api.inject({ url: '/api/demo/orders', headers: { 'x-forwarded-for': `192.0.2.${index}` } })).statusCode, 200);
  }
  const denied = await api.inject({ url: '/api/demo/orders', headers: { 'x-forwarded-for': '198.51.100.1' } });
  assert.equal(denied.statusCode, 429); assert.equal(denied.json().error.code, 'RATE_LIMITED');
  assert.equal(denied.headers['retry-after'], '60'); assert.equal(denied.headers['cache-control'], 'no-store'); assert.equal(reads, 60);
  now = 60_000;
  assert.equal((await api.inject('/api/demo/orders')).statusCode, 200); assert.equal(reads, 61);
});

test('feed access is independent of CORS and cannot enable any admin read or mutation endpoint', async t => {
  const api = app({ async listLatest() { return [row]; } }); t.after(() => api.close());
  const response = await api.inject({ url: '/api/demo/orders', headers: { origin: 'https://other.example' } });
  assert.equal(response.statusCode, 200); assert.equal(response.headers['access-control-allow-origin'], undefined);
  for (const route of ['overview', 'inventory', 'orders', 'events', 'profitability/overview']) {
    const denied = await api.inject('/api/admin/' + route);
    assert.equal(denied.statusCode, 503); assert.equal(denied.json().error.code, 'ADMIN_DISABLED');
  }
  for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
    assert.equal((await api.inject({ method, url: '/api/demo/orders', payload: {} })).statusCode, 404);
  }
  assert.deepEqual((await api.inject('/api/health')).json(), { status: 'ok' });
});

test('PostgreSQL retrieval selects only allowed columns with a parameterized limit and deterministic newest-first order', async () => {
  let reads = 0;
  const db = { async query(sql: string, values: unknown[]) {
    reads++; assert.match(sql, /^SELECT id, city, status, total, created_at FROM orders/);
    assert.match(sql, /ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT \$1/); assert.deepEqual(values, [20]);
    return { rows: [{ ...row, total: '1999.50', created_at: new Date(row.created_at), extra: 'not-public' }] };
  } } as unknown as Pick<Pool, 'query'>;
  assert.deepEqual(await new PgDemoOrderRepository(db).listLatest(), [row]); assert.equal(reads, 1);
});

test('database failures return a sanitized 503, never an empty or fake successful feed', async t => {
  const db = { async query() { throw new Error('postgresql://private-credential@private-host'); } } as unknown as Pick<Pool, 'query'>;
  const api = app(new PgDemoOrderRepository(db)); t.after(() => api.close());
  const response = await api.inject('/api/demo/orders');
  assert.equal(response.statusCode, 503); assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Demo orders are temporarily unavailable' } });
  assert.ok(!response.body.includes('private-credential'));
  await assert.rejects(new PgDemoOrderRepository(db).listLatest(), error => error instanceof ApiError && error.statusCode === 503);
});
