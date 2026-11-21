import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import type { ReservationConfig } from '../config/reservations.js';
import { loopbackIp, loopbackHostname, normalizeIp } from '../config/admin.js';
import { gatewayClientIp } from './reservation-gateway.js';
import { ApiError } from './products.js';

export const cartSessionRequired = () => new ApiError(401, 'CART_SESSION_REQUIRED', 'A valid cart session is required');
export const cookieName = (config: ReservationConfig) => config.localHttp ? 'shelfsync_cart_dev' : '__Host-shelfsync_cart';
export function cartTransport(request: FastifyRequest, config: ReservationConfig, mutation: boolean) {
  const denied = () => new ApiError(403, 'CART_ORIGIN_FORBIDDEN', 'Cart request origin is not allowed');
  const peer = normalizeIp(request.raw.socket.remoteAddress ?? '');
  const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].some(h => request.headers[h] !== undefined);
  if (config.gateway) {
    gatewayClientIp(request);
  } else if (config.localHttp) {
    let host: URL;
    try { host = new URL(`http://${request.headers.host ?? ''}`); } catch { throw denied(); }
    if (!loopbackIp(peer) || !loopbackHostname(host.hostname) || host.username || host.password || host.pathname !== '/' || host.search || host.hash || forwarded) throw denied();
  } else {
    const tls = (request.raw.socket as typeof request.raw.socket & { encrypted?: boolean }).encrypted;
    if (!tls && !(config.httpsProxyIps.includes(peer) && request.headers['x-forwarded-proto'] === 'https')) throw denied();
  }
  if ((mutation || request.headers.origin !== undefined) && request.headers.origin !== config.origin) throw denied();
  if (mutation && !/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  // Only a configured proxy can provide one overwritten source IP, not a chain.
  const source = config.gateway ? gatewayClientIp(request) : !config.localHttp && config.httpsProxyIps.includes(peer) && typeof request.headers['x-forwarded-for'] === 'string'
    && isIP(request.headers['x-forwarded-for']) ? normalizeIp(request.headers['x-forwarded-for']) : peer;
  return createHmac('sha256', config.rateSecret).update(source).digest();
}
export function cartCredential(request: FastifyRequest, config: ReservationConfig): Buffer | undefined {
  const parts = (request.headers.cookie ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith(cookieName(config) + '='));
  if (parts.length !== 1) return undefined;
  const value = parts[0]!.slice(cookieName(config).length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) return undefined;
  return createHash('sha256').update(value).digest();
}
