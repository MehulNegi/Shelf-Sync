import { createHash, createHmac, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'

const limit = 64 * 1024
const requestHeaders = ['origin', 'content-type', 'idempotency-key']
const routes = {
  '/api/cart/session': ['POST'],
  '/api/cart/reservations': ['GET', 'POST', 'PATCH'],
  '/api/cart/reservations/release': ['POST'],
  '/api/orders': ['POST'],
}
const hash = (value) => createHash('sha256').update(value).digest('hex')
const noStore = { 'cache-control': 'no-store', 'cdn-cache-control': 'no-store', 'vercel-cdn-cache-control': 'no-store' }
const failure = (status, code, message) => Response.json({ success: false, error: { code, message } }, { status, headers: noStore })

async function boundedBody(request) {
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks, size)
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
}

export async function forwardReservation(request, env = process.env, send = fetch, route) {
  const url = new URL(request.url)
  const path = route ?? url.pathname
  const upstream = env.RENDER_API_ORIGIN?.trim() ?? ''
  const host = env.RESERVATION_GATEWAY_FRONTEND_ORIGIN ?? ''
  const secret = Buffer.from(env.RESERVATION_GATEWAY_SECRET ?? '', 'base64url')
  if (env.VERCEL !== '1' || env.RESERVATION_GATEWAY_ROUTING !== 'true' || env.RESERVATION_GATEWAY_VERCEL_VERIFIED !== 'true' ||
      !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com\/?$/i.test(upstream) ||
      !/^https:\/\/[a-z0-9.-]+$/i.test(host) ||
      secret.length < 32 || secret.toString('base64url') !== env.RESERVATION_GATEWAY_SECRET) {
    return failure(503, 'RESERVATION_GATEWAY_UNAVAILABLE', 'Cart gateway is unavailable')
  }
  if (!routes[path]?.includes(request.method)) return failure(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')

  // Read edge metadata only inside this Vercel deployment. The operator must verify overwrite behavior in staging.
  const ip = request.headers.get('x-forwarded-for') ?? ''
  const origin = request.headers.get('origin')
  if (url.origin !== host || request.headers.get('host') !== url.host ||
      request.headers.get('x-forwarded-host') !== url.host || request.headers.get('x-forwarded-proto') !== 'https' ||
      !isIP(ip) || request.headers.get('x-vercel-forwarded-for') !== ip ||
      ((request.method !== 'GET' || origin !== null) && origin !== host)) {
    return failure(403, 'CART_ORIGIN_FORBIDDEN', 'Cart request origin is not allowed')
  }

  if (request.headers.has('content-encoding')) return failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Encoded bodies are not supported')
  let body
  try { body = await boundedBody(request) }
  catch { return failure(400, 'BAD_REQUEST', 'Invalid request') }
  if (!body) return failure(413, 'BAD_REQUEST', 'Request body is too large')

  const headers = new Headers()
  for (const name of requestHeaders) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const cartCookies = (request.headers.get('cookie') ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith('__Host-shelfsync_cart='))
  if (cartCookies.length) headers.set('cookie', cartCookies.join('; '))
  const destination = new URL(upstream)
  destination.pathname = path
  destination.search = url.search
  const claims = Buffer.from(JSON.stringify([
    1, Date.now(), randomUUID(), destination.origin, request.method, destination.pathname + destination.search,
    headers.get('origin') ?? '', ip, headers.get('idempotency-key') ?? '', headers.get('content-type') ?? '',
    hash(headers.get('cookie') ?? ''), hash(body),
  ])).toString('base64url')
  headers.set('x-shelfsync-gateway', claims + '.' + createHmac('sha256', secret).update(claims).digest('base64url'))
  try {
    const response = await send(destination, {
      method: request.method, headers, ...(body.length ? { body } : {}), redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status >= 300 && response.status < 400) return failure(502, 'BAD_GATEWAY', 'Unexpected store redirect')
    const out = new Headers(noStore)
    for (const name of ['content-type', 'retry-after']) {
      const value = response.headers.get(name)
      if (value !== null) out.set(name, value)
    }
    for (const cookie of response.headers.getSetCookie()) out.append('set-cookie', cookie)
    return new Response(response.body, { status: response.status, headers: out })
  } catch { return failure(502, 'BAD_GATEWAY', 'Could not reach the store') }
}

export const reservationGateway = (route) => ({
  fetch: (request) => forwardReservation(request, process.env, fetch, route),
})
