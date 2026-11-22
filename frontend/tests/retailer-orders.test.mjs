import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

process.env.VITE_API_BASE_URL = '/api'
const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
after(() => vite.close())
const { loadRetailerOrders } = await vite.ssrLoadModule('/src/services/retailer-orders.ts')
const { startVisibleRefresh } = await vite.ssrLoadModule('/src/services/visible-refresh.ts')

const old = { orderId: 'ord_old', city: 'pune', total: 500, status: 'confirmed', createdAt: '2026-11-21T10:00:00Z' }
const recent = { ...old, orderId: 'ord_new', createdAt: '2026-11-21T11:00:00Z' }
const toFeedRow = ({ orderId, createdAt, ...rest }) => ({ id: orderId, created_at: createdAt, ...rest })
const response = (orders) => Response.json({ orders: orders.map(toFeedRow) })

test('a refresh replaces the page with unique newest-first orders, exposing only approved fields', async (t) => {
  let calls = 0
  const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/demo/orders')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.cache, 'no-store')
    return response(++calls === 1 ? [old] : [old, { ...recent, name: 'fixture name', email: 'fixture email' }, old])
  })
  const signal = new AbortController().signal
  assert.deepEqual((await loadRetailerOrders(signal)).data, [old])
  assert.deepEqual((await loadRetailerOrders(signal)).data, [recent, old])
  assert.equal(request.mock.calls.length, 2)
})

test('empty live feed, disabled feed and temporary outages remain distinct', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => response([]))
  const signal = new AbortController().signal
  assert.deepEqual(await loadRetailerOrders(signal), { source: 'live', data: [] })
  fetch.mock.mockImplementation(async () => Response.json({ error: { code: 'DEMO_ORDERS_DISABLED' } }, { status: 503 }))
  assert.deepEqual(await loadRetailerOrders(signal), { source: 'demo' })
  fetch.mock.mockImplementation(async () => Response.json({ error: { code: 'DATABASE_UNAVAILABLE' } }, { status: 503 }))
  assert.equal((await loadRetailerOrders(signal)).source, 'unavailable')
})

test('malformed feed responses are unavailable and do not display sample orders', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ orders: [old] }))
  const panel = await loadRetailerOrders(new AbortController().signal)
  assert.equal(panel.source, 'unavailable')
  assert.equal(panel.error.code, 'INVALID_ORDER_FEED')
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
