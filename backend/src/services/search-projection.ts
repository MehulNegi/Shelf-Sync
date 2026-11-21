import { createHash } from 'node:crypto';
import type { Client } from '@opensearch-project/opensearch';
import type { Product, ProductFilters } from '../types/product.js';
import type { InventoryEvent } from '../types/inventory-event.js';

export interface ProductDocument extends Product { inventoryVersion: number; catalogReady: boolean }
export function documentId(productId: string, city: string) {
  return createHash('sha256').update(JSON.stringify([productId, city])).digest('hex');
}
export function responseStatus(error: unknown): number | undefined {
  return (error as { statusCode?: number; meta?: { statusCode?: number } } | undefined)?.statusCode ??
    (error as { meta?: { statusCode?: number } } | undefined)?.meta?.statusCode;
}
export function isTransientSearchError(error: unknown) {
  const status = responseStatus(error);
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

// Both scripts run atomically on the target document. Bootstrap can fill catalog
// metadata after an early event without overwriting that event's newer stock.
export const bootstrapScript = `
if (ctx._source.inventoryVersion == null || params.doc.inventoryVersion > ctx._source.inventoryVersion) {
  ctx._source.stock = params.doc.stock;
  ctx._source.available = params.doc.available;
  ctx._source.inventoryVersion = params.doc.inventoryVersion;
}
ctx._source.id = params.doc.id;
ctx._source.name = params.doc.name;
ctx._source.description = params.doc.description;
ctx._source.category = params.doc.category;
ctx._source.price = params.doc.price;
ctx._source.imageUrl = params.doc.imageUrl;
ctx._source.city = params.doc.city;
ctx._source.catalogReady = true;`;

export const inventoryScript = `
if (ctx._source.inventoryVersion == null || params.event.inventoryVersion > ctx._source.inventoryVersion) {
  ctx._source.id = params.event.productId;
  ctx._source.city = params.event.city;
  ctx._source.stock = params.event.quantity;
  ctx._source.available = params.event.quantity > 0;
  ctx._source.inventoryVersion = params.event.inventoryVersion;
  ctx._source.lastEventId = params.event.eventId;
  ctx._source.occurredAt = params.event.occurredAt;
  if (ctx._source.catalogReady == null) { ctx._source.catalogReady = false; }
} else { ctx.op = 'none'; }`;

export const productMappings = {
  dynamic: 'strict' as const,
  properties: {
    id: { type: 'keyword' as const }, name: { type: 'text' as const }, description: { type: 'text' as const },
    category: { type: 'keyword' as const }, price: { type: 'scaled_float' as const, scaling_factor: 100 },
    imageUrl: { type: 'keyword' as const, index: false }, city: { type: 'keyword' as const },
    stock: { type: 'integer' as const }, available: { type: 'boolean' as const },
    inventoryVersion: { type: 'long' as const }, catalogReady: { type: 'boolean' as const },
    lastEventId: { type: 'keyword' as const }, occurredAt: { type: 'date' as const }
  }
};

export function searchQuery(filters: ProductFilters) {
  const filter: object[] = [{ term: { city: filters.city } }, { term: { catalogReady: true } }];
  if (filters.category) filter.push({ term: { category: filters.category } });
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) filter.push({ range: { price: {
    ...(filters.minPrice !== undefined ? { gte: filters.minPrice } : {}),
    ...(filters.maxPrice !== undefined ? { lte: filters.maxPrice } : {})
  } } });
  return { bool: { filter, must: filters.q?.trim() ? [{ multi_match: {
    query: filters.q.trim(), fields: ['name^3', 'description'], fuzziness: 'AUTO', operator: 'and' as const
  } }] : [{ match_all: {} }] } };
}

export class SearchProjection {
  constructor(readonly client: Client, readonly index: string) {}

  async ensureIndex() {
    if (!(await this.client.indices.exists({ index: this.index })).body) {
      try { await this.client.indices.create({ index: this.index, body: { mappings: productMappings } }); }
      catch (error) {
        const type = (error as { meta?: { body?: { error?: { type?: string } } } })?.meta?.body?.error?.type;
        if (type !== 'resource_already_exists_exception') throw error;
      }
    }
    await this.client.indices.putMapping({ index: this.index, body: productMappings });
  }

  async upsertProduct(doc: ProductDocument) {
    await this.client.update({ index: this.index, id: documentId(doc.id, doc.city), retry_on_conflict: 5,
      body: { scripted_upsert: true, upsert: {}, script: { lang: 'painless', source: bootstrapScript, params: { doc } } } });
  }

  async applyInventory(event: InventoryEvent) {
    await this.client.update({ index: this.index, id: documentId(event.productId, event.city), retry_on_conflict: 5,
      body: { scripted_upsert: true, upsert: {}, script: { lang: 'painless', source: inventoryScript, params: { event } } } });
  }

  async search(filters: ProductFilters): Promise<Product[]> {
    const products: Product[] = [];
    let scrollId: string | undefined;
    try {
      let response = await this.client.search({ index: this.index, size: 500, scroll: '1m', body: { query: searchQuery(filters), sort: [{ id: 'asc' }] } });
      while (true) {
        scrollId = response.body._scroll_id ?? scrollId;
        const hits = response.body.hits.hits;
        if (!hits.length) break;
        for (const hit of hits) {
          const doc = hit._source as ProductDocument;
          products.push({ id: doc.id, name: doc.name, description: doc.description, category: doc.category,
            price: doc.price, imageUrl: doc.imageUrl, city: doc.city, stock: doc.stock, available: doc.available });
        }
        if (!scrollId) break;
        response = await this.client.scroll({ scroll_id: scrollId, scroll: '1m' });
      }
      return products;
    } finally {
      if (scrollId) await this.client.clearScroll({ scroll_id: scrollId }).catch(() => undefined);
    }
  }
}
