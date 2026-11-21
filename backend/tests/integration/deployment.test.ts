import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { validateRenderEnvironment } from '../../src/config/deployment.js';
import { loadReservationConfig } from '../../src/config/reservations.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { PgCartRepository } from '../../src/repositories/cart.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { databaseReadiness } from '../../src/services/readiness.js';

test('production-style trusted TLS proxy and secure cookie flow with isolated PostgreSQL', {
  skip: process.env.RUN_DB_TESTS !== '1' ? 'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests' : false, timeout: 90000
}, async t => {
  const runtime = loadConfig(), schema = `shelfsync_deploy_${randomUUID().replaceAll('-', '')}`;
  const database = createPool({ ...runtime, database: { ...runtime.database, max: 1 } });
  const pool = createPool({ ...runtime, database: { ...runtime.database, max: 2, options: `-c search_path=${schema}` } });
  const origin = 'https://shelf-sync-tau.vercel.app', proxy = '192.0.2.10';
  const environment = { RENDER: 'true', NODE_ENV: 'production', HOST: '0.0.0.0', FRONTEND_ORIGIN: origin,
    RESERVATIONS_ENABLED: 'true', RESERVATION_BROWSER_API_ORIGIN: origin, RESERVATION_HTTPS_PROXY_IPS: proxy,
    RESERVATION_RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'), INVENTORY_V1_CUTOFF_AT: '2020-01-01T00:00:00Z' };
  validateRenderEnvironment('api', environment);
  const cart = loadReservationConfig({ host: environment.HOST, nodeEnv: environment.NODE_ENV, frontendOrigin: origin }, environment);
  const orders = new PgOrderRepository(pool), repository = new PgCartRepository(pool, cart), probe = databaseReadiness(pool);
  let draining = false, created = false;
  const app = buildApp({ frontendOrigin: origin, products: new PgProductRepository(pool), orders, tracking: orders,
    cart: { config: cart, repository }, readiness: async () => !draining && await probe() && !draining });
  t.after(async () => { try { await app.close(); await pool.end(); if (created) await database.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await database.end(); } });
  await database.query(`CREATE SCHEMA "${schema}"`); created = true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
  assert.equal((await app.inject('/api/ready')).statusCode, 503);
  await migrate(pool); // Private schema only. Never uses the shared schema.
  const nonce = randomBytes(32);
  const otherReplica = new PgCartRepository(pool, cart);
  assert.deepEqual((await Promise.all([
    repository.consumeGatewayNonce(nonce), otherReplica.consumeGatewayNonce(nonce),
  ])).sort(), [false, true]);
  assert.equal((await app.inject('/api/ready')).statusCode, 200);
  const productId = 'render_fixture';
  await pool.query("INSERT INTO products(id,name,description,category,price,image_url) VALUES ($1,'Deployment fixture','Isolated','electronics',1999,'/test.jpg')", [productId]);
  await pool.query("INSERT INTO inventory(product_id,city,quantity) VALUES ($1,'pune',1)", [productId]);
  const headers = { origin, host: 'shelfsync.onrender.com', 'content-type': 'application/json', 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.0.2.50' };
  for (const request of [
    { remoteAddress: '192.0.2.11', headers },
    { remoteAddress: proxy, headers: { ...headers, origin: 'https://foreign.example' } },
    { remoteAddress: proxy, headers: { ...headers, origin: 'null' } },
    { remoteAddress: proxy, headers: { ...headers, 'x-forwarded-proto': 'http' } }
  ]) {
    const denied = await app.inject({ method: 'POST', url: '/api/cart/session', payload: {}, ...request });
    assert.equal(denied.statusCode, 403); assert.equal(denied.json().error.code, 'CART_ORIGIN_FORBIDDEN');
  }
  const session = await app.inject({ method: 'POST', url: '/api/cart/session', remoteAddress: proxy, headers, payload: {} });
  assert.equal(session.statusCode, 201, session.body);
  assert.equal(session.headers['access-control-allow-origin'], origin); assert.equal(session.headers['access-control-allow-credentials'], 'true');
  const setCookie = String(session.headers['set-cookie']);
  assert.match(setCookie, /^__Host-shelfsync_cart=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Expires=.*; Secure$/);
  assert.ok(!setCookie.includes('Domain=')); assert.ok(!session.body.includes(setCookie.split(';')[0]!.split('=')[1]!));
  const cookie = setCookie.split(';')[0]!;
  const send = (url: string, payload: object) => app.inject({ method: 'POST', url, remoteAddress: proxy, headers: { ...headers, cookie, 'idempotency-key': randomUUID() }, payload });
  const items = [{ productId, quantity: 1 }];
  const hold = await send('/api/cart/reservations', { city: 'pune', items });
  assert.equal(hold.statusCode, 201, hold.body);
  const row = hold.json().reservations[0];
  assert.equal(Date.parse(row.expiresAt) - Date.parse(row.createdAt), 30000);
  const refresh = await app.inject({ url: '/api/cart/reservations', remoteAddress: proxy, headers: { ...headers, cookie } });
  assert.equal(refresh.json().reservations[0].expiresAt, row.expiresAt); assert.equal(refresh.headers['set-cookie'], undefined);
  assert.equal((await app.inject(`/api/products/${productId}?city=pune`)).json().stock, 0);
  const legacy = await app.inject({ method: 'POST', url: '/api/orders', payload: { city: 'pune', items } });
  assert.equal(legacy.statusCode, 409); assert.equal(legacy.json().error.code, 'INSUFFICIENT_STOCK');
  const checkout = await send('/api/orders', { city: 'pune', items, reservationIds: [row.reservationId] });
  assert.equal(checkout.statusCode, 201, checkout.body); assert.equal(checkout.json().status, 'confirmed');
  assert.equal((await pool.query('SELECT quantity FROM inventory WHERE product_id=$1', [productId])).rows[0].quantity, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM outbox_events WHERE published_at IS NULL')).rows[0].count, 2);
  assert.equal((await app.inject(`/api/orders/${checkout.json().orderId}/tracking`)).json().status, 'confirmed');
  for (const url of ['/api/admin/overview', '/api/admin/inventory', '/api/admin/orders', '/api/admin/events', '/api/admin/profitability/overview']) {
    assert.equal((await app.inject({ url, headers, remoteAddress: proxy })).json().error.code, 'ADMIN_DISABLED');
  }
  draining = true;
  assert.equal((await app.inject('/api/ready')).statusCode, 503); assert.deepEqual((await app.inject('/api/health')).json(), { status: 'ok' });
});
