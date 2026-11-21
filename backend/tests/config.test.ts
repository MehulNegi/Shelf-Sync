import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config/env.js';

const url = 'postgresql://test-user:secret@db.example.com:5432/defaultdb';

test('missing and invalid database settings fail with actionable, sanitized instructions', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL is required/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'secret-invalid-url' }), error => error instanceof Error && !error.message.includes('secret-invalid-url'));
  assert.throws(() => loadConfig({ DATABASE_URL: url, DATABASE_CA_CERT_PATH: '/missing/project/ca.pem' }), /readable PEM CA certificate/);
});

test('TLS always verifies certificates and connection URL cannot override it', () => {
  for (const suffix of ['', '?sslmode=require', '?sslmode=verify-full']) {
    const config = loadConfig({ DATABASE_URL: url + suffix });
    assert.deepEqual(config.database.ssl, { rejectUnauthorized: true });
    assert.ok(!config.database.connectionString?.includes('sslmode'));
    assert.equal(config.database.max, 5);
  }
  for (const suffix of ['?sslmode=disable', '?sslmode=no-verify', '?sslmode=verify-ca', '?ssl=false', '?sslrootcert=ca.pem', '?uselibpqcompat=true']) {
    assert.throws(() => loadConfig({ DATABASE_URL: url + suffix }), /Remove SSL URL parameters/);
  }
  assert.throws(() => loadConfig({ DATABASE_URL: url, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /requires verified/);
});

test('server settings are validated', () => {
  for (const port of ['0', '65536', 'NaN', '1.5']) assert.throws(() => loadConfig({ DATABASE_URL: url, PORT: port }), /PORT/);
  for (const origin of ['*', 'http://localhost:5173/', 'https://user:pass@example.com']) assert.throws(() => loadConfig({ DATABASE_URL: url, FRONTEND_ORIGIN: origin }), /FRONTEND_ORIGIN/);
  assert.throws(() => loadConfig({ DATABASE_URL: url, NODE_ENV: 'invalid' }), /NODE_ENV/);
});
