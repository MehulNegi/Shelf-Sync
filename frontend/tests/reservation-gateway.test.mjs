import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { forwardReservation } from '../server/reservation-gateway.mjs'
import { vercelConfig } from '../vercel.mjs'

const site = 'https://store.vercel.app'
const upstream = 'https://fixture.onrender.com'
const secret = randomBytes(32)
const env = { VERCEL: '1', RESERVATION_GATEWAY_ROUTING: 'true', RESERVATION_GATEWAY_VERCEL_VERIFIED: 'true', RESERVATION_GATEWAY_FRONTEND_ORIGIN: site,
  RENDER_API_ORIGIN: upstream, RESERVATION_GATEWAY_SECRET: secret.toString('base64url') }
const headers = { host: 'store.vercel.app', 'x-forwarded-host': 'store.vercel.app', 'x-forwarded-proto': 'https',
  'x-forwarded-for': '192.0.2.15', 'x-vercel-forwarded-for': '192.0.2.15', origin: site,
  cookie: '__Host-shelfsync_cart=fixture; unrelated=private', 'content-type': 'application/json',
  'idempotency-key': 'key-fixture', 'x-shelfsync-gateway': 'forged', forwarded: 'for=unknown' }
const target = '/api/cart/reservations?city=pune&q=a%2Bb'
const body = '{ "fixture": true }'
const request = (overrides = {}, data = body) => new Request(site + target, {
  method: 'PATCH', headers: { ...headers, ...overrides }, body: data,
})

test('gateway signs exact forwarded data and preserves cart cookies and response semantics', async () => {
  const response = await forwardReservation(request(), env, async (url, init) => {
    assert.equal(url.href, upstream + target)
    assert.equal(init.method, 'PATCH')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.body.toString(), body)
    assert.deepEqual([...init.headers.keys()].sort(), ['content-type', 'cookie', 'idempotency-key', 'origin', 'x-shelfsync-gateway'])
    assert.equal(init.headers.get('cookie'), '__Host-shelfsync_cart=fixture')
    const [claims, mac] = init.headers.get('x-shelfsync-gateway').split('.')
    assert.equal(mac, createHmac('sha256', secret).update(claims).digest('base64url'))
    const [v, time, nonce, ...rest] = JSON.parse(Buffer.from(claims, 'base64url'))
    assert.equal(v, 1)
    assert(Math.abs(Date.now() - time) < 1000)
    assert.match(nonce, /^[\da-f-]{36}$/)
    const hash = value => createHash('sha256').update(value).digest('hex')
    assert.deepEqual(rest, [upstream, 'PATCH', target, site, '192.0.2.15', 'key-fixture', 'application/json',
      hash('__Host-shelfsync_cart=fixture'), hash(body)])
    const result = new Headers({ 'retry-after': '5', 'content-type': 'application/json' })
    result.append('Set-Cookie', '__Host-shelfsync_cart=fixture; Secure; HttpOnly; SameSite=Strict; Path=/')
    result.append('Set-Cookie', 'second=fixture; Path=/')
    return new Response('{}', { status: 429, headers: result })
  })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '5')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.getSetCookie().length, 2)
  assert.match(response.headers.getSetCookie()[0], /Secure; HttpOnly; SameSite=Strict; Path=\//)
})

test('gateway rejects invalid metadata, upstreams, redirects and oversized bodies', async () => {
  const never = () => assert.fail('unexpected upstream call')
  for (const override of [{ 'x-forwarded-for': '192.0.2.9' }, { 'x-forwarded-proto': 'http' },
    { 'x-forwarded-host': 'other.test' }, { origin: 'https://other.test' }, { 'x-vercel-forwarded-for': '192.0.2.15, 192.0.2.20' }]) {
    assert.equal((await forwardReservation(request(override), env, never)).status, 403)
  }
  for (const override of [{ RESERVATION_GATEWAY_VERCEL_VERIFIED: '' }, { VERCEL: '' }, { RENDER_API_ORIGIN: upstream + '.invalid' }]) {
    assert.equal((await forwardReservation(request(), { ...env, ...override }, never)).status, 503)
  }
  assert.equal((await forwardReservation(request({}, 'b'.repeat(65537)), env, never)).status, 413)
  assert.equal((await forwardReservation(request(), env, () => Response.redirect('https://other.test'))).status, 502)
})

test('protected function paths are excluded from the external rewrite only in gateway mode', () => {
  const live = { RENDER_API_ORIGIN: upstream, VITE_API_BASE_URL: '/api' }
  assert.equal(vercelConfig(live).rewrites[0].source, '/api/:path*')
  assert.throws(() => vercelConfig({ ...live, VITE_CART_RESERVATIONS: 'true' }), /gateway routing/)
  const demo = { ...live, VITE_CART_RESERVATIONS: 'true', RESERVATION_GATEWAY_ROUTING: 'true' }
  assert.throws(() => vercelConfig(demo), /Verify the deployed Vercel gateway metadata/)
  assert.equal(vercelConfig({ ...demo, RESERVATION_GATEWAY_VERCEL_VERIFIED: 'true' }).rewrites.length, 5)
  const rules = vercelConfig({ ...live, RESERVATION_GATEWAY_ROUTING: 'true' }).rewrites
  assert.deepEqual(rules.slice(0, -1).map(r => r.source), [
    '/api/cart/session', '/api/cart/reservations', '/api/cart/reservations/release', '/api/orders',
  ])

  const rule = rules.at(-1)
  const match = new RegExp('^' + rule.source.replace(':path', '') + '$')
  for (const path of ['/api/cart/session', '/api/cart/reservations', '/api/cart/reservations/release', '/api/orders', '/api/orders/', '/api/reservation-gateway/reservations', '/api/_reservation/reservations']) {
    assert(!match.test(path), path)
  }
  for (const path of ['/api/orders/ord_123/tracking', '/api/products', '/api/ready']) assert(match.test(path), path)
})

test('every protected rewrite targets a discoverable Vercel function entry point', async () => {
  const env = { RENDER_API_ORIGIN: upstream, VITE_API_BASE_URL: '/api', RESERVATION_GATEWAY_ROUTING: 'true' }
  const config = vercelConfig(env)
  assert.equal(config.git.deploymentEnabled['fix/vercel-reservation-discovery'], false)
  for (const { destination } of config.rewrites.slice(0, -1)) {
    assert.match(destination, /^\/api\/reservation-gateway\/[a-z]+$/)
    const entry = await import(new URL(`..${destination}.mjs`, import.meta.url))
    assert.equal(typeof entry.default.fetch, 'function')
  }
})
