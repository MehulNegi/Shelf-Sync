import type { Pool, QueryConfig } from 'pg';

// A probe never cancels or reuses an application transaction. At most one probe
// stays outstanding if the pool is saturated; late clients are always released.
export function databaseReadiness(pool: Pick<Pool, 'connect'>, timeoutMs = 2000): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  return async () => {
    pending ??= (async () => {
      const client = await pool.connect();
      let healthy = false;
      try {
        // pg supports a per-query read timeout (not yet exposed by @types/pg).
        const query: QueryConfig & { query_timeout: number } = { text: 'SELECT 1 FROM cart_reservations LIMIT 0', query_timeout: timeoutMs };
        await client.query(query);
        healthy = true;
        return true;
      } finally { client.release(!healthy); }
    })().catch(() => false).finally(() => { pending = undefined; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  };
}
