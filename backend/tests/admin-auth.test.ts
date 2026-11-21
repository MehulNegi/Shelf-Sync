import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { loadAdminConfig } from '../src/config/admin.js';
import { createAdminAuthorizer } from '../src/services/admin-auth.js';
import { AdminService } from '../src/services/admin.js';
import { AdminCursor } from '../src/services/admin-cursor.js';
import type { AdminRepository } from '../src/types/admin.js';
import { adminCredentials } from './helpers/admin.js';

const noData: AdminRepository = {
  async overview() { assert.fail('unauthorized request reached PostgreSQL'); },
  async inventory() { assert.fail('unauthorized request reached PostgreSQL'); },
  async orders() { assert.fail('unauthorized request reached PostgreSQL'); },
  async events() { assert.fail('unauthorized request reached PostgreSQL'); }
};
const storefront = {
  frontendOrigin: 'http://localhost:5173', products: { async list() { return []; }, async findById() { return undefined; } },
  orders: { async checkout() { assert.fail('admin tests must not check out'); }, async findById() { return undefined; } }
};

test('admin routes fail closed by default without affecting health or storefront', async t => {
  const app = buildApp(storefront); t.after(() => app.close());
  for (const endpoint of ['overview', 'inventory', 'orders', 'events']) {
    const response = await app.inject(`/api/admin/${endpoint}?unexpected=true`);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { success: false, error: { code: 'ADMIN_DISABLED', message: 'Admin API is not enabled' } });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.deepEqual((await app.inject('/api/health')).json(), { status: 'ok' });
  assert.equal((await app.inject('/api/products?city=pune')).statusCode, 200);
});

test('real signed JWT verification rejects invalid credentials before query validation/data reads', async t => {
  const credentials = await adminCredentials();
  const app = buildApp({ ...storefront, admin: { authorize: createAdminAuthorizer(credentials.config, credentials.resolver),
    service: new AdminService(noData, new AdminCursor(credentials.config.cursorSecret)) } });
  t.after(() => app.close());
  const now = Math.floor(Date.now() / 1000);
  const other = await adminCredentials();
  for (const endpoint of ['overview', 'inventory', 'orders', 'events']) {
    const response = await app.inject(`/api/admin/${endpoint}`);
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'UNAUTHENTICATED');
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  }
  const tokens = ['', 'invalid', await credentials.token({ exp: now - 1 }), await credentials.token({ nbf: now + 60 }),
    await credentials.token({ iss: 'https://untrusted.example/' }), await credentials.token({ aud: 'wrong-audience' }),
    await credentials.token({ sub: '' }), await credentials.token({}, ['exp']), await credentials.token({ exp: now + 901 }),
    await other.token()];
  for (const token of tokens) {
    const response = await app.inject({ url: '/api/admin/orders?limit=999', headers: credentials.headers(token) });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
    assert.deepEqual(response.json(), { success: false, error: { code: 'UNAUTHENTICATED', message: 'Admin authentication required' } });
    assert.ok(!token || !response.body.includes(token));
  }
  for (const roles of [[], ['customer'], 'inventory_admin']) {
    const response = await app.inject({ url: '/api/admin/orders', headers: { ...credentials.headers(await credentials.token({ roles })), 'x-admin': 'true' } });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'FORBIDDEN');
  }
});

test('documented JWT claims authorize real signatures without requiring optional sub/iat', async t => {
  const credentials = await adminCredentials();
  const app = buildApp({ ...storefront, admin: { authorize: createAdminAuthorizer(credentials.config, credentials.resolver),
    service: new AdminService({ ...noData, async inventory() { return { asOf: new Date().toISOString(), items: [], next: null }; } }, new AdminCursor(credentials.config.cursorSecret)) } });
  t.after(() => app.close());
  for (const omit of [[], ['iat'], ['sub'], ['iat', 'sub']]) {
    const response = await app.inject({ url: '/api/admin/inventory', headers: credentials.headers(await credentials.token({}, omit)) });
    assert.equal(response.statusCode, 200);
  }
});

test('valid admin token still requires HTTPS/trusted TLS proxy and the configured origin', async t => {
  const credentials = await adminCredentials();
  const app = buildApp({ ...storefront, admin: { authorize: createAdminAuthorizer(credentials.config, credentials.resolver),
    service: new AdminService(noData, new AdminCursor(credentials.config.cursorSecret)) } });
  t.after(() => app.close());
  const headers = credentials.headers(await credentials.token());
  for (const request of [
    { headers: { ...headers, 'x-forwarded-proto': 'http' } },
    { headers, remoteAddress: '192.0.2.10' },
    { headers: { ...headers, origin: 'https://untrusted.example' } }
  ]) assert.equal((await app.inject({ url: '/api/admin/inventory', ...request })).statusCode, 403);
});

test('local demonstration is explicit, refuses public binding/production, and cannot trust forwarded peers', async t => {
  const secret = randomBytes(32).toString('base64url');
  const runtime = { host: '127.0.0.1', frontendOrigin: storefront.frontendOrigin, nodeEnv: 'development' };
  const env = { ADMIN_AUTH_MODE: 'local-demo', ADMIN_CURSOR_SECRET: secret };
  assert.equal(loadAdminConfig({ ...runtime, host: '0.0.0.0' }, env).mode, 'disabled');
  assert.equal(loadAdminConfig({ ...runtime, nodeEnv: 'production' }, env).mode, 'disabled');
  assert.equal(loadAdminConfig({ ...runtime, frontendOrigin: 'http://untrusted.example' }, env).mode, 'disabled');
  const config = loadAdminConfig(runtime, env); assert.equal(config.mode, 'local-demo');
  let reads = 0;
  const repository = { ...noData, async inventory() { reads++; return { asOf: new Date().toISOString(), items: [], next: null }; } };
  const app = buildApp({ ...storefront, admin: { authorize: createAdminAuthorizer(config), service: new AdminService(repository, new AdminCursor(config.cursorSecret)) } });
  t.after(() => app.close());
  const allowed = { host: 'localhost:3000', origin: runtime.frontendOrigin };
  assert.equal((await app.inject({ url: '/api/admin/inventory', headers: allowed })).statusCode, 200);
  for (const request of [
    { headers: allowed, remoteAddress: '192.0.2.2' }, { headers: { ...allowed, host: 'untrusted.example' } },
    { headers: { ...allowed, origin: 'null' } }, { headers: { ...allowed, 'x-forwarded-for': '127.0.0.1' } },
    { headers: { ...allowed, 'x-forwarded-proto': 'https' } }, { headers: { ...allowed, host: 'user@localhost' } }
  ]) assert.equal((await app.inject({ url: '/api/admin/inventory', ...request })).statusCode, 403);
  assert.equal(reads, 1);
});

test('admin configuration cannot enable a weak or incomplete JWT/cursor setup', () => {
  const runtime = { host: '0.0.0.0', frontendOrigin: 'https://shop.example', nodeEnv: 'production' };
  const env = { ADMIN_AUTH_MODE: 'jwt', ADMIN_CURSOR_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_JWT_ISSUER: 'https://identity.example/', ADMIN_JWT_AUDIENCE: 'admin', ADMIN_JWT_JWKS_URL: 'https://identity.example/jwks' };
  assert.equal(loadAdminConfig(runtime, {}).mode, 'disabled');
  assert.equal(loadAdminConfig(runtime, env).mode, 'jwt');
  for (const patch of [{ ADMIN_CURSOR_SECRET: 'short' }, { ADMIN_JWT_ISSUER: '' }, { ADMIN_JWT_JWKS_URL: 'http://identity.example/jwks' },
    { ADMIN_JWT_ALGORITHMS: 'HS256' }, { ADMIN_JWT_ALGORITHMS: 'none' }, { ADMIN_HTTPS_PROXY_IPS: '*' }]) {
    assert.equal(loadAdminConfig(runtime, { ...env, ...patch }).mode, 'disabled');
  }
});
