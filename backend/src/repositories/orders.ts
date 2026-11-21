import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { OrderCreated, OrderDetails, OrderInput, OrderRepository } from '../types/order.js';
import { ApiError } from '../services/products.js';

function toPaise(rupees: string): bigint {
  const [whole, fraction = ''] = rupees.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function toRupees(paise: bigint): string {
  return `${paise / 100n}.${(paise % 100n).toString().padStart(2, '0')}`;
}
const insufficientStock = () => new ApiError(409, 'INSUFFICIENT_STOCK', 'Not enough stock available');

export class PgOrderRepository implements OrderRepository {
  constructor(private readonly pool: Pool) {}

  async checkout(input: OrderInput): Promise<OrderCreated> {
    const client = await this.pool.connect();
    let discardClient = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const lines: { productId: string; quantity: number; price: string }[] = [];
      let total = 0n;
      // Sorting here also protects direct repository callers from inconsistent lock order.
      for (const item of [...input.items].sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)) {
        const product = await client.query<{ price: string }>('SELECT price FROM products WHERE id = $1', [item.productId]);
        const price = product.rows[0]?.price;
        // Unknown products and missing city inventory cannot be fulfilled either.
        if (price === undefined) throw insufficientStock();
        const updated = await client.query<{ quantity: number; version: string; updated_at: Date }>(`UPDATE inventory
          SET quantity = quantity - $1, version = version + 1, updated_at = clock_timestamp()
          WHERE product_id = $2 AND city = $3 AND quantity >= $1
          RETURNING quantity, version, updated_at`, [item.quantity, item.productId, input.city]);
        const inventory = updated.rows[0];
        if (!inventory) throw insufficientStock();
        const inventoryVersion = Number(inventory.version);
        if (!Number.isSafeInteger(inventoryVersion)) throw new Error('Inventory event version exceeds JSON safe integer range');
        const eventId = randomUUID();
        const event = {
          eventId, type: 'inventory.changed', schemaVersion: 1, productId: item.productId,
          city: input.city, quantity: inventory.quantity, inventoryVersion,
          occurredAt: inventory.updated_at.toISOString()
        };
        await client.query(`INSERT INTO outbox_events (id, event_type, payload, created_at)
          VALUES ($1, $2, $3::jsonb, $4)`, [eventId, event.type, JSON.stringify(event), inventory.updated_at]);
        total += toPaise(price) * BigInt(item.quantity);
        if (total > 99999999999999n) throw new ApiError(400, 'VALIDATION_ERROR', 'Order total exceeds the supported INR amount');
        lines.push({ ...item, price });
      }
      const orderId = `ord_${randomUUID()}`;
      const totalInRupees = toRupees(total);
      await client.query("INSERT INTO orders (id, city, status, total) VALUES ($1, $2, 'confirmed', $3)", [orderId, input.city, totalInRupees]);
      for (const line of lines) {
        await client.query(`INSERT INTO order_items (order_id, product_id, quantity, unit_price)
          VALUES ($1, $2, $3, $4)`, [orderId, line.productId, line.quantity, line.price]);
      }
      await client.query('COMMIT');
      return { success: true, orderId, status: 'confirmed', total: Number(totalInRupees) };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discardClient = true; }
      throw error;
    } finally {
      client.release(discardClient);
    }
  }

  async findById(id: string): Promise<OrderDetails | undefined> {
    const { rows } = await this.pool.query<{
      id: string; city: OrderDetails['city']; status: OrderDetails['status']; total: string;
      product_id: string; name: string; quantity: number; unit_price: string;
    }>(`SELECT o.id, o.city, o.status, o.total, oi.product_id, p.name, oi.quantity, oi.unit_price
      FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
      WHERE o.id = $1 ORDER BY oi.product_id`, [id]);
    const order = rows[0];
    if (!order) return undefined;
    return {
      id: order.id, city: order.city, status: order.status, total: Number(order.total),
      items: rows.map(row => ({ productId: row.product_id, name: row.name, quantity: row.quantity, unitPrice: Number(row.unit_price) }))
    };
  }
}
