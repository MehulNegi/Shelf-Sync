import type { Pool, QueryResultRow } from 'pg';
import type { City, Product, ProductFilters, ProductRepository } from '../types/product.js';

interface ProductRow extends QueryResultRow {
  id: string;
  name: string;
  description: string;
  category: string;
  price: string;
  image_url: string;
  stock: number;
}

const selectProduct = `SELECT p.id, p.name, p.description, p.category, p.price,
  p.image_url, COALESCE(i.quantity, 0) AS stock
  FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.city = $1`;

function toProduct(row: ProductRow, city: City): Product {
  return {
    id: row.id, name: row.name, description: row.description,
    category: row.category, price: Number(row.price), imageUrl: row.image_url,
    city, stock: row.stock, available: row.stock > 0
  };
}

export class PgProductRepository implements ProductRepository {
  constructor(private readonly db: Pick<Pool, 'query'>) {}

  async list(filters: ProductFilters): Promise<Product[]> {
    const values: (string | number)[] = [filters.city];
    const clauses: string[] = [];
    if (filters.q) {
      // Treat LIKE metacharacters as literal search text.
      values.push(`%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
      clauses.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
    }
    if (filters.category) {
      values.push(filters.category);
      clauses.push(`p.category = $${values.length}`);
    }
    if (filters.minPrice !== undefined) {
      values.push(filters.minPrice);
      clauses.push(`p.price >= $${values.length}`);
    }
    if (filters.maxPrice !== undefined) {
      values.push(filters.maxPrice);
      clauses.push(`p.price <= $${values.length}`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.db.query<ProductRow>(`${selectProduct}${where} ORDER BY p.id`, values);
    return rows.map(row => toProduct(row, filters.city));
  }

  async findById(id: string, city: City): Promise<Product | undefined> {
    const { rows } = await this.db.query<ProductRow>(`${selectProduct} WHERE p.id = $2`, [city, id]);
    return rows[0] ? toProduct(rows[0], city) : undefined;
  }
}
