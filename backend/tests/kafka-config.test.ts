import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKafkaConfig } from '../src/config/kafka.js';

const env = { KAFKA_BROKERS: 'broker.example.com:9093', KAFKA_AUTH_MODE: 'sasl', KAFKA_USERNAME: 'test', KAFKA_PASSWORD: 'test-only-password' };

test('Kafka config requires Quick Connect settings and never disables TLS', () => {
  assert.throws(() => loadKafkaConfig({}), /KAFKA_BROKERS/);
  for (const brokers of ['https://broker:9093', 'user:pass@broker:9093', 'broker', 'broker:0', 'broker:99999', 'broker:9093/']) {
    assert.throws(() => loadKafkaConfig({ ...env, KAFKA_BROKERS: brokers }), /KAFKA_BROKERS/);
  }
  const config = loadKafkaConfig({ ...env, KAFKA_BROKERS: 'broker.example.com:443,other.example.com:9093' });
  assert.deepEqual(config.client.ssl, { rejectUnauthorized: true });
  assert.deepEqual(config.client.brokers, ['broker.example.com:443', 'other.example.com:9093']);
  assert.deepEqual(config.client.sasl, { mechanism: 'scram-sha-256', username: 'test', password: 'test-only-password' });
  assert.equal(config.client.retry?.retries, 2);
  assert.throws(() => loadKafkaConfig({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /verified TLS/);
});

test('Kafka supports all documented SASL mechanisms and requires mTLS key material', () => {
  for (const mechanism of ['plain', 'SCRAM-SHA-256', 'scram-sha-512']) {
    assert.equal(loadKafkaConfig({ ...env, KAFKA_SASL_MECHANISM: mechanism }).client.sasl?.mechanism, mechanism.toLowerCase());
  }
  assert.throws(() => loadKafkaConfig({ ...env, KAFKA_PASSWORD: '' }), /KAFKA_USERNAME and KAFKA_PASSWORD/);
  assert.throws(() => loadKafkaConfig({ ...env, KAFKA_SASL_MECHANISM: 'unsupported' }), /KAFKA_SASL_MECHANISM/);
  assert.throws(() => loadKafkaConfig({ ...env, KAFKA_AUTH_MODE: 'plaintext' }), /KAFKA_AUTH_MODE/);
  assert.throws(() => loadKafkaConfig({ ...env, KAFKA_AUTH_MODE: 'mtls' }), /KAFKA_CA_CERT_PATH/);
  assert.throws(() => loadKafkaConfig({ ...env, KAFKA_CA_CERT_PATH: '/missing/kafka-ca.pem' }), /readable PEM/);
});

test('Kafka polling and retry settings are bounded and validated', () => {
  assert.equal(loadKafkaConfig(env).publisher.batchSize, 25);
  for (const [key, value] of [
    ['OUTBOX_BATCH_SIZE', '101'], ['OUTBOX_BATCH_SIZE', '0'], ['OUTBOX_POLL_INTERVAL_MS', '1.5'],
    ['OUTBOX_RETRY_INITIAL_MS', '-1'], ['OUTBOX_RETRY_MAX_MS', 'Infinity'], ['KAFKA_REQUEST_TIMEOUT_MS', '60001']
  ]) assert.throws(() => loadKafkaConfig({ ...env, [key!]: value }), /must be an integer/);
  assert.throws(() => loadKafkaConfig({ ...env, OUTBOX_RETRY_INITIAL_MS: '1000', OUTBOX_RETRY_MAX_MS: '500' }), /at least/);
});
