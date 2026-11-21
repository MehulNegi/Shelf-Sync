import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createOpenSearchClient, loadOpenSearchConfig } from '../../src/config/opensearch.js';
import { SearchProjection, documentId, type ProductDocument } from '../../src/services/search-projection.js';
import { buildApp } from '../../src/app.js';
import { SearchProductRepository } from '../../src/repositories/search-products.js';

test('live OpenSearch mappings, fuzzy API search, and atomic version guards', {
  skip: process.env.RUN_SEARCH_TESTS !== '1' ? 'Set RUN_SEARCH_TESTS=1 with Aiven OpenSearch credentials' : false
}, async t => {
  const config = loadOpenSearchConfig();
  const client = createOpenSearchClient(config);
  const index = `shelfsync-test-${randomUUID()}`;
  let created = false;
  t.after(async () => { try { if (created) await client.indices.delete({ index }); } finally { await client.close(); } });
  const projection = new SearchProjection(client, index);
  await projection.ensureIndex(); created = true;
  await projection.ensureIndex();
  const product: ProductDocument = { id: 'test_earphones', name: 'Wireless Bluetooth Earphones', description: 'Noise-isolating wireless earphones',
    category: 'electronics', price: 1999, imageUrl: '/images/earphones.jpg', city: 'pune', stock: 1, available: true, inventoryVersion: 1, catalogReady: true };
  for (const [city, stock] of [['pune', 1], ['delhi', 8], ['bengaluru', 3]] as const) await projection.upsertProduct({ ...product, city, stock });
  await client.indices.refresh({ index });
  const api = buildApp({ frontendOrigin: 'http://localhost:5173', products: new SearchProductRepository(projection, {
    async list() { assert.fail('live search must not silently fall back to PostgreSQL'); }, async findById() { return undefined; }
  }), orders: { async checkout() { assert.fail('search tests must not check out'); }, async findById() { return undefined; } } });
  t.after(() => api.close());

  await t.test('real fuzzy queries and city/category/price filters preserve the HTTP contract', async () => {
    for (const [city, stock] of [['pune', 1], ['delhi', 8], ['bengaluru', 3]] as const) {
      const result = await api.inject(`/api/products?city=${city}&q=blutooth%20earphones&category=electronics&minPrice=1999&maxPrice=2000`);
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.json(), { products: [{ id: product.id, name: product.name, description: product.description,
        category: product.category, price: product.price, imageUrl: product.imageUrl, city, stock, available: true }], total: 1 });
    }
    assert.deepEqual((await api.inject('/api/products?city=pune&category=groceries')).json(), { products: [], total: 0 });
    assert.deepEqual((await api.inject('/api/products?city=pune&minPrice=2000')).json(), { products: [], total: 0 });
  });

  await t.test('duplicates, old events, and stale bootstrap data cannot overwrite newer inventory', async () => {
    const event = { eventId: randomUUID(), type: 'inventory.changed' as const, schemaVersion: 1 as const,
      productId: product.id, city: product.city, quantity: 0, inventoryVersion: 8, occurredAt: new Date().toISOString() };
    await projection.applyInventory(event);
    await projection.applyInventory(event);
    await projection.applyInventory({ ...event, eventId: randomUUID(), inventoryVersion: 7, quantity: 99 });
    await projection.upsertProduct({ ...product, name: 'Updated catalog name', stock: 99 });
    const source = (await client.get({ index, id: documentId(product.id, product.city) })).body._source;
    assert.equal(source.stock, 0); assert.equal(source.inventoryVersion, 8); assert.equal(source.lastEventId, event.eventId);
    assert.equal(source.name, 'Updated catalog name');
  });

  await t.test('an event arriving before bootstrap stays hidden until catalog metadata is filled', async () => {
    const event = { eventId: randomUUID(), type: 'inventory.changed' as const, schemaVersion: 1 as const,
      productId: 'test_early', city: product.city, quantity: 4, inventoryVersion: 20, occurredAt: new Date().toISOString() };
    await projection.applyInventory(event);
    const id = documentId(event.productId, event.city);
    assert.equal((await client.get({ index, id })).body._source.catalogReady, false);
    await projection.upsertProduct({ ...product, id: event.productId });
    const source = (await client.get({ index, id })).body._source;
    assert.equal(source.catalogReady, true); assert.equal(source.stock, 4); assert.equal(source.inventoryVersion, 20);
  });
});
