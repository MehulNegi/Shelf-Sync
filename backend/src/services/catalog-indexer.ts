import type { Pool, QueryResult } from 'pg';
import { cities, type City } from '../types/product.js';
import type { ProductDocument } from './search-projection.js';

interface CatalogRow {
  id: string; name: string; description: string; category: string; price: string;
  image_url: string; city: City; quantity: number; version: string;
}

export async function indexCatalog(pool: Pool, projection: { ensureIndex(): Promise<void>; upsertProduct(doc: ProductDocument): Promise<void> }) {
  await projection.ensureIndex();
  let lastId: string | null = null;
  let count = 0;
  while (true) {
    const result: QueryResult<CatalogRow> = await pool.query<CatalogRow>(`WITH catalog AS (
      SELECT * FROM products WHERE ($1::text IS NULL OR id > $1) ORDER BY id LIMIT 100
    ) SELECT p.id, p.name, p.description, p.category, p.price, p.image_url, c.city,
      COALESCE(i.quantity, 0) AS quantity, COALESCE(i.version, 0)::text AS version
      FROM catalog p CROSS JOIN unnest($2::text[]) AS c(city)
      LEFT JOIN inventory i ON i.product_id = p.id AND i.city = c.city ORDER BY p.id, c.city`, [lastId, cities]);
    if (!result.rows.length) break;
    for (const row of result.rows) {
      const inventoryVersion = Number(row.version);
      if (!Number.isSafeInteger(inventoryVersion)) throw new Error('Inventory version exceeds JSON safe integer range');
      await projection.upsertProduct({ id: row.id, name: row.name, description: row.description, category: row.category,
        price: Number(row.price), imageUrl: row.image_url, city: row.city, stock: row.quantity,
        available: row.quantity > 0, inventoryVersion, catalogReady: true });
      count++;
    }
    lastId = result.rows.at(-1)!.id;
  }
  return count;
}
