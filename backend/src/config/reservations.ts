import { isIP } from 'node:net';
import type { Config } from './env.js';
import { SetupError } from './env.js';
import { loopbackHostname, normalizeIp } from './admin.js';

export interface ReservationConfig {
  enabled: boolean; ttlSeconds: number; localHttp: boolean; origin: string;
  rateSecret: Buffer; httpsProxyIps: string[];
  gateway?: { audience: string; secret: Buffer };
}
export function loadReservationConfig(runtime: Pick<Config, 'host' | 'nodeEnv' | 'frontendOrigin'>, env: NodeJS.ProcessEnv = process.env): ReservationConfig {
  const boolean = (key: string) => {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key]!)) throw new SetupError(`${key} must be true or false.`);
    return env[key] === 'true';
  };
  const enabled = boolean('RESERVATIONS_ENABLED');
  const ttlSeconds = Number(env.RESERVATION_TTL_SECONDS ?? 30);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 300) throw new SetupError('RESERVATION_TTL_SECONDS must be an integer from 5 to 300.');
  const localHttp = boolean('RESERVATION_ALLOW_LOCAL_HTTP');
  const frontend = new URL(runtime.frontendOrigin);
  if (localHttp && (runtime.nodeEnv === 'production' || !['127.0.0.1', '::1'].includes(runtime.host) || !loopbackHostname(frontend.hostname))) {
    throw new SetupError('Reservation local HTTP requires a non-production loopback binding and frontend origin.');
  }
  const value = env.RESERVATION_RATE_LIMIT_SECRET ?? '';
  const rateSecret = Buffer.from(value, 'base64url');
  if (enabled && (!/^[A-Za-z0-9_-]+$/.test(value) || rateSecret.length < 32 || rateSecret.toString('base64url') !== value)) {
    throw new SetupError('RESERVATION_RATE_LIMIT_SECRET requires at least 32 random bytes encoded as unpadded base64url.');
  }
  if (enabled && !localHttp && frontend.protocol !== 'https:') throw new SetupError('Reservation cookie access requires an HTTPS frontend or explicit loopback-only local HTTP.');
  const cutoff=env.INVENTORY_V1_CUTOFF_AT;
  if ((enabled || cutoff !== undefined) && (!cutoff || !cutoff.endsWith('Z') || !Number.isFinite(Date.parse(cutoff)))) {
    throw new SetupError('Set INVENTORY_V1_CUTOFF_AT to the UTC rollout timestamp shared by API, publisher and consumer before enabling reservations. Stop/drain old writers first.');
  }
  const httpsProxyIps = (env.RESERVATION_HTTPS_PROXY_IPS ?? '').split(',').map(x => normalizeIp(x.trim())).filter(Boolean);
  if (httpsProxyIps.some(ip => !isIP(ip))) throw new SetupError('RESERVATION_HTTPS_PROXY_IPS must list explicit trusted TLS proxy IPs.');
  const signedGateway = boolean('RESERVATION_SIGNED_GATEWAY');
  if (!signedGateway) return { enabled, ttlSeconds, localHttp, origin: runtime.frontendOrigin, rateSecret, httpsProxyIps };
  const rawSecret = env.RESERVATION_GATEWAY_SECRET ?? '';
  const secret = Buffer.from(rawSecret, 'base64url');
  const audience = env.RESERVATION_GATEWAY_AUDIENCE ?? '';
  if (ttlSeconds !== 30) throw new SetupError('Signed reservation gateway requires a 30-second reservation TTL.');
  if (localHttp || httpsProxyIps.length || frontend.protocol !== 'https:' ||
      !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com$/i.test(audience) ||
      new URL(audience).origin !== audience || secret.length < 32 || secret.toString('base64url') !== rawSecret ||
      secret.equals(rateSecret)) {
    throw new SetupError('Signed reservation gateway requires an HTTPS storefront and Render audience, a dedicated base64url secret, and no peer or local HTTP exception.');
  }
  return { enabled, ttlSeconds, localHttp, origin: runtime.frontendOrigin, rateSecret, httpsProxyIps, gateway: { audience, secret } };
}
