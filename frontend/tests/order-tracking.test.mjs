import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.VITE_API_BASE_URL = 'https://store.example/api'
const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const { getOrderTracking } = await vite.ssrLoadModule('/src/services/tracking-api.ts')
const { formatOrderDate, orderTracking, sortOrderIds } = await vite.ssrLoadModule('/src/services/order-tracking.ts')
const { OrderTracking } = await vite.ssrLoadModule('/src/components/orders/OrderTracking.tsx')
after(() => vite.close())

const createdAt = '2026-11-21T02:30:00.000Z'
const confirmedAt = '2026-11-21T02:30:01.000Z'
const orderId = 'ord_001'
const signal = new AbortController().signal
const tracking = {
  orderId, status: 'confirmed', createdAt,
  history: [{ status: 'confirmed', occurredAt: confirmedAt, recordedAt: confirmedAt, source: 'order_created' }],
}

test('tracking reads creation time and the confirmed occurrence from the dedicated endpoint', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://store.example/api/orders/ord_001/tracking')
    assert.equal(options.signal, signal)
    assert.equal(options.method, undefined)
    return Response.json(tracking)
  })
  const data = await getOrderTracking(orderId, signal)
  assert.equal(data.createdAt, createdAt)
  const timeline = orderTracking(data.status, data.history)
  assert.deepEqual(timeline.map((stage) => stage.state), ['current', 'pending', 'pending', 'pending'])
  assert.deepEqual(timeline.map((stage) => stage.occurredAt), [confirmedAt, null, null, null])
})

test('multiple persisted observations retain known times without inferring missing progress', () => {
  const events = [
    { status: 'pending', occurredAt: createdAt, recordedAt: createdAt, source: 'order_created' },
    ...tracking.history,
    { status: 'confirmed', occurredAt: null, recordedAt: '2026-11-21T13:00:00.000Z', source: 'legacy_snapshot' },
    { status: 'cancelled', occurredAt: null, recordedAt: '2026-11-21T13:00:00.000Z', source: 'legacy_snapshot' },
  ]
  const result = orderTracking('cancelled', events)
  assert.deepEqual(result.map((stage) => stage.state), ['completed', 'pending', 'pending', 'pending'])
  assert.equal(result[0].occurredAt, confirmedAt)
  assert.equal(orderTracking('confirmed', [events[2]])[0].occurredAt, null)
  assert.equal(orderTracking('confirmed', [])[0].occurredAt, null)
  assert.equal(orderTracking('cancelled', [events[3]])[0].state, 'pending')
})

test('saved orders sort by creation time with stable local ordering for missing or equal dates', () => {
  const saved = ['older', 'undated-new', 'newer', 'newer-tie', 'undated-old']
  const dates = new Map([
    ['older', createdAt], ['newer', confirmedAt], ['newer-tie', confirmedAt],
  ])
  assert.deepEqual(sortOrderIds(saved, dates), ['newer', 'newer-tie', 'older', 'undated-new', 'undated-old'])
  assert.deepEqual(sortOrderIds(saved, new Map()), saved)
})

test('purchase times use the local timezone across midnight', () => {
  const previous = process.env.TZ
  try {
    const dates = ['America/Los_Angeles', 'Asia/Kolkata'].map((zone) => {
      process.env.TZ = zone
      const output = formatOrderDate(createdAt)
      const explicitZone = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium', timeStyle: 'short', timeZone: zone,
      }).format(new Date(createdAt))
      assert.equal(output, explicitZone)
      return output
    })
    assert.notEqual(dates[0], dates[1])
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('missing tracking is recoverable and malformed payloads including mismatched IDs are rejected', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 404 }))
  assert.equal(await getOrderTracking(orderId, signal), null)
  for (const value of [
    null, {}, { ...tracking, orderId: 'ord_other' }, { ...tracking, createdAt: 'yesterday' },
    { ...tracking, createdAt: '2026-02-30T00:00:00.000Z' },
    { ...tracking, status: 'in_transit' }, { ...tracking, history: [{}] },
    { ...tracking, history: [{ ...tracking.history[0], occurredAt: 'invalid' }] },
  ]) {
    fetch.mock.mockImplementation(async () => Response.json(value))
    await assert.rejects(getOrderTracking(orderId, signal), { code: 'INVALID_TRACKING' })
  }
  fetch.mock.mockImplementation(async () => new Response('bad JSON'))
  await assert.rejects(getOrderTracking(orderId, signal), { code: 'INVALID_TRACKING' })
})

test('tracking failure can be retried without resubmitting checkout', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    success: false, error: { code: 'INTERNAL_ERROR', message: 'Server unavailable' },
  }, { status: 500 }))
  await assert.rejects(getOrderTracking(orderId, signal), { status: 500 })
  fetch.mock.mockImplementation(async () => Response.json(tracking))
  assert.deepEqual(await getOrderTracking(orderId, signal), tracking)
  assert.equal(fetch.mock.callCount(), 2)
})


test('demo milestones stay pending and use local calendar dates across a daylight-saving change', () => {
  const previous = process.env.TZ
  process.env.TZ = 'America/Los_Angeles'
  try {
    const purchase = '2026-03-08T02:00:00.000Z' // March 7 in Los Angeles
    const stages = orderTracking('confirmed', tracking.history, purchase)
    assert.deepEqual(stages.map(({ state }) => state), ['current', 'pending', 'pending', 'pending'])
    const dates = [null, '2026-03-08T16:00:00.000Z', '2026-03-09T21:30:00.000Z', '2026-03-12T01:00:00.000Z']
    assert.deepEqual(stages.map(({ demoEstimate }) => demoEstimate), dates)
    assert.equal(stages[0].occurredAt, confirmedAt)
    const html = renderToStaticMarkup(createElement(OrderTracking, {
      status: 'confirmed', history: tracking.history, createdAt: purchase,
    }))
    assert.equal([...html.matchAll(/Demo estimate:/g)].length, 3)
    assert.equal([...html.matchAll(/data-state="pending"/g)].length, 3)
    for (const date of dates.slice(1)) {
      assert(html.includes(date))
      assert(html.includes(formatOrderDate(date)))
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('persisted fulfillment data overrides a demo estimate, including an unknown occurrence time', async (t) => {
  const actual = '2026-11-23T18:21:00.000Z'
  const persisted = {
    ...tracking,
    status: 'shipped',
    history: [
      ...tracking.history,
      { status: 'processing', occurredAt: null, recordedAt: actual, source: 'legacy_snapshot' },
      { status: 'shipped', occurredAt: actual, recordedAt: actual, source: 'fulfillment_update' },
    ],
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json(persisted))
  const response = await getOrderTracking(orderId, signal)
  const stages = orderTracking(response.status, response.history, response.createdAt)
  assert.deepEqual(stages.map(({ state }) => state), ['completed', 'completed', 'current', 'pending'])
  assert.equal(stages[1].demoEstimate, null)
  assert.equal(stages[2].demoEstimate, null)
  assert.equal(stages[2].occurredAt, actual)
  assert(stages[3].demoEstimate)
  const html = renderToStaticMarkup(createElement(OrderTracking, persisted))
  assert.match(html, /Time unavailable/)
  assert.match(html, new RegExp(actual))
  assert.equal([...html.matchAll(/Demo estimate:/g)].length, 1)
})

test('missing or invalid purchase dates and cancelled orders produce no demo estimates', () => {
  for (const value of [undefined, '', 'yesterday', '2026-02-30T00:00:00.000Z']) {
    assert(orderTracking('confirmed', tracking.history, value).every((stage) => stage.demoEstimate === null))
  }
  assert(orderTracking('cancelled', tracking.history, createdAt).every((stage) => stage.demoEstimate === null))
  assert.doesNotMatch(renderToStaticMarkup(createElement(OrderTracking, { status: 'confirmed' })), /Demo estimate/)
})
