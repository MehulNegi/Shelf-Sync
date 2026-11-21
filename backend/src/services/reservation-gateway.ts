import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { FastifyRequest, preParsingAsyncHookHandler } from 'fastify';
import { normalizeIp } from '../config/admin.js';
import type { CartApi } from '../routes/cart.js';
import { ApiError } from './products.js';

const maxAge = 10_000;
const maxFuture = 2_000;
const maxBody = 64 * 1024;
const verifiedIps = new WeakMap<FastifyRequest, string>();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const denied = () => new ApiError(403, 'CART_ORIGIN_FORBIDDEN', 'Cart request origin is not allowed');

export function gatewayClientIp(request: FastifyRequest) {
  const ip = verifiedIps.get(request);
  if (!ip) throw denied();
  return ip;
}

export function reservationGatewayHook(cart?: CartApi): preParsingAsyncHookHandler {
  return async (request, reply, payload) => {
    const gateway = cart?.config.gateway;
    if (!gateway) return payload;
    reply.header('Cache-Control', 'no-store');
    const header = request.headers['x-shelfsync-gateway'];
    if (typeof header !== 'string' || header.length > 8192 || !/^[\w-]+\.[\w-]{43}$/.test(header)) throw denied();
    const [encoded, signature] = header.split('.') as [string, string];
    const expected = createHmac('sha256', gateway.secret).update(encoded).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || supplied.toString('base64url') !== signature || !timingSafeEqual(expected, supplied)) throw denied();

    let claims: unknown;
    try { claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
    catch { throw denied(); }
    if (!Array.isArray(claims) || claims.length !== 12) throw denied();
    const [version, issuedAt, nonce, audience, method, target, origin, ip, key, contentType, cookieHash, bodyHash] = claims;
    const now = Date.now();
    if (version !== 1 || !Number.isSafeInteger(issuedAt) || now - issuedAt > maxAge || issuedAt - now > maxFuture ||
        typeof nonce !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(nonce) ||
        audience !== gateway.audience || method !== request.method || target !== request.raw.url ||
        typeof ip !== 'string' || !isIP(ip) || origin !== (request.headers.origin ?? '') ||
        ((method !== 'GET' || origin !== '') && origin !== cart.config.origin) ||
        key !== (request.headers['idempotency-key'] ?? '') || contentType !== (request.headers['content-type'] ?? '') ||
        cookieHash !== hash(request.headers.cookie ?? '') || request.headers['content-encoding'] !== undefined) throw denied();

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBody) throw new ApiError(413, 'BAD_REQUEST', 'Request body is too large');
      chunks.push(bytes);
    }
    const body = Buffer.concat(chunks, size);
    if (hash(body) !== bodyHash || Date.now() - issuedAt > maxAge) throw denied();

    // Session issuance and legacy checkout lack operation idempotency. Consume every assertion once across replicas.
    const fresh = await cart.repository.consumeGatewayNonce(Buffer.from(hash(nonce), 'hex'));
    if (!fresh) throw denied();
    verifiedIps.set(request, normalizeIp(ip));
    return Object.assign(Readable.from([body]), { receivedEncodedLength: size });
  };
}
