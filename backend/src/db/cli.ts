import type { Pool } from 'pg';
import { loadConfig, SetupError } from '../config/env.js';
import { createPool } from './pool.js';

export async function runDatabaseTask(label: string, task: (pool: Pool) => Promise<unknown>) {
  let pool: Pool | undefined;
  try {
    pool = createPool(loadConfig());
    await task(pool);
    console.log(`${label} completed.`);
  } catch (error) {
    console.error(error instanceof SetupError ? error.message : `${label} failed. Check Aiven credentials, project CA, network access, and migration state. See backend/README.md. Driver details are omitted to protect secrets.`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
