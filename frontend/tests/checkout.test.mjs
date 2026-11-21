import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const originalApiBase = process.env.VITE_API_BASE_URL
process.env.VITE_API_BASE_URL = 'https://store.example/api/'
const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const { placeOrder, getOrder } = await vite.ssrLoadModule('/src/services/orders.ts')
const { getProduct, getProducts } = await vite.ssrLoadModule('/src/services/products.ts')
const { ApiError, checkoutErrorMessage } = await vite.ssrLoadModule('/src/services/api-error.ts')
const { mockPlaceOrder, mockGetOrder } = await vite.ssrLoadModule('/src/mocks/orders.ts')
after(async () => {
  await vite.close()
  if (originalApiBase === undefined) delete process.env.VITE_API_BASE_URL
  else process.env.VITE_API_BASE_URL = originalApiBase
})

const request = { city: 'pune', items: [{ productId: 'prod_001', quantity: 1 }] }
const confirmation = { success: true, orderId: 'ord_123', status: 'confirmed', total: 1999 }
const details = {
  id: 'ord_123', city: 'pune', status: 'confirmed', total: 1999,
  items: [{ productId: 'prod_001', quantity: 1, name: 'Earphones', unitPrice: 1999 }],
}

test('live checkout posts only contracted fields and fetches authoritative confirmation details', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') {
      assert.equal(url, 'https://store.example/api/orders')
      assert.equal(options.headers['Content-Type'], 'application/json')
      assert.deepEqual(JSON.parse(options.body), request)
      return Response.json(confirmation, { status: 201 })
    }
    assert.equal(url, 'https://store.example/api/orders/ord_123')
    return Response.json(details)
  })
  const created = await placeOrder({
    ...request, total: 1, items: [{ ...request.items[0], unitPrice: 1 }],
  })
  assert.deepEqual(created, confirmation)
  assert.deepEqual(await getOrder(created.orderId, new AbortController().signal), details)
  assert.equal(fetch.mock.callCount(), 2)
})

test('product listing and details send contracted city and optional filters', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}))
  const signal = new AbortController().signal
  await getProducts({ city: 'delhi', q: 'usb c', category: 'electronics', minPrice: 0, maxPrice: 900 }, signal)
  await getProduct('prod/001', 'bengaluru', signal)
  const [list, detail] = fetch.mock.calls.map(({ arguments: [url] }) => new URL(url))
  assert.equal(list.pathname, '/api/products')
  assert.deepEqual(Object.fromEntries(list.searchParams), {
    city: 'delhi', q: 'usb c', category: 'electronics', minPrice: '0', maxPrice: '900',
  })
  assert.equal(detail.pathname, '/api/products/prod%2F001')
  assert.equal(detail.searchParams.get('city'), 'bengaluru')
})

test('HTTP 409 preserves the contract error code and prompts for a cart correction', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    success: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock available' },
  }, { status: 409 }))
  await assert.rejects(placeOrder(request), (error) =>
    error instanceof ApiError && error.status === 409 && error.code === 'INSUFFICIENT_STOCK' &&
    /stock changed.*review availability/i.test(checkoutErrorMessage(error)),
  )
})

test('network failure is surfaced and never automatically retries checkout', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(placeOrder(request), (error) =>
    error instanceof ApiError && error.status === 0 && /connection.*failed/i.test(checkoutErrorMessage(error)),
  )
  assert.equal(fetch.mock.callCount(), 1)
})

test('unexpected HTTP errors and invalid confirmations cannot clear the cart as a success', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }))
  await assert.rejects(placeOrder(request), { status: 503 })
  fetch.mock.mockImplementation(async () => Response.json({}, { status: 201 }))
  await assert.rejects(placeOrder(request), { code: 'INVALID_CONFIRMATION' })
})

test('mock checkout creates retrievable details and deducts only valid city stock', () => {
  const created = mockPlaceOrder(request)
  assert.equal(created.success, true)
  assert.match(created.orderId, /^ord_mock_/)
  const order = mockGetOrder(created.orderId)
  assert.equal(order.city, 'pune')
  assert.equal(order.total, created.total)
  assert.equal(order.items[0].quantity, 1)
  assert.throws(() => mockPlaceOrder({
    city: 'pune', items: [{ productId: 'prod_001', quantity: 12 }],
  }), { status: 409, code: 'INSUFFICIENT_STOCK' })
})
