import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.VITE_API_BASE_URL = 'http://127.0.0.1:3000/api'
const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const { adminErrorMessage, clearsAdminData, isLocalAdminConfiguration, loadAdminSnapshot } = await vite.ssrLoadModule('/src/services/admin.ts')
const { startAdminRefresh } = await vite.ssrLoadModule('/src/services/admin-refresh.ts')
const { OverviewPanels, RecentOrders, EventActivity } = await vite.ssrLoadModule('/src/components/admin/DashboardPanels.tsx')
const { InventoryPanel } = await vite.ssrLoadModule('/src/components/admin/InventoryPanel.tsx')
after(() => vite.close())
const fixture = JSON.parse(await readFile(new URL('./fixtures/admin.json', import.meta.url), 'utf8'))
const signal = new AbortController().signal

function ok(url) {
  const name = new URL(url).pathname.split('/').at(-1)
  return Response.json(fixture[name])
}

test('contract responses parse unchanged and only contracted inventory query fields are sent', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.signal, signal)
    assert.equal(init.method, undefined)
    assert.equal(init.headers, undefined)
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'error')
    return ok(url)
  })
  const query = { city: 'pune', category: 'Electronics', stockStatus: 'low_stock', limit: 25, cursor: 'opaque+cursor/==' }
  assert.deepEqual(await loadAdminSnapshot(query, signal), fixture)
  const calls = fetch.mock.calls.map(({ arguments: [url] }) => new URL(url))
  assert.deepEqual(calls.map((url) => url.pathname), [
    '/api/admin/overview', '/api/admin/inventory', '/api/admin/orders', '/api/admin/events',
  ])
  assert.deepEqual(Object.fromEntries(calls[1].searchParams), { ...query, limit: '25' })
  assert.equal(calls[0].search, '')
  assert.equal(calls[2].search, '?limit=10')
  assert.equal(calls[3].search, '?limit=10')
})

test('KPI counts, city ratios, order details and Kafka publication labels render from the response', () => {
  const overview = renderToStaticMarkup(createElement(OverviewPanels, { overview: fixture.overview }))
  assert.match(overview, /Total inventory units<\/dt><dd>99<\/dd>/)
  assert.match(overview, /Low-stock product-city records<\/dt><dd>3<\/dd>/)
  assert.match(overview, /Out-of-stock product-city records<\/dt><dd>1<\/dd>/)
  assert.match(overview, /Orders today<\/dt><dd>7<\/dd>/)
  assert.match(overview, /Pending outbox events<\/dt><dd>2<\/dd>/)
  assert.match(overview, /Pune<\/dt>.*20 units.*Delhi<\/dt>.*30 units.*Bengaluru<\/dt>.*width:100%.*49 units/)
  const orders = renderToStaticMarkup(createElement(RecentOrders, { orders: fixture.orders.orders }))
  assert.match(orders, /ord_fixture.*Pune.*1,999.*2026-11-21T10:00:00.000Z.*Confirmed/)
  const events = renderToStaticMarkup(createElement(EventActivity, { events: fixture.events.events }))
  assert.match(events, /Pending publication/)
  assert.match(events, /Published to Kafka/)
  assert.doesNotMatch(events, /indexed|OpenSearch/)
})

test('loading and empty panels do not substitute zero rows or sample data', () => {
  const callbacks = { onFilters() {}, onPage() {}, pageNumber: 1 }
  const loading = renderToStaticMarkup(createElement(InventoryPanel, { ...callbacks, loading: true }))
  assert.match(loading, /command-table-skeleton/)
  const inventory = renderToStaticMarkup(createElement(InventoryPanel, {
    ...callbacks, loading: false, data: { ...fixture.inventory, inventory: [], page: { limit: 50, nextCursor: null } },
  }))
  assert.match(inventory, /No inventory records/)
  assert.match(renderToStaticMarkup(createElement(RecentOrders, { orders: [] })), /No recent orders/)
  assert.match(renderToStaticMarkup(createElement(EventActivity, { events: [] })), /No outbox events/)
})

test('admin errors distinguish authentication, denial, disabled mode, unavailable DB and expired cursors', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', ok)
  for (const [status, code, expected, clear] of [
    [401, 'UNAUTHENTICATED', /authentication is required/, true],
    [403, 'FORBIDDEN', /access was denied/, true],
    [503, 'ADMIN_DISABLED', /monitoring is disabled/, true],
    [503, 'DATABASE_UNAVAILABLE', /PostgreSQL is temporarily unavailable/, false],
    [400, 'INVALID_CURSOR', /page expired/, false],
  ]) {
    fetch.mock.mockImplementation(async (url) => {
      if (url.includes('/inventory?')) return Response.json({ success: false, error: { code, message: 'Error' } }, { status })
      return ok(url)
    })
    await assert.rejects(loadAdminSnapshot({ limit: 50 }, signal),
      (error) => error.status === status && expected.test(adminErrorMessage(error)) && clearsAdminData(error) === clear)
  }
})

test('network and malformed responses fail safely and a subsequent retry can recover', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Offline') })
  await assert.rejects(loadAdminSnapshot({ limit: 50 }, signal), { code: 'NETWORK_ERROR' })
  fetch.mock.mockImplementation(async () => Response.json({}))
  await assert.rejects(loadAdminSnapshot({ limit: 50 }, signal), { code: 'INVALID_ADMIN_RESPONSE' })
  fetch.mock.mockImplementation(async (url) => ok(url))
  assert.deepEqual(await loadAdminSnapshot({ limit: 50 }, signal), fixture)
})

test('only loopback browser and backend addresses are eligible for local-demo requests', () => {
  const local = new URL('http://localhost:5173/#/admin')
  assert(isLocalAdminConfiguration(local, 'http://127.0.0.1:3000'))
  assert(!isLocalAdminConfiguration(local, 'https://example.com'))
  assert(!isLocalAdminConfiguration(local, 'http://user:password@127.0.0.1:3000'))
  assert(!isLocalAdminConfiguration(new URL('https://shelf.example'), 'http://127.0.0.1:3000'))
})

test('polling skips in-flight work, refreshes at five seconds and discards responses from stopped requests', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const events = []
  const loads = []
  const polling = startAdminRefresh((signal) => new Promise((resolve) => loads.push({ resolve, signal })),
    (event) => events.push(event))
  assert.equal(loads.length, 1)
  await polling.refresh()
  t.mock.timers.tick(5_000)
  assert.equal(loads.length, 1)
  loads[0].resolve('first')
  await Promise.resolve()
  assert.equal(events.at(-1).data, 'first')
  t.mock.timers.tick(4_999)
  assert.equal(loads.length, 1)
  t.mock.timers.tick(1)
  assert.equal(loads.length, 2)
  polling.stop()
  assert(loads[1].signal.aborted)
  loads[1].resolve('stale')
  await Promise.resolve()
  t.mock.timers.tick(5_000)
  assert.equal(loads.length, 2)
  assert(!events.some((event) => event.data === 'stale'))
})
