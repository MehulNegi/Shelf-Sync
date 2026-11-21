import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import type { OrderItemInput } from '../../src/types/order.js';

test('PostgreSQL checkout integration', { skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 with verified PostgreSQL configuration' : false }, async t => {
  const config = loadConfig();
  const admin = createPool(config);
  const schema = `shelfsync_checkout_${randomUUID().replaceAll('-', '')}`;
  const pool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${schema}` } });
  const app = buildApp({ products: new PgProductRepository(pool), orders: new PgOrderRepository(pool), frontendOrigin: 'http://localhost:5173' });
  let schemaCreated = false;
  t.after(async () => {
    try {
      await app.close();
      await pool.end();
      if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  await migrate(pool);
  let sequence = 0;
  async function product(stock: number, price = '19.99') {
    const id = `test_${String(sequence++).padStart(5, '0')}_${randomUUID()}`;
    await pool.query(`INSERT INTO products (id, name, description, category, price, image_url)
      VALUES ($1, 'Checkout fixture', 'Isolated test data', 'electronics', $2, '/images/test.jpg')`, [id, price]);
    await pool.query("INSERT INTO inventory (product_id, city, quantity, version) VALUES ($1, 'pune', $2, 7)", [id, stock]);
    return id;
  }
  const checkout = (items: OrderItemInput[], city = 'pune') => app.inject({ method: 'POST', url: '/api/orders', payload: { city, items } });
  const inventory = async (id: string) => (await pool.query("SELECT quantity, version::int FROM inventory WHERE product_id = $1 AND city = 'pune'", [id])).rows[0];
  const events = async (id: string) => (await pool.query("SELECT id, event_type, payload, published_at, created_at FROM outbox_events WHERE payload->>'productId' = $1", [id])).rows;
  const orderCount = async (id: string) => (await pool.query(`SELECT count(*)::int AS count FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE oi.product_id = $1 AND o.status = 'confirmed'`, [id])).rows[0].count;

  await t.test('single-item success persists the order and selected-city stock', async () => {
    const id = await product(5, '1999.00');
    const response = await checkout([{ productId: id, quantity: 2 }]);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { success: true, orderId: response.json().orderId, status: 'confirmed', total: 3998 });
    assert.match(response.json().orderId, /^ord_/);
    assert.deepEqual(await inventory(id), { quantity: 3, version: 8 });
    assert.equal(await orderCount(id), 1);
  });

  await t.test('insufficient stock rolls back without an order or event', async () => {
    const id = await product(1);
    const response = await checkout([{ productId: id, quantity: 2 }]);
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { success: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock available' } });
    assert.deepEqual(await inventory(id), { quantity: 1, version: 7 });
    assert.equal(await orderCount(id), 0);
    assert.equal((await events(id)).length, 0);
  });

  await t.test('empty carts and invalid quantities never create rows', async () => {
    const id = await product(3);
    for (const quantity of [0, -1, 1.5, '1', true]) {
      const response = await app.inject({ method: 'POST', url: '/api/orders', payload: { city: 'pune', items: [{ productId: id, quantity }] } });
      assert.equal(response.statusCode, 400);
    }
    assert.equal((await checkout([])).statusCode, 400);
    assert.deepEqual(await inventory(id), { quantity: 3, version: 7 });
    assert.equal(await orderCount(id), 0);
    assert.equal((await events(id)).length, 0);
  });

  await t.test('multiple products use exact database prices and inclusive INR decimals', async () => {
    const a = await product(5, '0.10');
    const b = await product(5, '0.20');
    const response = await checkout([{ productId: b, quantity: 1 }, { productId: a, quantity: 1 }]);
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().total, 0.3);
    assert.equal((await pool.query('SELECT total::text FROM orders WHERE id = $1', [response.json().orderId])).rows[0].total, '0.30');
    for (const id of [a, b]) {
      assert.deepEqual(await inventory(id), { quantity: 4, version: 8 });
      assert.equal((await events(id)).length, 1);
    }
    const tampered = await app.inject({ method: 'POST', url: '/api/orders', payload: { city: 'pune', total: 0, items: [{ productId: a, quantity: 1, unitPrice: 0 }] } });
    assert.equal(tampered.statusCode, 400);
    assert.deepEqual(await inventory(a), { quantity: 4, version: 8 });
  });

  await t.test('duplicate IDs become one item, one deduction, and one event', async () => {
    const id = await product(10, '159.50');
    const response = await checkout([{ productId: id, quantity: 1 }, { productId: id, quantity: 2 }]);
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().total, 478.5);
    assert.deepEqual(await inventory(id), { quantity: 7, version: 8 });
    assert.deepEqual((await pool.query('SELECT quantity, unit_price::text FROM order_items WHERE order_id = $1', [response.json().orderId])).rows, [{ quantity: 3, unit_price: '159.50' }]);
    assert.equal((await events(id)).length, 1);
  });

  await t.test('a later unavailable item rolls back earlier stock, version, and outbox writes', async () => {
    const a = await product(4);
    const b = await product(0);
    const before = (await pool.query('SELECT count(*)::int AS count FROM orders')).rows[0].count;
    const response = await checkout([{ productId: b, quantity: 1 }, { productId: a, quantity: 2 }]);
    assert.equal(response.statusCode, 409);
    assert.deepEqual(await inventory(a), { quantity: 4, version: 7 });
    assert.deepEqual(await inventory(b), { quantity: 0, version: 7 });
    assert.equal((await events(a)).length, 0);
    assert.equal((await events(b)).length, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM orders')).rows[0].count, before);
  });

  await t.test('missing products and unavailable city inventory return 409', async () => {
    const id = await product(3);
    assert.equal((await checkout([{ productId: 'missing', quantity: 1 }])).statusCode, 409);
    assert.equal((await checkout([{ productId: id, quantity: 1 }], 'delhi')).statusCode, 409);
    assert.deepEqual(await inventory(id), { quantity: 3, version: 7 });
    assert.equal((await events(id)).length, 0);
  });

  await t.test('GET order returns persisted quantities/prices and missing orders return 404', async () => {
    const id = await product(3, '159.50');
    const created = await checkout([{ productId: id, quantity: 2 }]);
    assert.equal(created.statusCode, 201);
    const orderId = created.json().orderId;
    await pool.query('UPDATE products SET price = 999 WHERE id = $1', [id]);
    const details = await app.inject(`/api/orders/${orderId}`);
    assert.equal(details.statusCode, 200);
    assert.deepEqual(details.json(), { id: orderId, city: 'pune', status: 'confirmed', total: 319,
      items: [{ productId: id, name: 'Checkout fixture', quantity: 2, unitPrice: 159.5 }] });
    const missing = await app.inject('/api/orders/ord_missing');
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'ORDER_NOT_FOUND');
  });

  await t.test('committed outbox event includes matching identity, quantity, version, and timestamp', async () => {
    const id = await product(1);
    assert.equal((await checkout([{ productId: id, quantity: 1 }])).statusCode, 201);
    const rows = await events(id);
    assert.equal(rows.length, 1);
    const event = rows[0]!;
    assert.equal(event.event_type, 'inventory.changed');
    assert.equal(event.published_at, null);
    assert.deepEqual(event.payload, { eventId: event.id, type: 'inventory.changed', schemaVersion: 1,
      productId: id, city: 'pune', quantity: 0, inventoryVersion: 8, occurredAt: event.created_at.toISOString() });
  });

  await t.test('late database failure rolls back order, items, inventory, and outbox', async () => {
    const id = await product(3);
    await pool.query(`CREATE FUNCTION reject_test_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected order item failure'; END $$`);
    // Only this isolated schema and trusted generated test product are affected.
    await pool.query(`CREATE TRIGGER reject_test_order_item BEFORE INSERT ON order_items
      FOR EACH ROW WHEN (NEW.product_id = '${id}') EXECUTE FUNCTION reject_test_order_item()`);
    try {
      const before = (await pool.query('SELECT count(*)::int AS count FROM orders')).rows[0].count;
      const historyBefore = (await pool.query('SELECT count(*)::int AS count FROM order_status_history')).rows[0].count;
      const response = await checkout([{ productId: id, quantity: 1 }]);
      assert.equal(response.statusCode, 500);
      assert.deepEqual(await inventory(id), { quantity: 3, version: 7 });
      assert.equal((await events(id)).length, 0);
      assert.equal(await orderCount(id), 0);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM orders')).rows[0].count, before);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM order_status_history')).rows[0].count, historyBefore);
    } finally { await pool.query('DROP TRIGGER reject_test_order_item ON order_items'); }
  });

  await t.test('two simultaneous last-unit purchases yield exactly one 201 and one 409 (10 isolated races)', async () => {
    for (let run = 0; run < 10; run++) {
      const id = await product(1);
      const responses = await Promise.all([
        checkout([{ productId: id, quantity: 1 }]),
        checkout([{ productId: id, quantity: 1 }])
      ]);
      assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409]);
      assert.equal(responses.find(response => response.statusCode === 409)!.json().error.code, 'INSUFFICIENT_STOCK');
      assert.deepEqual(await inventory(id), { quantity: 0, version: 8 });
      assert.equal(await orderCount(id), 1);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM order_status_history h
        JOIN order_items oi ON oi.order_id = h.order_id WHERE oi.product_id = $1 AND h.status = 'confirmed'`, [id])).rows[0].count, 1);
      assert.equal((await events(id)).length, 1);
      assert.equal((await events(id))[0]!.payload.quantity, 0);
    }
    t.diagnostic('10/10 real PostgreSQL races: one HTTP 201 + one HTTP 409; stock=0; confirmed orders=1; committed outbox events=1 per fixture');
  });

  await t.test('opposite multi-item cart order completes without deadlock', async () => {
    const a = await product(2);
    const b = await product(2);
    const results = await Promise.all([
      checkout([{ productId: a, quantity: 1 }, { productId: b, quantity: 1 }]),
      checkout([{ productId: b, quantity: 1 }, { productId: a, quantity: 1 }])
    ]);
    assert.deepEqual(results.map(result => result.statusCode), [201, 201]);
    for (const id of [a, b]) {
      assert.deepEqual(await inventory(id), { quantity: 0, version: 9 });
      assert.deepEqual((await events(id)).map(row => row.payload.inventoryVersion).sort(), [8, 9]);
    }
  });
});
