import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

process.env.VITE_API_BASE_URL = '/api'
process.env.VITE_DEMO_ORDERS_API_PATH = '/api/demo/orders'
const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
after(() => vite.close())
const { loadRetailerOrders, retailerOrderPath } = await vite.ssrLoadModule('/src/services/retailer-orders.ts')
const { startVisibleRefresh } = await vite.ssrLoadModule('/src/services/visible-refresh.ts')

const old = { orderId: 'ord_old', city: 'pune', total: 500, status: 'confirmed', createdAt: '2026-11-21T10:00:00Z' }
const recent = { ...old, orderId: 'ord_new', createdAt: '2026-11-21T11:00:00Z' }
const response = (orders) => Response.json({ orders, asOf: '2026-11-21T12:00:00Z', page: { limit: 10, nextCursor: 'opaque-token' } })

test('a refresh replaces the page with unique newest-first orders, exposing only approved fields', async (t) => {
  let calls = 0
  const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/demo/orders?limit=10&cursor=a%2Bb')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.cache, 'no-store')
    return response(++calls === 1 ? [old] : [old, { ...recent, name: 'fixture name', email: 'fixture email' }, old])
  })
  const signal = new AbortController().signal
  assert.deepEqual((await loadRetailerOrders('a+b', signal)).data.orders, [old])
  assert.deepEqual((await loadRetailerOrders('a+b', signal)).data.orders, [recent, old])
  assert.equal(request.mock.calls.length, 2)
  assert.equal(retailerOrderPath(undefined), 'admin/orders?limit=10')
  assert.throws(() => retailerOrderPath('https://other.example/api/orders'), /relative/)
})

test('empty live feed, disabled feed and temporary outages remain distinct', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => response([]))
  const signal = new AbortController().signal
  assert.deepEqual((await loadRetailerOrders(undefined, signal)).data.orders, [])
  fetch.mock.mockImplementation(async () => Response.json({ error: { code: 'DEMO_ORDERS_DISABLED' } }, { status: 503 }))
  assert.deepEqual(await loadRetailerOrders(undefined, signal), { source: 'demo' })
  fetch.mock.mockImplementation(async () => Response.json({ error: { code: 'DATABASE_UNAVAILABLE' } }, { status: 503 }))
  assert.equal((await loadRetailerOrders(undefined, signal)).source, 'unavailable')
})

test('visible polling starts immediately, refreshes at five seconds, and aborts hidden or unmounted work', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const document = new EventTarget()
  document.visibilityState = 'visible'
  const requests = []
  const updates = []
  const feed = startVisibleRefresh(document, (signal) => new Promise((resolve) => requests.push({ signal, resolve })),
    (event) => updates.push(event))
  assert.deepEqual(updates, [{ loading: true }])
  requests[0].resolve([old])
  await Promise.resolve()
  assert.deepEqual(updates.at(-1).data, [old])
  t.mock.timers.tick(4999)
  assert.equal(requests.length, 1)
  t.mock.timers.tick(1)
  requests[1].resolve([recent, old])
  await Promise.resolve()
  assert.deepEqual(updates.at(-1).data, [recent, old])
  t.mock.timers.tick(5000)
  document.visibilityState = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  assert(requests[2].signal.aborted)
  requests[2].resolve(['stale'])
  await Promise.resolve()
  t.mock.timers.tick(10_000)
  assert.equal(requests.length, 3)
  assert(!updates.some(({ data }) => data?.includes('stale')))
  document.visibilityState = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(requests.length, 4)
  feed.stop()
  assert(requests[3].signal.aborted)
  document.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(10_000)
  assert.equal(requests.length, 4)
})
