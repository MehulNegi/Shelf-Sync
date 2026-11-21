import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { validateRenderEnvironment } from '../src/config/deployment.js';
import { loadConfig } from '../src/config/env.js';
import { buildApp } from '../src/app.js';
import { databaseReadiness } from '../src/services/readiness.js';
import { installShutdown } from '../src/services/shutdown.js';

const origin = 'https://shelf-sync-tau.vercel.app';
const render = { RENDER: 'true', NODE_ENV: 'production', HOST: '0.0.0.0', FRONTEND_ORIGIN: origin };
const database = 'postgresql://test:unused@db.example.test/defaultdb';

test('Render uses PORT while local startup defaults remain unchanged; pool sizes are bounded', () => {
  const local = loadConfig({ DATABASE_URL: database });
  assert.equal(local.port, 3000); assert.equal(local.host, '0.0.0.0');
  assert.equal(local.frontendOrigin, 'http://localhost:5173'); assert.equal(local.database.max, 5);
  const production = loadConfig({ ...render, DATABASE_URL: database, PORT: '10000', DATABASE_POOL_MAX: '3' });
  assert.equal(production.port, 10000); assert.equal(production.host, '0.0.0.0'); assert.equal(production.database.max, 3);
  for (const value of ['0', '11', 'NaN', '1.5']) assert.throws(() => loadConfig({ DATABASE_URL: database, DATABASE_POOL_MAX: value }), /DATABASE_POOL_MAX/);
});

test('Render storefront profile refuses local-demo, JWT enablement and profitability activation', () => {
  validateRenderEnvironment('api', render);
  for (const service of ['api', 'worker'] as const) {
    for (const value of ['development', 'test', '']) assert.throws(() => validateRenderEnvironment(service, { ...render, NODE_ENV: value }), /NODE_ENV/);
    for (const mode of ['local-demo', 'jwt', 'unknown']) assert.throws(() => validateRenderEnvironment(service, { ...render, ADMIN_AUTH_MODE: mode }), /ADMIN_AUTH_MODE=disabled/);
    for (const key of ['PROFITABILITY_ENABLED', 'PROFITABILITY_DEMO_WRITES_ENABLED', 'RESERVATION_ALLOW_LOCAL_HTTP']) {
      assert.throws(() => validateRenderEnvironment(service, { ...render, [key]: 'true' }), new RegExp(key));
      validateRenderEnvironment(service, { ...render, [key]: 'false' });
    }
    assert.throws(() => validateRenderEnvironment(service, { ...render, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /verified TLS/);
  }
  // Local development still uses the existing scoped demo/JWT configuration.
  validateRenderEnvironment('api', { NODE_ENV: 'development', ADMIN_AUTH_MODE: 'local-demo' });
});

test('Render requires exact HTTPS CORS origin and a public interface', () => {
  for (const value of ['', '*', 'http://localhost:5173', origin + '/', origin + '/path', 'https://user:password@example.test']) {
    assert.throws(() => validateRenderEnvironment('api', { ...render, FRONTEND_ORIGIN: value }), /FRONTEND_ORIGIN/);
  }
  assert.throws(() => validateRenderEnvironment('api', { ...render, HOST: '127.0.0.1' }), /0.0.0.0/);
});

test('Render reservations fail closed until same-origin routing and trusted TLS peers are configured', () => {
  const enabled = { ...render, RESERVATIONS_ENABLED: 'true' };
  assert.throws(() => validateRenderEnvironment('api', enabled), /same-origin/);
  assert.throws(() => validateRenderEnvironment('api', { ...enabled, RESERVATION_BROWSER_API_ORIGIN: 'https://shelfsync.onrender.com' }), /cross-site/);
  assert.throws(() => validateRenderEnvironment('api', { ...enabled, RESERVATION_BROWSER_API_ORIGIN: origin }), /RESERVATION_HTTPS_PROXY_IPS/);
  validateRenderEnvironment('api', { ...enabled, RESERVATION_BROWSER_API_ORIGIN: origin, RESERVATION_HTTPS_PROXY_IPS: '192.0.2.1' });
});

test('Vercel CORS allows credentials only on cookie routes; foreign origins receive no CORS grant', async t => {
  const app = buildApp({ products: { async list() { return []; }, async findById() { return undefined; } },
    orders: { async checkout() { assert.fail('not a checkout test'); }, async findById() { return undefined; } }, frontendOrigin: origin });
  t.after(() => app.close());
  for (const url of ['/api/products?city=pune', '/api/health', '/api/admin/orders']) {
    const allowed = await app.inject({ url, headers: { origin } });
    assert.equal(allowed.headers['access-control-allow-origin'], origin);
    assert.notEqual(allowed.headers['access-control-allow-credentials'], 'true');
    for (const foreign of ['null', 'https://untrusted.example', 'https://shelf-sync-tau.vercel.app.evil.example']) {
      const denied = await app.inject({ url, headers: { origin: foreign } });
      assert.equal(denied.headers['access-control-allow-origin'], undefined);
      assert.equal(denied.headers['access-control-allow-credentials'], undefined);
    }
  }
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/products', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  assert.equal(preflight.statusCode, 204); assert.equal(preflight.headers['access-control-allow-origin'], origin);
  for (const url of ['/api/admin/overview', '/api/admin/inventory', '/api/admin/orders', '/api/admin/events', '/api/admin/profitability/overview', '/api/admin/products/prod_001/costs']) {
    const denied = await app.inject({ url, headers: { authorization: 'Bearer untrusted', origin } });
    assert.equal(denied.statusCode, 503); assert.equal(denied.json().error.code, 'ADMIN_DISABLED');
  }
});

test('readiness is no-store, sanitized and separate from the exact liveness response', async t => {
  let ready = true;
  const app = buildApp({ products: { async list() { return []; }, async findById() { return undefined; } },
    orders: { async checkout() { assert.fail(); }, async findById() { return undefined; } }, frontendOrigin: origin,
    readiness: async () => { if (!ready) throw new Error('postgresql://hidden-credential@private'); return true; } });
  t.after(() => app.close());
  const healthy = await app.inject('/api/ready');
  assert.deepEqual(healthy.json(), { status: 'ready' }); assert.equal(healthy.headers['cache-control'], 'no-store');
  ready = false;
  const unhealthy = await app.inject('/api/ready');
  assert.equal(unhealthy.statusCode, 503); assert.equal(unhealthy.json().error.code, 'SERVICE_UNAVAILABLE'); assert.ok(!unhealthy.body.includes('hidden-credential'));
  assert.deepEqual((await app.inject('/api/health')).json(), { status: 'ok' });
});

test('readiness probes coalesce while saturated and release a late client after their deadline', async () => {
  let connectCount = 0, releaseCount = 0;
  let complete!: (client: unknown) => void;
  const connection = new Promise(resolve => { complete = resolve; });
  const pool = { async connect() { connectCount++; return connection; } } as unknown as Pool;
  const ready = databaseReadiness(pool, 10);
  assert.deepEqual(await Promise.all([ready(), ready(), ready()]), [false, false, false]);
  assert.equal(await ready(), false); assert.equal(connectCount, 1);
  complete({ async query() { return { rows: [] }; }, release(destroy: boolean) { assert.equal(destroy, false); releaseCount++; } });
  await delay(0); assert.equal(releaseCount, 1);
});

test('readiness query failures destroy the failed connection and are retryable', async () => {
  let failed = true, releases = 0;
  const pool = { async connect() { return { async query() { if (failed) throw new Error('private driver detail'); }, release(destroy: boolean) { assert.equal(destroy, failed); releases++; } }; } } as unknown as Pool;
  const ready = databaseReadiness(pool, 10);
  assert.equal(await ready(), false); failed = false; assert.equal(await ready(), true); assert.equal(releases, 2);
});

test('shutdown is idempotent across signals and waits for owner cleanup before clearing its deadline', async () => {
  const signals = new EventEmitter(), events: string[] = [];
  let stopped = 0, terminated = 0;
  const shutdown = installShutdown(() => { stopped++; }, { signals, timeoutMs: 10, terminate: code => { assert.equal(code, 1); terminated++; }, log: event => events.push(event) });
  signals.emit('SIGTERM'); signals.emit('SIGINT'); signals.emit('SIGTERM');
  await delay(25);
  assert.equal(stopped, 1); assert.equal(terminated, 1); assert.deepEqual(events, ['shutdown_started', 'shutdown_timed_out']);
  shutdown.dispose(); assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('completed graceful shutdown clears deadline and signal listeners', async () => {
  const signals = new EventEmitter();
  let terminated = false;
  const shutdown = installShutdown(() => {}, { signals, timeoutMs: 5, terminate: () => { terminated = true; } });
  signals.emit('SIGINT'); shutdown.dispose(); await delay(15);
  assert.equal(terminated, false); assert.equal(signals.listenerCount('SIGINT'), 0); assert.equal(signals.listenerCount('SIGTERM'), 0);
});
