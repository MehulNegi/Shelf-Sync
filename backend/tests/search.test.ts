import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from '@opensearch-project/opensearch';
import { loadOpenSearchConfig } from '../src/config/opensearch.js';
import { SearchProductRepository } from '../src/repositories/search-products.js';
import { SearchProjection, documentId, searchQuery, productMappings } from '../src/services/search-projection.js';
import type { Product } from '../src/types/product.js';

const product: Product = { id: 'prod_001', name: 'Wireless Bluetooth Earphones', description: 'Wireless earphones',
  category: 'electronics', price: 1999, imageUrl: '/images/earphones.jpg', city: 'delhi', stock: 8, available: true };

test('OpenSearch connection requires verified HTTPS and keeps credentials outside the URL', () => {
  const env = { OPENSEARCH_URL: 'https://search.example.com:9200', OPENSEARCH_USERNAME: 'test', OPENSEARCH_PASSWORD: 'test-only' };
  assert.deepEqual(loadOpenSearchConfig(env).client.ssl, { rejectUnauthorized: true });
  assert.throws(() => loadOpenSearchConfig({}), /OPENSEARCH_URL/);
  for (const url of ['http://search.example.com', 'https://user:pass@search.example.com', 'https://search.example.com/path', 'https://search.example.com?ssl=false']) {
    assert.throws(() => loadOpenSearchConfig({ ...env, OPENSEARCH_URL: url }), /HTTPS service origin/);
  }
  assert.throws(() => loadOpenSearchConfig({ ...env, OPENSEARCH_PASSWORD: '' }), /OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD/);
  assert.throws(() => loadOpenSearchConfig({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /verified TLS/);
  assert.throws(() => loadOpenSearchConfig({ ...env, OPENSEARCH_CA_CERT_PATH: '/missing/ca.pem' }), /PEM CA/);
  assert.throws(() => loadOpenSearchConfig({ ...env, OPENSEARCH_INDEX: '../Invalid' }), /OPENSEARCH_INDEX/);
});

test('search query combines typo tolerance with exact city/category and inclusive price filters', () => {
  const query = searchQuery({ city: 'delhi', q: 'blutooth earphones', category: 'electronics', minPrice: 100, maxPrice: 2000 });
  assert.deepEqual(query.bool.filter, [{ term: { city: 'delhi' } }, { term: { catalogReady: true } },
    { term: { category: 'electronics' } }, { range: { price: { gte: 100, lte: 2000 } } }]);
  assert.deepEqual(query.bool.must, [{ multi_match: { query: 'blutooth earphones', fields: ['name^3', 'description'], fuzziness: 'AUTO', operator: 'and' } }]);
  assert.deepEqual(searchQuery({ city: 'pune', q: ' ' }).bool.must, [{ match_all: {} }]);
  assert.notEqual(documentId('prod_001', 'pune'), documentId('prod_001', 'delhi'));
  assert.equal(documentId('prod_001', 'pune'), documentId('prod_001', 'pune'));
  assert.equal(productMappings.properties.inventoryVersion.type, 'long');
});

test('search drains all scroll pages, strips projection metadata, and cleans up the cursor', async () => {
  let cleared = '';
  let query: unknown;
  const client = {
    async search(request: unknown) { query = request; return { body: { _scroll_id: 'cursor', hits: { hits: [{ _source: { ...product, inventoryVersion: 7, catalogReady: true } }] } } }; },
    async scroll() { return { body: { _scroll_id: 'cursor', hits: { hits: [] } } }; },
    async clearScroll({ scroll_id }: { scroll_id: string }) { cleared = scroll_id; }
  } as unknown as Client;
  const result = await new SearchProjection(client, 'products').search({ city: 'delhi' });
  assert.deepEqual(result, [product]);
  assert.equal(cleared, 'cursor');
  assert.ok(JSON.stringify(query).includes('catalogReady'));
});

test('OpenSearch failure falls back to PostgreSQL and details always use PostgreSQL', async () => {
  let fallback = 0;
  let received: unknown;
  const repository = new SearchProductRepository({ async search() { throw new Error('private connection error'); } }, {
    async list(filters) { received = filters; return [product]; }, async findById() { return product; }
  }, () => fallback++);
  assert.deepEqual(await repository.list({ city: 'delhi', q: 'bluetooth' }), [product]);
  assert.deepEqual(received, { city: 'delhi', q: 'bluetooth' });
  assert.equal(fallback, 1);
  assert.equal(await repository.findById(product.id, 'delhi'), product);
});

test('a healthy empty OpenSearch result is preserved without a PostgreSQL retry', async () => {
  const repository = new SearchProductRepository({ async search() { return []; } }, {
    async list() { assert.fail('empty is a valid search result'); }, async findById() { return undefined; }
  });
  assert.deepEqual(await repository.list({ city: 'pune', q: 'missing' }), []);
});
