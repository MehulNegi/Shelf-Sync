import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { OrderTracking, OrderTrackingRepository } from '../src/types/order.js';

const tracking: OrderTracking = {
  orderId: 'ord_test', status: 'confirmed', createdAt: '2026-11-21T10:00:00.000Z',
  history: [{ status: 'confirmed', occurredAt: '2026-11-21T10:00:00.100Z', recordedAt: '2026-11-21T10:00:00.100Z', source: 'order_created' }]
};
function app(repository: OrderTrackingRepository) {
  return buildApp({ frontendOrigin: 'http://localhost:5173', tracking: repository,
    products: { async list() { return []; }, async findById() { return undefined; } },
    orders: { async checkout() { assert.fail('tracking reads must not check out'); }, async findById() {
      return { id: 'ord_test', city: 'pune', status: 'confirmed', total: 1999,
        items: [{ productId: 'prod_001', name: 'Earphones', quantity: 1, unitPrice: 1999 }] };
    } }
  });
}

test('tracking returns persisted values without adding fields to existing order details', async t => {
  const api = app({ async findTrackingById(id) { assert.equal(id, tracking.orderId); return tracking; } });
  t.after(() => api.close());
  const response = await api.inject('/api/orders/ord_test/tracking');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), tracking);
  const details = await api.inject('/api/orders/ord_test');
  assert.deepEqual(details.json(), { id: 'ord_test', city: 'pune', status: 'confirmed', total: 1999,
    items: [{ productId: 'prod_001', name: 'Earphones', quantity: 1, unitPrice: 1999 }] });
});

test('legacy snapshots retain an unknown transition timestamp', async t => {
  const legacy: OrderTracking = { ...tracking, history: [{ status: 'confirmed', occurredAt: null, recordedAt: '2026-11-21T12:00:00.000Z', source: 'legacy_snapshot' }] };
  const api = app({ async findTrackingById() { return legacy; } });
  t.after(() => api.close());
  assert.deepEqual((await api.inject('/api/orders/ord_test/tracking')).json(), legacy);
});

test('tracking validates IDs and returns standard missing/error envelopes', async t => {
  const api = app({ async findTrackingById(id) { if (id === 'broken') throw new Error('private PostgreSQL details'); return undefined; } });
  t.after(() => api.close());
  const missing = await api.inject('/api/orders/missing/tracking');
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } });
  const oversized = await api.inject(`/api/orders/${'a'.repeat(101)}/tracking`);
  assert.equal(oversized.statusCode, 414);
  assert.equal(oversized.json().success, false);
  const broken = await api.inject('/api/orders/broken/tracking');
  assert.equal(broken.statusCode, 500);
  assert.equal(broken.json().error.code, 'INTERNAL_ERROR');
  assert.ok(!broken.body.includes('private PostgreSQL details'));
});

test('no public order list or status mutation routes are exposed', async t => {
  const api = app({ async findTrackingById() { return tracking; } });
  t.after(() => api.close());
  for (const request of [
    { method: 'GET' as const, url: '/api/orders' },
    { method: 'PATCH' as const, url: '/api/orders/ord_test', payload: { status: 'shipped' } },
    { method: 'POST' as const, url: '/api/orders/ord_test/status', payload: { status: 'processing' } },
    { method: 'POST' as const, url: '/api/orders/ord_test/tracking', payload: { status: 'delivered' } }
  ]) assert.equal((await api.inject(request)).statusCode, 404);
});
