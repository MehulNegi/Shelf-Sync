import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { seed } from '../../src/db/seeds.js';
import { indexCatalog } from '../../src/services/catalog-indexer.js';
import type { ProductDocument } from '../../src/services/search-projection.js';

test('catalog indexing reads all city inventory and versions from real PostgreSQL (projection double)', {
  skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests' : false
}, async t => {
  const config = loadConfig();
  const schema = `shelfsync_index_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(config);
  const pool = createPool({ ...config, database: { ...config.database, options: `-c search_path=${schema}` } });
  let created = false;
  t.after(async () => { try { await pool.end(); if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } });
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  await migrate(pool); await seed(pool);
  const documents: ProductDocument[] = [];
  let mappings = 0;
  const projection = { async ensureIndex() { mappings++; }, async upsertProduct(doc: ProductDocument) { documents.push(doc); } };
  assert.equal(await indexCatalog(pool, projection), 36);
  const earphones = documents.filter(doc => doc.id === 'prod_001').sort((a, b) => a.city.localeCompare(b.city));
  assert.deepEqual(earphones.map(doc => [doc.city, doc.stock, doc.inventoryVersion]), [['bengaluru', 3, 1], ['delhi', 8, 1], ['pune', 1, 1]]);
  assert.ok(earphones.every(doc => doc.price === 1999 && doc.catalogReady));
  documents.length = 0;
  assert.equal(await indexCatalog(pool, projection), 36);
  assert.equal(mappings, 2);
});
