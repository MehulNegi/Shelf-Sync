import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../services/products.js';

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let client: PoolClient;
    try { client = await pool.connect(); }
    catch { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Cart data is temporarily unavailable'); }
    let discard = false;
    const started = Date.now();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
      const result = await work(client);
      if (Date.now() - started > 15000) throw new ApiError(503, 'RESERVATION_BUSY', 'Reservation could not be completed; retry the same request');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      const code = (error as { code?: string }).code ?? '';
      if (['40001', '40P01', '55P03', '57014'].includes(code)) {
        if (attempt < 2) continue;
        throw new ApiError(503, 'RESERVATION_BUSY', 'Reservation could not be completed; retry the same request');
      }
      if (/^(08|53|57|58|E)/.test(code)) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Cart data is temporarily unavailable');
      throw error;
    } finally { client.release(discard); }
  }
}
