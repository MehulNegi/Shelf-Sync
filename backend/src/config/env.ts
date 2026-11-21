import { readFileSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import type { PoolConfig } from 'pg';

export interface Config {
  database: PoolConfig;
  port: number;
  host: string;
  frontendOrigin: string;
  nodeEnv: string;
}

export class SetupError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadDotenv({ quiet: true });
  if (!env.DATABASE_URL) {
    throw new SetupError('DATABASE_URL is required. Copy backend/.env.example to backend/.env and configure your Aiven PostgreSQL service URL and project CA certificate. See backend/README.md.');
  }
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
    if (['USER', 'PASSWORD', 'HOST', 'PORT'].some(value => [url.username, url.password, url.hostname, url.port].includes(value))) throw new Error();
  } catch {
    throw new SetupError('DATABASE_URL must be a valid PostgreSQL service URL with a host and database; replace all .env.example placeholders.');
  }
  // pg connection-string SSL options can overwrite the explicit verified TLS config.
  for (const key of [...url.searchParams.keys()]) {
    if (key === 'sslmode' && ['require', 'verify-full'].includes(url.searchParams.get(key) ?? '')) {
      url.searchParams.delete(key);
    } else if (key.toLowerCase().startsWith('ssl') || key.toLowerCase() === 'uselibpqcompat') {
      throw new SetupError('Remove SSL URL parameters except sslmode=require or sslmode=verify-full. Configure the CA with DATABASE_CA_CERT_PATH; certificate and hostname verification are always enabled.');
    }
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new SetupError('Remove NODE_TLS_REJECT_UNAUTHORIZED=0. ShelfSync requires verified PostgreSQL TLS.');
  }
  let ca: string | undefined;
  if (env.DATABASE_CA_CERT_PATH) {
    try {
      ca = readFileSync(env.DATABASE_CA_CERT_PATH, 'utf8');
      if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error();
    } catch {
      throw new SetupError('DATABASE_CA_CERT_PATH must point to a readable PEM CA certificate downloaded from your Aiven project. See backend/README.md.');
    }
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SetupError('PORT must be an integer from 1 to 65535.');
  const poolMax = Number(env.DATABASE_POOL_MAX ?? 5);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 10) throw new SetupError('DATABASE_POOL_MAX must be an integer from 1 to 10. Budget connections across API, workers and rolling deploys.');
  const frontendOrigin = env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  try {
    const origin = new URL(frontendOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== frontendOrigin) throw new Error();
  } catch {
    throw new SetupError('FRONTEND_ORIGIN must be one exact HTTP(S) origin, for example http://localhost:5173 (no trailing slash).');
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new SetupError('NODE_ENV must be development, test, or production.');
  return {
    database: {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      max: poolMax,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      application_name: 'shelfsync-backend'
    },
    port,
    host: env.HOST ?? '0.0.0.0',
    frontendOrigin,
    nodeEnv
  };
}
