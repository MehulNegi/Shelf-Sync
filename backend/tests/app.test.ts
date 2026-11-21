import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { City, Product, ProductFilters, ProductRepository } from '../src/types/product.js';

const stocks: Record<City, number> = { pune: 1, delhi: 8, bengaluru: 3 };
const earphones = (city: City): Product => ({
  id: 'prod_001', name: 'Wireless Bluetooth Earphones', description: 'Noise-isolating wireless earphones',
  category: 'electronics', price: 1999, imageUrl: '/images/earphones.jpg',
  city, stock: stocks[city], available: true
});

// Explicit test double; the production server always injects PgProductRepository.
function repository(onList?: (filters: ProductFilters) => void): ProductRepository {
  return {
    async list(filters) { onList?.(filters); return [earphones(filters.city)]; },
    async findById(id, city) { return id === 'prod_001' ? earphones(city) : undefined; }
  };
}

test('health returns the exact shared response', async t => {
  const app = buildApp({ products: repository(), frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  const response = await app.inject('/api/health');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('list response matches the contract and uses INR rupees', async t => {
  const app = buildApp({ products: repository(), frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  const response = await app.inject('/api/products?city=pune');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { products: [earphones('pune')], total: 1 });
});

test('details request passes selected city to the repository', async t => {
  const app = buildApp({ products: repository(), frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  for (const city of ['pune', 'delhi', 'bengaluru'] as const) {
    const response = await app.inject(`/api/products/prod_001?city=${city}`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), earphones(city));
  }
});

test('search, category, and numeric price filters reach the product service', async t => {
  let actual: ProductFilters | undefined;
  const app = buildApp({ products: repository(filters => { actual = filters; }), frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  const response = await app.inject('/api/products?city=delhi&q=Bluetooth&category=electronics&minPrice=1000.50&maxPrice=2000');
  assert.equal(response.statusCode, 200);
  assert.deepEqual({ ...actual }, { city: 'delhi', q: 'Bluetooth', category: 'electronics', minPrice: 1000.5, maxPrice: 2000 });
});

test('invalid queries return standard errors before repository access', async t => {
  const app = buildApp({ products: {
    async list() { assert.fail('invalid queries must not access storage'); },
    async findById() { assert.fail('invalid queries must not access storage'); }
  }, frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  for (const url of [
    '/api/products', '/api/products?city=Pune', '/api/products?city=mumbai',
    '/api/products?city=pune&minPrice=-1', '/api/products?city=pune&maxPrice=NaN',
    '/api/products?city=pune&minPrice=Infinity', '/api/products?city=pune&minPrice=2&maxPrice=1',
    '/api/products?city=pune&unexpected=true', '/api/products?city=pune&city=delhi',
    '/api/products?city=pune&q=' + 'a'.repeat(201), '/api/products/prod_001',
    '/api/products/prod_001?city=unknown'
  ]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().success, false);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.equal(typeof response.json().error.message, 'string');
  }
});

test('missing products and routes return standard 404 errors', async t => {
  const app = buildApp({ products: repository(), frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  const response = await app.inject('/api/products/missing?city=pune');
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } });
  const unknown = await app.inject('/api/missing');
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'NOT_FOUND');
});

test('orders return explicit 501 errors and never fake success', async t => {
  const app = buildApp({ products: repository(), frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  for (const request of [{ method: 'POST' as const, url: '/api/orders', payload: { city: 'pune', items: [{ productId: 'prod_001', quantity: 1 }] } }, { method: 'GET' as const, url: '/api/orders/ord_001' }]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 501);
    assert.equal(response.json().success, false);
    assert.equal(response.json().error.code, 'NOT_IMPLEMENTED');
  }
});

test('database failures do not expose driver errors or credentials', async t => {
  const app = buildApp({ products: { ...repository(), async list() { throw new Error('postgresql://secret-password@private-host'); } }, frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  const response = await app.inject('/api/products?city=pune');
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { success: false, error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred' } });
});

test('CORS permits only the configured frontend origin', async t => {
  const app = buildApp({ products: repository(), frontendOrigin: 'http://localhost:5173' });
  t.after(() => app.close());
  const allowed = await app.inject({ url: '/api/health', headers: { origin: 'http://localhost:5173' } });
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
  const denied = await app.inject({ url: '/api/health', headers: { origin: 'https://untrusted.example' } });
  assert.notEqual(denied.headers['access-control-allow-origin'], 'https://untrusted.example');
});
