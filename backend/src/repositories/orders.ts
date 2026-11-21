import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { OrderCreated, OrderDetails, OrderInput, OrderRepository, OrderTracking, OrderTrackingRepository } from '../types/order.js';
import { transaction } from '../db/transaction.js';
import { InventoryTransaction } from '../db/inventory.js';
import type { PoolClient } from 'pg';
import { ApiError } from '../services/products.js';

function toPaise(rupees: string): bigint {
  const [whole, fraction = ''] = rupees.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function toRupees(paise: bigint): string {
  return `${paise / 100n}.${(paise % 100n).toString().padStart(2, '0')}`;
}
const insufficientStock = () => new ApiError(409, 'INSUFFICIENT_STOCK', 'Not enough stock available');

export class PgOrderRepository implements OrderRepository, OrderTrackingRepository {
  constructor(private readonly pool: Pool) {}

  async checkout(input: OrderInput): Promise<OrderCreated> {
    return transaction(this.pool, async client => {
      const inventory = await InventoryTransaction.lock(client, input.items.map(item => ({ productId: item.productId, city: input.city })));
      await inventory.reconcile();
      const result = await placeOrder(client, input, inventory);
      await inventory.flush();
      return result;
    });
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

  async findTrackingById(id: string): Promise<OrderTracking | undefined> {
    // One statement gives the current status and history a consistent snapshot.
    const { rows } = await this.pool.query<{
      id: string; status: OrderTracking['status']; created_at: Date;
      history_status: OrderTracking['status'] | null; occurred_at: Date | null;
      recorded_at: Date | null; source: OrderTracking['history'][number]['source'] | null;
    }>(`SELECT o.id, o.status, o.created_at, h.status AS history_status,
      h.occurred_at, h.recorded_at, h.source FROM orders o
      LEFT JOIN order_status_history h ON h.order_id = o.id
      WHERE o.id = $1 ORDER BY h.recorded_at, h.id`, [id]);
    const order = rows[0];
    if (!order) return undefined;
    return {
      orderId: order.id, status: order.status, createdAt: order.created_at.toISOString(),
      history: rows.filter(row => row.history_status !== null).map(row => ({
        status: row.history_status!, occurredAt: row.occurred_at?.toISOString() ?? null,
        recordedAt: row.recorded_at!.toISOString(), source: row.source!
      }))
    };
  }
}

// The caller owns the transaction and every inventory lock. No network I/O here.
export async function placeOrder(client: PoolClient, input: OrderInput, inventory: InventoryTransaction, reserved = false): Promise<OrderCreated> {
  const prices = await client.query<{ id: string; price: string }>('SELECT id, price FROM products WHERE id=ANY($1::text[])', [input.items.map(i => i.productId)]);
  const lines: { productId: string; quantity: number; price: string }[] = [];
  let total = 0n;
  for (const item of [...input.items].sort((a,b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)) {
    const key = { productId: item.productId, city: input.city };
    const stock = await inventory.snapshot(key);
    const price = prices.rows.find(p => p.id === item.productId)?.price;
    if (!stock || price === undefined || (reserved ? stock.quantity : stock.available) < item.quantity) throw insufficientStock();
    const updated = await client.query('UPDATE inventory SET quantity=quantity-$1 WHERE product_id=$2 AND city=$3 AND quantity >= $1', [item.quantity, item.productId, input.city]);
    if (updated.rowCount !== 1) throw insufficientStock();
    inventory.mark(key, 'checkout.confirmed');
    total += toPaise(price) * BigInt(item.quantity);
    if (total > 99999999999999n) throw new ApiError(400, 'VALIDATION_ERROR', 'Order total exceeds the supported INR amount');
    lines.push({ ...item, price });
  }
  const orderId = `ord_${randomUUID()}`;
  const totalInRupees = toRupees(total);
  await client.query("INSERT INTO orders(id,city,status,total) VALUES ($1,$2,'confirmed',$3)", [orderId, input.city, totalInRupees]);
  for (const line of lines) await client.query('INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4)', [orderId,line.productId,line.quantity,line.price]);
  return { success: true, orderId, status: 'confirmed', total: Number(totalInRupees) };
}
