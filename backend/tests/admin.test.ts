import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { AdminCursor } from '../src/services/admin-cursor.js';
import { AdminService, utcMicros } from '../src/services/admin.js';
import { ApiError } from '../src/services/products.js';
import type { AdminRepository } from '../src/types/admin.js';

const empty: AdminRepository = {
  async overview() { assert.fail('not used'); },
  async inventory() { return { asOf: '2026-11-21T12:00:00.000Z', items: [], next: null }; },
  async orders() { return { asOf: '2026-11-21T12:00:00.000Z', items: [], next: null }; },
  async events() { return { asOf: '2026-11-21T12:00:00.000Z', items: [], next: null }; }
};
function app(repository = empty) {
  return buildApp({ frontendOrigin: 'http://localhost:5173', products: { async list() { return []; }, async findById() { return undefined; } },
    orders: { async checkout() { assert.fail(); }, async findById() { return undefined; } },
    // Authentication is exercised with real signatures in admin-auth.test.ts.
    admin: { async authorize() { return { scope: 'isolated-admin' }; }, service: new AdminService(repository, new AdminCursor(randomBytes(32))) }
  });
}

test('admin list schemas preserve empty response shapes and default bounded limits', async t => {
  const api = app(); t.after(() => api.close());
  for (const endpoint of ['inventory', 'orders', 'events']) {
    const response = await api.inject(`/api/admin/${endpoint}`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { asOf: '2026-11-21T12:00:00.000Z', [endpoint]: [], page: { limit: 50, nextCursor: null } });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('unknown/repeated filters, invalid enums, limits and UTC date ranges are rejected', async t => {
  let reads = 0;
  const api = app({ ...empty, async inventory() { reads++; return empty.inventory({}, 50); }, async orders() { reads++; return empty.orders({}, 50); } });
  t.after(() => api.close());
  for (const url of [
    '/api/admin/overview?city=pune', '/api/admin/inventory?city=Pune', '/api/admin/inventory?stockStatus=available',
    '/api/admin/inventory?limit=0', '/api/admin/inventory?limit=101', '/api/admin/inventory?limit=1.5',
    '/api/admin/inventory?limit=2&limit=3', '/api/admin/inventory?category=a&category=b',
    '/api/admin/inventory?unexpected=1', '/api/admin/orders?status=shipped',
    '/api/admin/orders?createdFrom=2026-02-30T00:00:00Z', '/api/admin/orders?createdFrom=2026-11-21',
    '/api/admin/orders?createdFrom=2026-11-21T00:00:00%2B05:30',
    '/api/admin/orders?createdFrom=2026-11-21T00:00:00.000002Z&createdTo=2026-11-21T00:00:00.000001Z',
    '/api/admin/events?publicationState=indexed'
  ]) {
    const response = await api.inject(url); assert.equal(response.statusCode, 400, url); assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  }
  assert.equal(reads, 0);
  assert.equal(utcMicros('2026-01-01T00:00:00.000002Z')! - utcMicros('2026-01-01T00:00:00.000001Z')!, 1n);
});

test('signed cursor integrity, expiration, scope and filter binding are enforced', () => {
  let now = 1000000;
  const codec = new AdminCursor(randomBytes(32), () => now);
  const filters = { city: 'pune' as const };
  const after = ['2026-11-21T12:00:00.123456Z', 'ord_fixture'];
  const cursor = codec.encode('orders', filters, 1, 'admin-a', after);
  assert.deepEqual(codec.decode(cursor, 'orders', filters, 1, 'admin-a'), after);
  for (const decode of [
    () => codec.decode(cursor + 'x', 'orders', filters, 1, 'admin-a'),
    () => codec.decode(cursor, 'events', filters, 1, 'admin-a'),
    () => codec.decode(cursor, 'orders', { city: 'delhi' }, 1, 'admin-a'),
    () => codec.decode(cursor, 'orders', filters, 2, 'admin-a'),
    () => codec.decode(cursor, 'orders', filters, 1, 'admin-b')
  ]) assert.throws(decode, { code: 'INVALID_CURSOR' });
  now += 900000;
  assert.throws(() => codec.decode(cursor, 'orders', filters, 1, 'admin-a'), { code: 'INVALID_CURSOR' });
});

test('malformed or oversized cursors return the exact invalid-cursor envelope', async t => {
  const api = app(); t.after(() => api.close());
  for (const cursor of ['', 'invalid', 'a'.repeat(2049)]) {
    const response = await api.inject(`/api/admin/orders?cursor=${cursor}`);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { success: false, error: { code: 'INVALID_CURSOR', message: 'Invalid or expired cursor' } });
  }
});

test('database availability errors never return fabricated zero metrics', async t => {
  const api = app({ ...empty, async overview() { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Operational data is temporarily unavailable'); } });
  t.after(() => api.close());
  const response = await api.inject('/api/admin/overview');
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Operational data is temporarily unavailable' } });
});
