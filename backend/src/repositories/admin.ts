import type { Pool, PoolClient } from 'pg';
import { cities } from '../types/product.js';
import type { AdminEvent, AdminFilters, AdminInventory, AdminOrder, AdminOverview, AdminRepository, AdminRows } from '../types/admin.js';
import { ApiError } from '../services/products.js';

function safeCount(value: string | number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new ApiError(500, 'INTERNAL_ERROR', 'An internal server error occurred');
  return number;
}
function databaseError(error: unknown) {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string } | undefined)?.code;
  const unavailable = !code || /^(08|53|57|58|E)/.test(code);
  return unavailable ? new ApiError(503, 'DATABASE_UNAVAILABLE', 'Operational data is temporarily unavailable')
    : new ApiError(500, 'INTERNAL_ERROR', 'An internal server error occurred');
}
class Conditions {
  values: unknown[] = [];
  clauses: string[] = [];
  value(value: unknown) { this.values.push(value); return `$${this.values.length}`; }
  equal(column: string, value: unknown) { if (value !== undefined) this.clauses.push(`${column} = ${this.value(value)}`); }
  dates(filters: AdminFilters) {
    if (filters.createdFrom !== undefined) this.clauses.push(`created_at >= ${this.value(filters.createdFrom)}::timestamptz`);
    if (filters.createdTo !== undefined) this.clauses.push(`created_at < ${this.value(filters.createdTo)}::timestamptz`);
  }
  sql() { return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : ''; }
}
const fullTimestamp = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export class PgAdminRepository implements AdminRepository {
  constructor(private readonly pool: Pool) {}

  private async snapshot<T>(read: (client: PoolClient, asOf: string) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); }
    catch { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Operational data is temporarily unavailable'); }
    let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows } = await client.query<{ as_of: Date }>('SELECT transaction_timestamp() AS as_of');
      const result = await read(client, rows[0]!.as_of.toISOString());
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw databaseError(error);
    } finally { client.release(discard); }
  }

  overview(): Promise<AdminOverview> {
    return this.snapshot(async (client, asOf) => {
      const stocks = await client.query<{ city: string; stock: string; low: string; out: string }>(`SELECT city,
        COALESCE(sum(quantity), 0)::text AS stock,
        count(*) FILTER (WHERE quantity BETWEEN 1 AND 5)::text AS low,
        count(*) FILTER (WHERE quantity = 0)::text AS out FROM inventory GROUP BY city`);
      const inventoryByCity = cities.map(city => {
        const row = stocks.rows.find(row => row.city === city);
        return { city, stockUnits: safeCount(row?.stock ?? 0), lowStockRecords: safeCount(row?.low ?? 0), outOfStockRecords: safeCount(row?.out ?? 0) };
      });
      const { rows } = await client.query<{ date: string; starts_at: Date; ends_at: Date; count: string; backlog: string }>(`WITH day AS (
        SELECT (transaction_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS date
      ), bounds AS (
        SELECT date, date::timestamp AT TIME ZONE 'Asia/Kolkata' AS starts_at,
          (date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS ends_at FROM day
      ) SELECT date::text, starts_at, ends_at,
        (SELECT count(*)::text FROM orders WHERE created_at >= starts_at AND created_at < ends_at) AS count,
        (SELECT count(*)::text FROM outbox_events WHERE published_at IS NULL) AS backlog FROM bounds`);
      const day = rows[0]!;
      return { asOf, lowStockThreshold: 5,
        totalStockUnits: safeCount(inventoryByCity.reduce((sum, city) => sum + city.stockUnits, 0)),
        lowStockRecords: safeCount(inventoryByCity.reduce((sum, city) => sum + city.lowStockRecords, 0)),
        outOfStockRecords: safeCount(inventoryByCity.reduce((sum, city) => sum + city.outOfStockRecords, 0)),
        ordersToday: { count: safeCount(day.count), date: day.date, timeZone: 'Asia/Kolkata', startsAt: day.starts_at.toISOString(), endsAt: day.ends_at.toISOString() },
        inventoryByCity, outboxBacklog: safeCount(day.backlog) };
    });
  }

  inventory(filters: AdminFilters, limit: number, after?: string[]): Promise<AdminRows<AdminInventory>> {
    return this.snapshot(async (client, asOf) => {
      const c = new Conditions();
      c.equal('i.city', filters.city); c.equal('p.category', filters.category);
      if (filters.stockStatus) c.clauses.push(filters.stockStatus === 'low_stock' ? 'i.quantity BETWEEN 1 AND 5' : filters.stockStatus === 'out_of_stock' ? 'i.quantity = 0' : 'i.quantity >= 6');
      if (after) c.clauses.push(`(i.city COLLATE "C", i.product_id COLLATE "C") > (${c.value(after[0])}::text COLLATE "C", ${c.value(after[1])}::text COLLATE "C")`);
      const result = await client.query<{ product_id: string; name: string; category: string; city: AdminInventory['city']; quantity: number; price: string }>(`SELECT i.product_id, p.name, p.category, i.city, i.quantity, p.price
        FROM inventory i JOIN products p ON p.id = i.product_id ${c.sql()}
        ORDER BY i.city COLLATE "C", i.product_id COLLATE "C" LIMIT ${c.value(limit + 1)}`, c.values);
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return { asOf, items: rows.map(row => ({ productId: row.product_id, name: row.name, category: row.category, city: row.city,
        stock: row.quantity, price: Number(row.price), stockStatus: row.quantity === 0 ? 'out_of_stock' : row.quantity <= 5 ? 'low_stock' : 'in_stock' })),
        next: result.rows.length > limit && last ? [last.city, last.product_id] : null };
    });
  }

  orders(filters: AdminFilters, limit: number, after?: string[]): Promise<AdminRows<AdminOrder>> {
    return this.snapshot(async (client, asOf) => {
      const c = new Conditions();
      c.equal('city', filters.city); c.equal('status', filters.status); c.dates(filters);
      if (after) c.clauses.push(`(created_at, id COLLATE "C") < (${c.value(after[0])}::timestamptz, ${c.value(after[1])}::text COLLATE "C")`);
      const result = await client.query<{ id: string; created_at: Date; cursor_time: string; city: AdminOrder['city']; total: string; status: AdminOrder['status'] }>(`SELECT id, created_at, ${fullTimestamp} AS cursor_time, city, total, status FROM orders ${c.sql()}
        ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT ${c.value(limit + 1)}`, c.values);
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return { asOf, items: rows.map(row => ({ orderId: row.id, createdAt: row.created_at.toISOString(), city: row.city, total: Number(row.total), status: row.status })),
        next: result.rows.length > limit && last ? [last.cursor_time, last.id] : null };
    });
  }

  events(filters: AdminFilters, limit: number, after?: string[]): Promise<AdminRows<AdminEvent>> {
    return this.snapshot(async (client, asOf) => {
      const c = new Conditions();
      // Extract associations only from explicit stored strings, never correlations.
      const field = (key: 'orderId' | 'productId') => `CASE WHEN jsonb_typeof(payload->'${key}') = 'string' AND length(btrim(payload->>'${key}')) > 0 THEN payload->>'${key}' ELSE NULL END`;
      const city = `CASE WHEN jsonb_typeof(payload->'city') = 'string' AND payload->>'city' IN ('pune', 'delhi', 'bengaluru') THEN payload->>'city' ELSE NULL END`;
      c.equal('event_type', filters.eventType); c.equal(field('productId'), filters.productId); c.equal(city, filters.city); c.dates(filters);
      if (filters.publicationState) c.clauses.push(filters.publicationState === 'pending' ? 'published_at IS NULL' : 'published_at IS NOT NULL');
      if (after) c.clauses.push(`(created_at, id) < (${c.value(after[0])}::timestamptz, ${c.value(after[1])}::uuid)`);
      const result = await client.query<{ id: string; event_type: string; order_id: string | null; product_id: string | null; city: AdminEvent['city']; created_at: Date; cursor_time: string; published_at: Date | null }>(`SELECT id, event_type,
        ${field('orderId')} AS order_id, ${field('productId')} AS product_id, ${city} AS city,
        created_at, ${fullTimestamp} AS cursor_time, published_at FROM outbox_events ${c.sql()}
        ORDER BY created_at DESC, id DESC LIMIT ${c.value(limit + 1)}`, c.values);
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return { asOf, items: rows.map(row => ({ eventId: row.id, eventType: row.event_type, orderId: row.order_id,
        productId: row.product_id, city: row.city, createdAt: row.created_at.toISOString(),
        publicationState: row.published_at ? 'published' : 'pending', publishedAt: row.published_at?.toISOString() ?? null })),
        next: result.rows.length > limit && last ? [last.cursor_time, last.id] : null };
    });
  }
}
