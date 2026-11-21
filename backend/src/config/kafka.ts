import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { config as loadDotenv } from 'dotenv';
import { logLevel, type KafkaConfig } from 'kafkajs';
import { SetupError } from './env.js';

export interface PublisherSettings {
  batchSize: number;
  pollIntervalMs: number;
  retryInitialMs: number;
  retryMaxMs: number;
}
export interface KafkaSettings {
  client: KafkaConfig;
  requestTimeoutMs: number;
  publisher: PublisherSettings;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, max: number) {
  const raw = env[key] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new SetupError(`${key} must be an integer from 1 to ${max}.`);
  return Number(raw);
}
function pem(path: string | undefined, label: string, marker: string) {
  if (!path) throw new SetupError(`${label} is required. Use the certificate files from Aiven Kafka Quick Connect; see backend/README.md.`);
  try {
    const contents = readFileSync(path, 'utf8');
    if (!contents.includes(marker)) throw new Error();
    return contents;
  } catch { throw new SetupError(`${label} must point to a readable PEM file. See backend/README.md.`); }
}

export function loadKafkaConfig(env: NodeJS.ProcessEnv = process.env): KafkaSettings {
  if (env === process.env) loadDotenv({ quiet: true });
  if (env.INVENTORY_V1_CUTOFF_AT && (!env.INVENTORY_V1_CUTOFF_AT.endsWith('Z') || !Number.isFinite(Date.parse(env.INVENTORY_V1_CUTOFF_AT)))) {
    throw new SetupError('INVENTORY_V1_CUTOFF_AT must be a fixed ISO 8601 UTC rollout timestamp shared by API, publisher and consumer.');
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new SetupError('Remove NODE_TLS_REJECT_UNAUTHORIZED=0. Kafka requires verified TLS.');
  const brokers = (env.KAFKA_BROKERS ?? '').split(',').map(value => value.trim());
  if (brokers.some(broker => {
    try {
      const url = new URL(`tcp://${broker}`);
      return !url.hostname || !/^.+:\d+$/.test(broker) || !url.port || Number(url.port) < 1 || Number(url.port) > 65535 ||
        Boolean(url.username || url.password || url.search || url.hash) || url.pathname !== '';
    } catch { return true; }
  })) throw new SetupError('KAFKA_BROKERS is required as comma-separated host:port entries from Aiven Kafka Quick Connect (no URL scheme or credentials).');
  const ssl: Exclude<KafkaConfig['ssl'], boolean | undefined> = { rejectUnauthorized: true };
  if (env.KAFKA_CA_CERT_PATH) ssl.ca = [pem(env.KAFKA_CA_CERT_PATH, 'KAFKA_CA_CERT_PATH', '-----BEGIN CERTIFICATE-----')];
  let sasl: KafkaConfig['sasl'];
  if (env.KAFKA_AUTH_MODE === 'sasl') {
    const mechanism = (env.KAFKA_SASL_MECHANISM ?? 'scram-sha-256').toLowerCase();
    if (!['plain', 'scram-sha-256', 'scram-sha-512'].includes(mechanism)) throw new SetupError('KAFKA_SASL_MECHANISM must be plain, scram-sha-256, or scram-sha-512, matching Quick Connect.');
    if (!env.KAFKA_USERNAME || !env.KAFKA_PASSWORD) throw new SetupError('KAFKA_USERNAME and KAFKA_PASSWORD are required for SASL; copy the existing Quick Connect credentials into backend/.env.');
    const credentials = { username: env.KAFKA_USERNAME, password: env.KAFKA_PASSWORD };
    sasl = mechanism === 'plain' ? { mechanism: 'plain', ...credentials }
      : mechanism === 'scram-sha-512' ? { mechanism: 'scram-sha-512', ...credentials }
      : { mechanism: 'scram-sha-256', ...credentials };
  } else if (env.KAFKA_AUTH_MODE === 'mtls') {
    if (!env.KAFKA_CA_CERT_PATH) throw new SetupError('KAFKA_CA_CERT_PATH is required for Aiven mTLS.');
    ssl.cert = pem(env.KAFKA_CLIENT_CERT_PATH, 'KAFKA_CLIENT_CERT_PATH', '-----BEGIN CERTIFICATE-----');
    ssl.key = pem(env.KAFKA_CLIENT_KEY_PATH, 'KAFKA_CLIENT_KEY_PATH', 'PRIVATE KEY-----');
  } else throw new SetupError('KAFKA_AUTH_MODE must be sasl or mtls, matching the existing Aiven Quick Connect settings.');
  try { createSecureContext(ssl); } catch { throw new SetupError('Kafka TLS files are invalid or the client certificate does not match its private key. Download the correct files from Aiven Quick Connect.'); }
  const requestTimeoutMs = integer(env, 'KAFKA_REQUEST_TIMEOUT_MS', 10000, 60000);
  const publisher = {
    batchSize: integer(env, 'OUTBOX_BATCH_SIZE', 25, 100),
    pollIntervalMs: integer(env, 'OUTBOX_POLL_INTERVAL_MS', 1000, 60000),
    retryInitialMs: integer(env, 'OUTBOX_RETRY_INITIAL_MS', 1000, 60000),
    retryMaxMs: integer(env, 'OUTBOX_RETRY_MAX_MS', 30000, 300000)
  };
  if (publisher.retryMaxMs < publisher.retryInitialMs) throw new SetupError('OUTBOX_RETRY_MAX_MS must be at least OUTBOX_RETRY_INITIAL_MS.');
  return {
    client: {
      clientId: env.KAFKA_CLIENT_ID || 'shelfsync-outbox', brokers, ssl, ...(sasl ? { sasl } : {}),
      connectionTimeout: requestTimeoutMs, authenticationTimeout: requestTimeoutMs,
      requestTimeout: requestTimeoutMs, enforceRequestTimeout: true,
      retry: { retries: 2, initialRetryTime: 300, maxRetryTime: 2000 },
      // Worker logs intentionally omit broker addresses, credentials, and raw client errors.
      logLevel: logLevel.NOTHING
    },
    requestTimeoutMs, publisher
  };
}
