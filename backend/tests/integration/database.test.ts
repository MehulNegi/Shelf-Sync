import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { seed } from '../../src/db/seeds.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';

test('real PostgreSQL migrations, repeat-safe seed, API filtering, and constraints', { skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 and configure verified Aiven DATABASE_URL / CA for a test database' : false }, async t => {
  const config = loadConfig();
  const admin = createPool(config);
  // Generated identifier contains only trusted letters/hex/underscores.
  const schema = `shelfsync_test_${randomUUID().replaceAll('-', '')}`;
  let schemaCreated = false;
  let app: ReturnType<typeof buildApp> | undefined;
  const pool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${schema}` } });
  t.after(async () => {
    try {
      await app?.close();
      await pool.end();
      if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  assert.equal(await migrate(pool), 3);
  assert.equal(await migrate(pool), 0);
  await seed(pool);
  await seed(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM products')).rows[0].count, 12);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM inventory')).rows[0].count, 36);
  const api = buildApp({ products: new PgProductRepository(pool), orders: new PgOrderRepository(pool), frontendOrigin: 'http://localhost:5173' });
  app = api;
  for (const [city, stock] of [['pune', 1], ['delhi', 8], ['bengaluru', 3]] as const) {
    const response = await api.inject(`/api/products/prod_001?city=${city}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().stock, stock);
    assert.equal(response.json().price, 1999);
  }
  for (const [query, ids] of [
    ['q=bLuEtOoTh', ['prod_001', 'prod_003']],
    ['category=groceries&minPrice=159.50&maxPrice=189', ['prod_009', 'prod_011']],
    ["q=' OR true; --", []], ['q=%', []], ['q=_', []]
  ] as const) {
    const response = await api.inject(`/api/products?city=pune&${query}`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().products.map((product: { id: string }) => product.id), ids);
    assert.equal(response.json().total, ids.length);
  }
  const zeroStock = await api.inject('/api/products/prod_003?city=delhi');
  assert.equal(zeroStock.json().available, false);
  await pool.query("UPDATE inventory SET quantity = 0, version = 2 WHERE product_id = 'prod_001' AND city = 'pune'");
  await seed(pool);
  assert.deepEqual((await pool.query("SELECT quantity, version::int FROM inventory WHERE product_id = 'prod_001' AND city = 'pune'")).rows[0], { quantity: 0, version: 2 });
  await assert.rejects(pool.query("UPDATE inventory SET quantity = -1 WHERE product_id = 'prod_001' AND city = 'pune'"), { code: '23514' });
  await assert.rejects(pool.query("UPDATE products SET price = 0 WHERE id = 'prod_001'"), { code: '23514' });
  await assert.rejects(pool.query("INSERT INTO inventory (product_id, city, quantity) VALUES ('missing', 'pune', 1)"), { code: '23503' });
  await pool.query("DELETE FROM inventory WHERE product_id = 'prod_002' AND city = 'pune'");
  const missingInventory = await api.inject('/api/products/prod_002?city=pune');
  assert.equal(missingInventory.json().stock, 0);
  assert.equal(missingInventory.json().available, false);
});
