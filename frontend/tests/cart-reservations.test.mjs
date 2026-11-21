import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

process.env.VITE_API_BASE_URL = 'https://store.example/api'
process.env.VITE_CART_RESERVATIONS = 'true'
const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const {
  checkoutReservationIds, getReservations, isUncertainReservation, mutateReservation,
  newOperationKey, remainingSeconds, reservationError, startCartSession, timedReservations,
} = await vite.ssrLoadModule('/src/services/reservations.ts')
const { placeOrder } = await vite.ssrLoadModule('/src/services/orders.ts')
const { cartReducer, loadCart } = await vite.ssrLoadModule('/src/services/cart.ts')
after(() => vite.close())

const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const item = { productId: 'prod_001', quantity: 1 }
const reservationId = '44444444-4444-4444-8444-444444444444'
const city = 'pune'
const serverTime = '2026-11-21T12:00:00.000Z'
const row = {
  reservationId, ...item, city, status: 'active', createdAt: serverTime, updatedAt: serverTime,
  expiresAt: '2026-11-21T12:00:30.000Z', requiresReservation: false, orderId: null,
}
const envelope = { serverTime, reservations: [row] }

test('session setup accepts 200 and 201, and owned reads carry only browser credentials', async (t) => {
  let status = 201
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.credentials, 'include')
    if (url.endsWith('/cart/session')) {
      assert.equal(init.body, '{}')
      assert.equal(init.method, 'POST')
      assert.deepEqual(init.headers, { 'Content-Type': 'application/json' })
      return Response.json({ serverTime, sessionExpiresAt: '2026-11-22T12:00:00.000Z' }, { status: status-- })
    }
    assert.equal(url, 'https://store.example/api/cart/reservations')
    assert.equal(init.headers, undefined)
    return Response.json(envelope)
  })
  await startCartSession()
  await startCartSession()
  assert.deepEqual(await getReservations(), envelope)
})

test('create, quantity adjustment and release use exact C7 bodies and UUID idempotency keys', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async (url, init) =>
    Response.json(envelope, { status: init.method === 'POST' && !url.endsWith('/release') ? 201 : 200 }),
  )
  await mutateReservation({ kind: 'create', key, city, item })
  await mutateReservation({ kind: 'update', key, city, item: { ...item, quantity: 3 }, reservationId })
  await mutateReservation({ kind: 'remove', key, city, productId: item.productId, reservationIds: [reservationId] })
  await mutateReservation({ kind: 'switch', key, city: 'delhi', reservationIds: [reservationId] })
  assert.deepEqual(request.mock.calls.map(({ arguments: [url, init] }) => {
    assert.equal(init.credentials, 'include')
    assert.equal(init.headers['Idempotency-Key'], key)
    return [new URL(url).pathname, init.method, JSON.parse(init.body)]
  }), [
    ['/api/cart/reservations', 'POST', { city, items: [item] }],
    ['/api/cart/reservations', 'PATCH', { city, items: [{ reservationId, quantity: 3 }] }],
    ['/api/cart/reservations/release', 'POST', { reservationIds: [reservationId] }],
    ['/api/cart/reservations/release', 'POST', { reservationIds: [reservationId] }],
  ])
  assert.match(newOperationKey(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  assert.notEqual(newOperationKey(), newOperationKey())
})

test('server deadlines survive reload, never extend on refresh, and expire at exact equality', () => {
  const [hold] = timedReservations(envelope, 100, [])
  assert.equal(remainingSeconds(hold, 100), 30)
  assert.equal(remainingSeconds(hold, 20_100), 10)
  assert.equal(remainingSeconds(hold, 30_099), 1)
  assert.equal(remainingSeconds(hold, 30_100), 0)
  const later = { ...envelope, serverTime: '2026-11-21T12:00:21.000Z' }
  const [reloaded] = timedReservations(later, 0, [])
  assert.equal(remainingSeconds(reloaded, 0), 9)
  const [updated] = timedReservations(later, 22_000, [hold])
  assert.equal(updated.deadline, hold.deadline)
  const [renewed] = timedReservations({ ...later, reservations: [{
    ...row, reservationId: '55555555-5555-4555-8555-555555555555', expiresAt: '2026-11-21T12:00:51.000Z',
  }] }, 22_000, [hold])
  assert.equal(remainingSeconds(renewed, 22_000), 30)
})

test('checkout requires an exact, unexpired set and preserves the reserved request body', async (t) => {
  const [hold] = timedReservations(envelope, 0, [])
  assert.deepEqual(checkoutReservationIds(city, [item], [hold], 29_999), [reservationId])
  assert.equal(checkoutReservationIds(city, [item], [hold], 30_000), null)
  assert.equal(checkoutReservationIds(city, [item], [], 0), null)
  assert.equal(checkoutReservationIds(city, [{ ...item, quantity: 2 }], [hold], 0), null)
  assert.equal(checkoutReservationIds('delhi', [item], [hold], 0), null)
  const confirmation = { success: true, orderId: 'ord_held', status: 'confirmed', total: 1999 }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://store.example/api/orders')
    assert.equal(init.credentials, 'include')
    assert.equal(init.headers['Idempotency-Key'], key)
    assert.deepEqual(JSON.parse(init.body), { city, items: [item], reservationIds: [reservationId] })
    return Response.json(confirmation, { status: 201 })
  })
  assert.deepEqual(await placeOrder({ city, items: [item] }, { key, reservationIds: [reservationId] }), confirmation)
})

test('stock conflicts are definitive, timeout retries reuse the key, and malformed success is rejected', async (t) => {
  const operation = { kind: 'create', key, city, item }
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    success: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock available' },
  }, { status: 409 }))
  await assert.rejects(mutateReservation(operation), (error) =>
    !isUncertainReservation(error) && reservationError(error).includes('Another customer'))
  fetch.mock.mockImplementation(async () => { throw new TypeError('Connection lost') })
  await assert.rejects(mutateReservation(operation), isUncertainReservation)
  fetch.mock.mockImplementation(async (_url, init) => {
    assert.equal(init.headers['Idempotency-Key'], key)
    return Response.json({ ...envelope, reservations: [{ ...row, quantity: 0 }] }, { status: 201 })
  })
  await assert.rejects(mutateReservation(operation), { code: 'INVALID_RESERVATION' })
})

test('city navigation keeps desired quantities and purchase/removal change only the relevant city', () => {
  let cart = loadCart({ getItem: () => null }, 'test')
  cart = cartReducer(cart, { type: 'setQuantity', city, ...item, quantity: 2 })
  cart = cartReducer(cart, { type: 'selectCity', city: 'delhi' })
  cart = cartReducer(cart, { type: 'setQuantity', city: 'delhi', ...item })
  cart = cartReducer(cart, { type: 'purchase', city, items: [item] })
  assert.deepEqual(cart.itemsByCity.pune, [item])
  assert.deepEqual(cart.itemsByCity.delhi, [item])
  cart = cartReducer(cart, { type: 'remove', city: 'delhi', productId: item.productId })
  assert.deepEqual(cart.itemsByCity.pune, [item])
  assert.deepEqual(cart.itemsByCity.delhi, [])
})
