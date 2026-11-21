import pg from 'pg';
import type { Config } from '../config/env.js';

export function createPool(config: Config): pg.Pool {
  const pool = new pg.Pool(config.database);
  // Never serialize driver errors: they can contain connection details or SQL.
  pool.on('error', () => console.error('PostgreSQL pool connection failed. Check Aiven availability and verified TLS configuration.'));
  return pool;
}
