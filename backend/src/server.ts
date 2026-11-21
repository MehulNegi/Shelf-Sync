import { buildApp } from './app.js';
import { loadConfig, SetupError } from './config/env.js';
import { createPool } from './db/pool.js';
import { PgProductRepository } from './repositories/products.js';
import { PgOrderRepository } from './repositories/orders.js';
import { createOpenSearchClient, loadOpenSearchConfig } from './config/opensearch.js';
import { SearchProjection } from './services/search-projection.js';
import { SearchProductRepository } from './repositories/search-products.js';

async function start() {
  const config = loadConfig();
  const searchConfig = process.env.OPENSEARCH_URL ? loadOpenSearchConfig() : undefined;
  const searchClient = searchConfig ? createOpenSearchClient(searchConfig) : undefined;
  const pool = createPool(config);
  const postgres = new PgProductRepository(pool);
  const products = searchClient && searchConfig
    ? new SearchProductRepository(new SearchProjection(searchClient, searchConfig.index), postgres,
      () => console.warn('OpenSearch search failed; using PostgreSQL substring search.')) : postgres;
  if (!searchClient) console.warn('OPENSEARCH_URL is unset; product search uses PostgreSQL substring matching.');
  const orders = new PgOrderRepository(pool);
  const app = buildApp({ products, orders, tracking: orders, frontendOrigin: config.frontendOrigin, logger: true });
  app.addHook('onClose', async () => { try { await searchClient?.close(); } finally { await pool.end(); } });
  try {
    await pool.query('SELECT 1');
    await app.listen({ port: config.port, host: config.host });
  } catch {
    await app.close();
    throw new SetupError('Backend startup failed. Check Aiven DATABASE_URL, DATABASE_CA_CERT_PATH, network access, and HOST/PORT. Run npm run migrate before using product endpoints. See backend/README.md.');
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
  }
}

start().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Backend startup failed. Check backend/README.md for setup instructions.');
  process.exitCode = 1;
});
