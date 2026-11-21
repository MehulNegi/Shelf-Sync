import { loadConfig, SetupError } from '../src/config/env.js';
import { createOpenSearchClient, loadOpenSearchConfig } from '../src/config/opensearch.js';
import { createPool } from '../src/db/pool.js';
import { indexCatalog } from '../src/services/catalog-indexer.js';
import { SearchProjection } from '../src/services/search-projection.js';

async function main() {
  const database = loadConfig();
  const search = loadOpenSearchConfig();
  const client = createOpenSearchClient(search);
  const pool = createPool(database);
  try {
    const count = await indexCatalog(pool, new SearchProjection(client, search.index));
    await client.indices.refresh({ index: search.index });
    console.log(JSON.stringify({ event: 'catalog_indexed', documents: count }));
  } finally { try { await client.close(); } finally { await pool.end(); } }
}
main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Product indexing failed. Check PostgreSQL/OpenSearch availability, credentials, CA, index mappings, and migrations. Raw errors are omitted to protect secrets.');
  process.exitCode = 1;
});
