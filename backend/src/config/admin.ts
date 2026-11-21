import { isIP } from 'node:net';
import type { Config } from './env.js';

export type EnabledAdminConfig = {
  mode: 'jwt'; issuer: string; audience: string; jwksUrl: string; algorithms: ('RS256' | 'ES256')[];
  httpsProxyIps: string[]; cursorSecret: Buffer; frontendOrigin: string;
} | {
  mode: 'local-demo'; cursorSecret: Buffer; frontendOrigin: string;
};
export type AdminConfig = EnabledAdminConfig | { mode: 'disabled'; setupIssue?: string };

export function normalizeIp(ip: string) { return ip.startsWith('::ffff:') ? ip.slice(7) : ip; }
export function loopbackIp(ip: string) {
  const value = normalizeIp(ip.toLowerCase());
  return value === '::1' || (isIP(value) === 4 && value.startsWith('127.'));
}
export function loopbackHostname(host: string) {
  return host === 'localhost' || loopbackIp(host.replace(/^\[|\]$/g, ''));
}
function httpsUrl(value: string | undefined): value is string {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}

// Incomplete admin configuration disables only admin data, not the storefront.
export function loadAdminConfig(runtime: Pick<Config, 'host' | 'frontendOrigin' | 'nodeEnv'>, env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const disabled = (setupIssue: string): AdminConfig => ({ mode: 'disabled', setupIssue });
  const mode = env.ADMIN_AUTH_MODE ?? 'disabled';
  if (mode === 'disabled') return { mode };
  if (mode !== 'jwt' && mode !== 'local-demo') return disabled('ADMIN_AUTH_MODE must be disabled, jwt, or local-demo.');
  const secret = env.ADMIN_CURSOR_SECRET ?? '';
  const cursorSecret = Buffer.from(secret, 'base64url');
  if (!/^[A-Za-z0-9_-]+$/.test(secret) || cursorSecret.length < 32 || cursorSecret.toString('base64url') !== secret) {
    return disabled('ADMIN_CURSOR_SECRET must be at least 32 random bytes encoded as unpadded base64url.');
  }
  const frontend = new URL(runtime.frontendOrigin);
  if (mode === 'local-demo') {
    if (runtime.nodeEnv === 'production' || !['127.0.0.1', '::1'].includes(runtime.host) || !loopbackHostname(frontend.hostname)) {
      return disabled('Local admin demo requires non-production NODE_ENV, HOST=127.0.0.1 or ::1, and a loopback FRONTEND_ORIGIN.');
    }
    return { mode, cursorSecret, frontendOrigin: runtime.frontendOrigin };
  }
  if (!httpsUrl(env.ADMIN_JWT_ISSUER) || !httpsUrl(env.ADMIN_JWT_JWKS_URL) || !env.ADMIN_JWT_AUDIENCE?.trim()) {
    return disabled('JWT admin access requires HTTPS ADMIN_JWT_ISSUER, HTTPS ADMIN_JWT_JWKS_URL, and ADMIN_JWT_AUDIENCE.');
  }
  if (frontend.protocol !== 'https:' && (runtime.nodeEnv === 'production' || !loopbackHostname(frontend.hostname))) {
    return disabled('JWT admin access requires an HTTPS frontend origin, except for loopback development.');
  }
  const algorithms = (env.ADMIN_JWT_ALGORITHMS ?? 'RS256').split(',').map(value => value.trim());
  if (!algorithms.length || algorithms.some(value => !['RS256', 'ES256'].includes(value))) return disabled('ADMIN_JWT_ALGORITHMS may contain only RS256 and ES256.');
  const httpsProxyIps = (env.ADMIN_HTTPS_PROXY_IPS ?? '').split(',').map(value => value.trim()).filter(Boolean).map(normalizeIp);
  if (httpsProxyIps.some(value => !isIP(value))) return disabled('ADMIN_HTTPS_PROXY_IPS must contain explicit trusted proxy IP addresses.');
  return {
    mode, cursorSecret, frontendOrigin: runtime.frontendOrigin,
    issuer: env.ADMIN_JWT_ISSUER, jwksUrl: env.ADMIN_JWT_JWKS_URL, audience: env.ADMIN_JWT_AUDIENCE,
    algorithms: algorithms as ('RS256' | 'ES256')[], httpsProxyIps
  };
}
