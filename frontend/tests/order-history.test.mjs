import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
}

async function loadOrders(baseUrl) {
  process.env.VITE_API_BASE_URL = baseUrl
  const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
  after(() => vite.close())
  return {
    ...await vite.ssrLoadModule('/src/services/orders.ts'),
    ...await vite.ssrLoadModule('/src/services/order-history.ts'),
    ...await vite.ssrLoadModule('/src/services/order-tracking.ts'),
  }
}

const liveUrl = 'https://store.example'
const live = await loadOrders(liveUrl)
const mock = await loadOrders('')
const request = { city: 'pune', items: [{ productId: 'prod_001', quantity: 1 }] }

test('successful real checkout stores IDs only and restores newest first after reload', async (t) => {
  let sequence = 0
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    success: true, orderId: 'ord_' + ++sequence, status: 'confirmed', total: 1999,
  }, { status: 201 }))

  await live.placeOrder(request)
  await live.placeOrder(request)
  assert.deepEqual(live.getOrderIds(), ['ord_2', 'ord_1'])
  assert.deepEqual([...storage.values()].map(JSON.parse), [['ord_2', 'ord_1']])
  const reloaded = await loadOrders(liveUrl)
  assert.deepEqual(reloaded.getOrderIds(), ['ord_2', 'ord_1'])
})

test('mock history and simulated details survive reload without entering real history', async () => {
  const created = await mock.placeOrder(request)
  assert.deepEqual(mock.getOrderIds(), [created.orderId])
  assert(!live.getOrderIds().includes(created.orderId))
  const reloaded = await loadOrders('')
  assert.deepEqual(reloaded.getOrderIds(), [created.orderId])
  const details = await reloaded.getOrder(created.orderId, new AbortController().signal)
  assert.equal(details.id, created.orderId)
  assert.equal(details.status, 'confirmed')
  assert.equal(details.items[0].productId, 'prod_001')
})

test('missing real orders retain their local reference and failed checkouts do not add IDs', async (t) => {
  live.rememberOrder('ord_missing')
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' },
  }, { status: 404 }))
  await assert.rejects(live.getOrder('ord_missing', new AbortController().signal), { status: 404 })
  assert(live.getOrderIds().includes('ord_missing'))

  const previous = live.getOrderIds()
  await assert.rejects(live.placeOrder(request), { status: 404 })
  assert.deepEqual(live.getOrderIds(), previous)
})

test('tracking shows only stages supported by the persisted status', () => {
  const states = (status) => live.orderTracking(status).map((stage) => stage.state)
  assert.deepEqual(states('confirmed'), ['current', 'pending', 'pending', 'pending'])
  assert.deepEqual(states('shipped'), ['pending', 'pending', 'current', 'pending'])
  assert.deepEqual(states('pending'), ['pending', 'pending', 'pending', 'pending'])
  assert.deepEqual(states('cancelled'), ['pending', 'pending', 'pending', 'pending'])
  assert.equal(live.orderStatusLabel('cancelled'), 'Cancelled')
})
