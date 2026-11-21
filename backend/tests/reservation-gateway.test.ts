import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadReservationConfig } from '../src/config/reservations.js';
import type { PgCartRepository } from '../src/repositories/cart.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const site = 'https://store.vercel.app';
const audience = 'https://fixture.onrender.com';
const secret = randomBytes(32);
const rateSecret = randomBytes(32);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const session = '/api/cart/session';
const orders = '/api/orders';
const headers = { origin: site, 'content-type': 'application/json', 'idempotency-key': randomUUID(), cookie: 'fixture=1' };
function sign(target: string, body: string, overrides: { time?: number; method?: string; ip?: string; host?: string } = {}) {
  const encoded = Buffer.from(JSON.stringify([
    1, overrides.time ?? Date.now(), randomUUID(), overrides.host ?? audience, overrides.method ?? 'POST', target,
    site, overrides.ip ?? '192.0.2.15', headers['idempotency-key'], headers['content-type'], hash(headers.cookie), hash(body),
  ])).toString('base64url');
  return encoded + '.' + createHmac('sha256', secret).update(encoded).digest('base64url');
}

test('signed gateway validates before database access, admits the signed IP and rejects replay', async t => {
  const seen = new Set<string>();
  let nonceCalls = 0;
  let checkoutCalls = 0;
  const repository = {
    async consumeGatewayNonce(digest: Buffer) {
      nonceCalls++;
      const key = digest.toString('hex');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    async httpAdmission(digest: Buffer) {
      assert.deepEqual(digest, createHmac('sha256', rateSecret).update('192.0.2.15').digest());
    },
    async session() { return { status: 201, body: { serverTime: 'now', sessionExpiresAt: 'later' } }; },
    async read() { return { status: 200, body: { serverTime: 'now', reservations: [] } }; },
  } as unknown as PgCartRepository;
  const app = buildApp({ frontendOrigin: site,
    products: { async list() { return []; }, async findById() { return undefined; } },
    orders: { async checkout() { checkoutCalls++; return { success: true, orderId: 'fixture', total: 1, status: 'confirmed' }; }, async findById() { return undefined; } },
    cart: { repository, config: { enabled: true, ttlSeconds: 30, localHttp: false, origin: site,
      rateSecret, httpsProxyIps: [], gateway: { audience, secret } } },
  });
  t.after(() => app.close());
  const send = (url: string, body: string, assertion?: string, extra = {}) => app.inject({
    method: 'POST', url, payload: body, headers: { ...headers, ...extra,
      'x-forwarded-proto': 'https', 'x-forwarded-for': '192.0.2.99', ...(assertion ? { 'x-shelfsync-gateway': assertion } : {}) },
  });
  const proof = sign(session, '{}');
  const orderBody = '{"city":"pune","items":[{"productId":"prod_001","quantity":1}]}';
  for (const result of await Promise.all([
    send(session, '{}'), send(session, '{}', proof + 'a'), send(session, '{ }', proof),
    send(session + '?a=b', '{}', proof), send(session, '{}', proof, { origin: 'https://untrusted.test' }),
    send(session, '{}', proof, { cookie: 'fixture=2' }), send(session, '{}', proof, { 'idempotency-key': randomUUID() }),
    send(session, '{}', proof, { 'content-type': 'application/json; charset=utf-8' }),
    send(session, '{}', sign(session, '{}', { time: Date.now() - 20_000 })),
    send(session, '{}', sign(session, '{}', { time: Date.now() + 20_000 })),
    send(session, '{}', sign(session, '{}', { method: 'PATCH' })),
    send(session, '{}', sign(session, '{}', { ip: '192.0.2.1, 192.0.2.2' })),
    send(session, '{}', sign(session, '{}', { host: 'https://other.onrender.com' })),
    send(orders, orderBody), send(orders, orderBody.replace(/}$/, `,"reservationIds":["${randomUUID()}"]}`)),
  ])) {
    assert.equal(result.statusCode, 403, result.body);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal(nonceCalls, 0);
  assert.equal(checkoutCalls, 0);

  assert.equal((await send(session, '{}', proof)).statusCode, 201);
  assert.equal((await send(session, '{}', proof)).statusCode, 403);
  const legacy = sign(orders, orderBody);
  const results = await Promise.all([send(orders, orderBody, legacy), send(orders, orderBody, legacy)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 403]);
  assert.equal(checkoutCalls, 1);

  const { forwardReservation } = await import(pathToFileURL(resolve('../frontend/server/reservation-gateway.mjs')).href);
  const cartHeaders = {
    ...headers, cookie: '__Host-shelfsync_cart=' + randomBytes(32).toString('base64url'),
    host: 'store.vercel.app', 'x-forwarded-host': 'store.vercel.app', 'x-forwarded-proto': 'https',
    'x-forwarded-for': '192.0.2.15', 'x-vercel-forwarded-for': '192.0.2.15',
  };
  const response = await forwardReservation(new Request(site + '/api/_reservation/reservations?city=pune', {
    headers: cartHeaders,
  }), { VERCEL: '1', RESERVATION_GATEWAY_ROUTING: 'true', RESERVATION_GATEWAY_VERCEL_VERIFIED: 'true',
    RENDER_API_ORIGIN: audience, RESERVATION_GATEWAY_FRONTEND_ORIGIN: site,
    RESERVATION_GATEWAY_SECRET: secret.toString('base64url'),
  }, async (url: URL, init: RequestInit) => {
    const upstream = await app.inject({ url: url.pathname + url.search, headers: Object.fromEntries(new Headers(init.headers)) });
    return new Response(upstream.body, { status: upstream.statusCode });
  }, '/api/cart/reservations');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { serverTime: 'now', reservations: [] });
});

test('signed mode requires canonical audience and a dedicated secret and forbids proxy fallback', () => {
  const runtime = { host: '0.0.0.0', nodeEnv: 'production', frontendOrigin: site };
  const env = { RESERVATION_SIGNED_GATEWAY: 'true', RESERVATION_GATEWAY_AUDIENCE: audience,
    RESERVATION_GATEWAY_SECRET: secret.toString('base64url'), RESERVATION_RATE_LIMIT_SECRET: rateSecret.toString('base64url') };
  assert.equal(loadReservationConfig(runtime, env).gateway?.audience, audience);
  for (const override of [{ RESERVATION_GATEWAY_AUDIENCE: audience + '/api' },
    { RESERVATION_GATEWAY_SECRET: env.RESERVATION_RATE_LIMIT_SECRET }, { RESERVATION_HTTPS_PROXY_IPS: '192.0.2.2' }]) {
    assert.throws(() => loadReservationConfig(runtime, { ...env, ...override }), /Signed reservation gateway/);
  }
});
