import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { ApiError } from '../src/services/products.js';
import { normalizeOrder } from '../src/services/orders.js';
import type { OrderInput, OrderRepository } from '../src/types/order.js';

const unavailableProducts = {
  async list() { return []; },
  async findById() { return undefined; }
};
const noOrders: OrderRepository = {
  async checkout() { assert.fail('invalid requests must not reach checkout'); },
  async findById() { return undefined; }
};

test('checkout rejects empty carts, invalid cities, quantities, IDs, and client prices', async t => {
  const app = buildApp({ products: unavailableProducts, orders: noOrders, frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  const valid = { city: 'pune', items: [{ productId: 'prod_001', quantity: 1 }] };
  const payloads: unknown[] = [null, [], {}, { ...valid, city: 'Pune' }, { ...valid, items: [] },
    { ...valid, items: null }, { ...valid, items: [null] }, { ...valid, total: 0 },
    { ...valid, items: [{ productId: 'prod_001', quantity: 1, unitPrice: 0 }] },
    { ...valid, items: [{ productId: '', quantity: 1 }] },
    { ...valid, items: [{ productId: '  ', quantity: 1 }] },
    { ...valid, items: Array.from({ length: 101 }, () => valid.items[0]) },
    { ...valid, items: [{ productId: 'prod_001', quantity: 2147483647 }, { productId: 'prod_001', quantity: 1 }] }
  ];
  for (const quantity of [0, -1, 1.5, '1', true, null, 2147483648]) {
    payloads.push({ ...valid, items: [{ productId: 'prod_001', quantity }] });
  }
  for (const payload of payloads) {
    const response = await app.inject({ method: 'POST', url: '/api/orders', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(response.json().success, false);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  }
});

test('checkout normalizes duplicate IDs, sorts them, and returns the exact 201 contract', async t => {
  let captured: OrderInput | undefined;
  const app = buildApp({ products: unavailableProducts, frontendOrigin: 'http://localhost:5173', orders: {
    ...noOrders,
    async checkout(input) {
      captured = input;
      return { success: true, orderId: 'ord_test', status: 'confirmed', total: 5997 };
    }
  } });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/orders', payload: {
    city: 'delhi', items: [{ productId: 'z', quantity: 1 }, { productId: 'a', quantity: 2 }, { productId: 'z', quantity: 3 }]
  } });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(captured, { city: 'delhi', items: [{ productId: 'a', quantity: 2 }, { productId: 'z', quantity: 4 }] });
  assert.deepEqual(response.json(), { success: true, orderId: 'ord_test', status: 'confirmed', total: 5997 });
});

test('insufficient-stock errors use the exact shared 409 response', async t => {
  const app = buildApp({ products: unavailableProducts, frontendOrigin: 'http://localhost:5173', orders: {
    ...noOrders, async checkout() { throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Not enough stock available'); }
  } });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/orders', payload: { city: 'pune', items: [{ productId: 'prod_001', quantity: 1 }] } });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { success: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock available' } });
});

test('missing order uses standard 404 and order failures remain sanitized', async t => {
  const app = buildApp({ products: unavailableProducts, frontendOrigin: 'http://localhost:5173', orders: {
    ...noOrders, async checkout() { throw new Error('private database details'); }
  } });
  t.after(() => app.close());
  const missing = await app.inject('/api/orders/ord_missing');
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } });
  const failure = await app.inject({ method: 'POST', url: '/api/orders', payload: { city: 'pune', items: [{ productId: 'prod_001', quantity: 1 }] } });
  assert.equal(failure.statusCode, 500);
  assert.equal(failure.json().error.code, 'INTERNAL_ERROR');
  assert.ok(!failure.body.includes('private database details'));
});

test('non-finite quantities are rejected without schema coercion', () => {
  for (const quantity of [NaN, Infinity, -Infinity]) {
    assert.throws(() => normalizeOrder({ city: 'pune', items: [{ productId: 'prod_001', quantity }] }), { code: 'VALIDATION_ERROR' });
  }
});
