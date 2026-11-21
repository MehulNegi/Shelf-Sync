import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

// Import the deployment config before setting test-only Vite variables.
const { vercelConfig } = await import('../vercel.mjs')
const upstream = 'https://shelfsync-fixture.onrender.com'
const live = { RENDER_API_ORIGIN: upstream, VITE_API_BASE_URL: '/api' }

test('Vercel routes only API traffic to the configured HTTPS origin without caching', () => {
  const config = vercelConfig({ ...live, RENDER_API_ORIGIN: upstream + '/' })
  assert.deepEqual(config.rewrites, [{ source: '/api/:path*', destination: upstream + '/api/:path*' }])
  assert.deepEqual(Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value])), {
    'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
  })
  assert.equal(config.headers[0].source, '/api/:path*')
  assert.equal(vercelConfig({}).rewrites, undefined)
  for (const env of [{ ...live, VITE_API_BASE_URL: upstream }, { VITE_API_BASE_URL: '/api' }, { RENDER_API_ORIGIN: upstream }]) {
    assert.throws(() => vercelConfig(env), /Configure both/)
  }
  for (const origin of ['http://shelfsync-fixture.onrender.com', 'https://shelfsync-fixture.onrender.com.evil.test',
    'https://user:pass@shelfsync-fixture.onrender.com', upstream + '/api', upstream + '?target=other', upstream + ':443']) {
    assert.throws(() => vercelConfig({ ...live, RENDER_API_ORIGIN: origin }), /must be an HTTPS onrender.com origin/)
  }
})

process.env.VITE_API_BASE_URL = '/api'
process.env.VITE_CART_RESERVATIONS = 'false'
const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
after(() => vite.close())
const { baseUrl, isMockMode } = await vite.ssrLoadModule('/src/services/backend.ts')
const { getProducts } = await vite.ssrLoadModule('/src/services/products.ts')
const { startCartSession, mutateReservation, reservationsEnabled } = await vite.ssrLoadModule('/src/services/reservations.ts')

test('same-origin catalog and reservation requests preserve queries, methods, credentials and errors', async (t) => {
  assert.equal(baseUrl, '')
  assert.equal(isMockMode, false)
  assert.equal(reservationsEnabled, false)
  const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const reservationId = '44444444-4444-4444-8444-444444444444'
  const mock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.startsWith('/api/products?')) return Response.json({ products: [], total: 0 })
    if (url === '/api/cart/session') return Response.json({}, { status: 201 })
    return Response.json({ error: { code: 'RESERVATION_EXPIRED', message: 'Hold expired' } }, { status: 409 })
  })
  await getProducts({ city: 'pune', q: 'shirt & cap' })
  await startCartSession()
  await assert.rejects(mutateReservation({ kind: 'update', city: 'pune', key, reservationId,
    item: { productId: 'prod_001', quantity: 2 } }), { status: 409, code: 'RESERVATION_EXPIRED' })
  const [[catalog], [session, start], [reservation, update]] = mock.mock.calls.map(({ arguments: args }) => args)
  assert.equal(catalog, '/api/products?city=pune&q=shirt+%26+cap')
  assert.equal(session, '/api/cart/session')
  assert.equal(start.method, 'POST')
  assert.equal(start.body, '{}')
  assert.equal(start.credentials, 'include')
  assert.equal(reservation, '/api/cart/reservations')
  assert.equal(update.method, 'PATCH')
  assert.equal(update.credentials, 'include')
  assert.equal(update.redirect, 'error')
  assert.equal(update.cache, 'no-store')
  assert.equal(update.headers['Idempotency-Key'], key)
  assert.deepEqual(JSON.parse(update.body), { city: 'pune', items: [{ reservationId, quantity: 2 }] })
})
