import { loadProfitabilityConfig } from './config/profitability.js';
import { createProfitabilityApi } from './services/profitability.js';
import { loadReservationConfig } from './config/reservations.js';
import { PgCartRepository } from './repositories/cart.js';
import { buildApp } from './app.js';
import { loadConfig, SetupError } from './config/env.js';
import { createPool } from './db/pool.js';
import { PgProductRepository } from './repositories/products.js';
import { PgOrderRepository } from './repositories/orders.js';
import { createOpenSearchClient, loadOpenSearchConfig } from './config/opensearch.js';
import { SearchProjection } from './services/search-projection.js';
import { SearchProductRepository } from './repositories/search-products.js';
import { loadAdminConfig } from './config/admin.js';
import { createAdminApi } from './services/admin.js';
import { validateRenderEnvironment } from './config/deployment.js';
import { databaseReadiness } from './services/readiness.js';
import { installShutdown } from './services/shutdown.js';

async function start() {
  const config = loadConfig();
  validateRenderEnvironment('api');
  const reservationConfig = loadReservationConfig(config);
  const searchConfig = process.env.OPENSEARCH_URL ? loadOpenSearchConfig() : undefined;
  const searchClient = searchConfig ? createOpenSearchClient(searchConfig) : undefined;
  const pool = createPool(config);
  const postgres = new PgProductRepository(pool);
  const products = searchClient && searchConfig
    ? new SearchProductRepository(new SearchProjection(searchClient, searchConfig.index), postgres,
      () => console.warn('OpenSearch search failed; using PostgreSQL substring search.')) : postgres;
  if (!searchClient) console.warn('OPENSEARCH_URL is unset; product search uses PostgreSQL substring matching.');
  const orders = new PgOrderRepository(pool);
  const adminConfig = loadAdminConfig(config);
  const admin = createAdminApi(pool, adminConfig);
  const profitability=createProfitabilityApi(pool,adminConfig,loadProfitabilityConfig());
  if (adminConfig.mode === 'disabled') console.info(adminConfig.setupIssue ?? 'Admin API is disabled by default.');
  let draining = false;
  const probe = databaseReadiness(pool);
  const app = buildApp({ products, orders, tracking: orders, ...(admin ? { admin } : {}), ...(profitability?{profitability}:{}), cart: { config:reservationConfig, repository:new PgCartRepository(pool,reservationConfig) }, frontendOrigin: config.frontendOrigin, logger: true,
    readiness: async () => !draining && await probe() && !draining });
  app.addHook('onClose', async () => { try { await searchClient?.close(); } finally { await pool.end(); } });
  const shutdown = installShutdown(() => {
    draining = true;
    void app.close().catch(() => { process.exitCode = 1; }).finally(() => shutdown.dispose());
  }, { log: event => console.info(JSON.stringify({ event })) });
  try {
    await pool.query('SELECT 1 FROM cart_reservations LIMIT 0');
    if (draining) return;
    await app.listen({ port: config.port, host: config.host });
  } catch {
    try { await app.close(); } finally { shutdown.dispose(); }
    throw new SetupError('Backend startup failed. Check Aiven DATABASE_URL, DATABASE_CA_CERT_PATH, network access, and HOST/PORT. Run npm run migrate before using product endpoints. See backend/README.md.');
  }
}

start().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Backend startup failed. Check backend/README.md for setup instructions.');
  process.exitCode = 1;
});
