import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { config as loadDotenv } from 'dotenv';
import { Client, type ClientOptions } from '@opensearch-project/opensearch';
import { SetupError } from './env.js';

export interface OpenSearchConfig { client: ClientOptions; index: string }
export function loadOpenSearchConfig(env: NodeJS.ProcessEnv = process.env): OpenSearchConfig {
  if (env === process.env) loadDotenv({ quiet: true });
  if (!env.OPENSEARCH_URL) throw new SetupError('OPENSEARCH_URL is required. Configure the Aiven HTTPS endpoint and credentials in backend/.env; see backend/README.md.');
  let url: URL;
  try {
    url = new URL(env.OPENSEARCH_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
  } catch { throw new SetupError('OPENSEARCH_URL must be an HTTPS service origin without embedded credentials, query parameters, or a path.'); }
  if (!env.OPENSEARCH_USERNAME || !env.OPENSEARCH_PASSWORD) throw new SetupError('OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD are required for Aiven OpenSearch.');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new SetupError('Remove NODE_TLS_REJECT_UNAUTHORIZED=0. OpenSearch requires verified TLS.');
  const ssl: NonNullable<ClientOptions['ssl']> = { rejectUnauthorized: true };
  if (env.OPENSEARCH_CA_CERT_PATH) {
    try {
      const ca = readFileSync(env.OPENSEARCH_CA_CERT_PATH, 'utf8');
      if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error();
      ssl.ca = ca;
      createSecureContext(ssl);
    } catch { throw new SetupError('OPENSEARCH_CA_CERT_PATH must point to a readable, valid PEM CA certificate.'); }
  }
  const index = env.OPENSEARCH_INDEX ?? 'shelfsync-products-v1';
  if (!/^[a-z][a-z0-9_-]{0,199}$/.test(index)) throw new SetupError('OPENSEARCH_INDEX must start with a lowercase letter and contain only lowercase letters, digits, underscores, or hyphens (maximum 200 characters).');
  return { index, client: {
    node: url.origin, auth: { username: env.OPENSEARCH_USERNAME, password: env.OPENSEARCH_PASSWORD },
    ssl, requestTimeout: 5000, maxRetries: 2
  } };
}
export function createOpenSearchClient(config: OpenSearchConfig) { return new Client(config.client); }
