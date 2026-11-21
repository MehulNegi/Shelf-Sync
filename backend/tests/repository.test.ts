import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { PgProductRepository } from '../src/repositories/products.js';

test('all filter values are parameterized, including hostile input and LIKE characters', async () => {
  const calls: { text: string; values: unknown[] }[] = [];
  const query = async (text: string, values: unknown[]) => {
    calls.push({ text, values });
    return { rows: [] };
  };
  const repository = new PgProductRepository({ query } as unknown as Pick<Pool, 'query'>);
  const q = "x' OR true; --%_\\";
  await repository.list({ city: 'pune', q, category: 'electronics', minPrice: 0, maxPrice: 1999 });
  const call = calls[0]!;
  assert.ok(!call.text.includes(q));
  assert.match(call.text, /ILIKE \$2/);
  assert.match(call.text, /p.category = \$3/);
  assert.match(call.text, /p.price >= \$4/);
  assert.match(call.text, /p.price <= \$5/);
  assert.deepEqual(call.values, ['pune', "%x' OR true; --\\%\\_\\\\%", 'electronics', 0, 1999]);
  await repository.findById("prod_001' OR true", 'delhi');
  assert.deepEqual(calls[1]!.values, ['delhi', "prod_001' OR true"]);
  assert.match(calls[1]!.text, /WHERE p.id = \$2/);
});

test('numeric PostgreSQL prices become INR numbers and zero stock is unavailable', async () => {
  const query = async () => ({ rows: [{ id: 'prod_009', name: 'Rice', description: 'Rice', category: 'groceries', price: '159.50', image_url: '/images/rice.jpg', stock: 0 }] });
  const repository = new PgProductRepository({ query } as unknown as Pick<Pool, 'query'>);
  const result = await repository.findById('prod_009', 'bengaluru');
  assert.equal(result?.price, 159.5);
  assert.equal(result?.available, false);
  assert.equal(result?.stock, 0);
  assert.equal(result?.city, 'bengaluru');
});
