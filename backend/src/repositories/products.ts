import type { Pool, QueryResultRow } from 'pg';
import { ApiError } from '../services/products.js';
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

const selectProduct = (time = 'statement_timestamp()') => `SELECT p.id, p.name, p.description, p.category, p.price,
  p.image_url, COALESCE(i.quantity, 0) - COALESCE((SELECT sum(r.quantity)::int FROM cart_reservations r WHERE r.product_id=p.id AND r.city=$1 AND r.state='active' AND r.expires_at > ${time}),0) AS stock
  FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.city = $1`;

function toProduct(row: ProductRow, city: City): Product {
  if (row.stock < 0) throw new Error('Inventory reservation invariant failed');
  return {
    id: row.id, name: row.name, description: row.description,
    category: row.category, price: Number(row.price), imageUrl: row.image_url,
    city, stock: row.stock, available: row.stock > 0
  };
}

export class PgProductRepository implements ProductRepository {
  constructor(private readonly db: Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>) {}

  private async query(sql: string, values: (string | number)[]) {
    try { return await this.db.query<ProductRow>(sql,values); }
    catch (error) {
      const e=error as {code?:string;message?:string};
      if (/^(08|53|57|58|E)/.test(e.code??'') || e.message==='Cannot use a pool after calling end on the pool') throw new ApiError(503,'DATABASE_UNAVAILABLE','Product availability is temporarily unavailable');
      throw error;
    }
  }
  async hydrate(ids: string[], city: City): Promise<Product[]> {
    if (!this.db.connect) throw new Error('Hydration requires a PostgreSQL pool');
    let client;
    try { client=await this.db.connect(); } catch { throw new ApiError(503,'DATABASE_UNAVAILABLE','Product availability is temporarily unavailable'); }
    let discard=false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const time=(await client.query<{time:string}>('SELECT statement_timestamp()::text AS time')).rows[0]!.time;
      const products:Product[]=[];
      for (let offset=0;offset<ids.length;offset+=500) {
        const {rows}=await client.query<ProductRow>(`${selectProduct('$3::timestamptz')} WHERE p.id=ANY($2::text[])`,[city,ids.slice(offset,offset+500),time]);
        products.push(...rows.map(row=>toProduct(row,city)));
      }
      await client.query('COMMIT');
      const byId=new Map(products.map(p=>[p.id,p]));
      return ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard=true; }
      const e=error as {code?:string};
      if (/^(08|53|57|58|E)/.test(e.code??'')) throw new ApiError(503,'DATABASE_UNAVAILABLE','Product availability is temporarily unavailable');
      throw error;
    } finally { client.release(discard); }
  }
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
    const { rows } = await this.query(`${selectProduct()}${where} ORDER BY p.id`, values);
    return rows.map(row => toProduct(row, filters.city));
  }

  async findById(id: string, city: City): Promise<Product | undefined> {
    const { rows } = await this.query(`${selectProduct()} WHERE p.id = $2`, [city, id]);
    return rows[0] ? toProduct(rows[0], city) : undefined;
  }
}
