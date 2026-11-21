import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { cities } from '../types/product.js';
import { databaseDirectory } from './migrations.js';

interface SeedProduct {
  id: string; name: string; description: string; category: string;
  price: number; imageUrl: string; stock: number[];
}

export async function seed(pool: Pool): Promise<void> {
  const products = JSON.parse(await readFile(new URL('seed/products.json', databaseDirectory), 'utf8')) as SeedProduct[];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73421901)');
    for (const product of products) {
      await client.query(`INSERT INTO products (id, name, description, category, price, image_url)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
        price = EXCLUDED.price, image_url = EXCLUDED.image_url`,
      [product.id, product.name, product.description, product.category, product.price, product.imageUrl]);
      for (const [index, city] of cities.entries()) {
        // Re-running seed must never reset stock/version after a real checkout.
        await client.query(`INSERT INTO inventory (product_id, city, quantity)
          VALUES ($1, $2, $3) ON CONFLICT (product_id, city) DO NOTHING`, [product.id, city, product.stock[index]]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
