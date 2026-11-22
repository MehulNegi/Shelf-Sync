import type { Pool } from 'pg';
import type { City } from '../types/product.js';
import type { OrderDetails } from '../types/order.js';
import { ApiError } from '../services/products.js';

export const demoOrderLimit = 20;
export interface DemoOrder {
  id: string;
  city: City;
  status: OrderDetails['status'];
  total: number;
  created_at: string;
}
export interface DemoOrderRepository { listLatest(): Promise<DemoOrder[]> }

export class PgDemoOrderRepository implements DemoOrderRepository {
  constructor(private readonly database: Pick<Pool, 'query'>) {}

  async listLatest(): Promise<DemoOrder[]> {
    try {
      const { rows } = await this.database.query<{
        id: string; city: City; status: DemoOrder['status']; total: string; created_at: Date;
      }>(`SELECT id, city, status, total, created_at FROM orders
        ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT $1`, [demoOrderLimit]);
      return rows.map(row => ({ id: row.id, city: row.city, status: row.status,
        total: Number(row.total), created_at: row.created_at.toISOString() }));
    } catch {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Demo orders are temporarily unavailable');
    }
  }
}
