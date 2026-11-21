import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { loopbackHostname, loopbackIp, normalizeIp, type EnabledAdminConfig } from '../config/admin.js';
import { ApiError } from './products.js';

export interface AdminPrincipal { scope: string; identity?: {kind:'local-demo'} | {kind:'jwt';issuer:string;subject?:string;roles:string[]} }
export type AdminAuthorizer = (request: FastifyRequest) => Promise<AdminPrincipal>;
export const adminDisabled = () => new ApiError(503, 'ADMIN_DISABLED', 'Admin API is not enabled');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'Admin access required');
const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Admin authentication required');

export function createAdminAuthorizer(config: EnabledAdminConfig, keyResolver?: JWTVerifyGetKey): AdminAuthorizer {
  if (config.mode === 'local-demo') return async request => {
    const peer = request.raw.socket.remoteAddress ?? '';
    let validHost = false;
    try {
      const host = new URL(`http://${request.headers.host ?? ''}`);
      validHost = loopbackHostname(host.hostname) && !host.username && !host.password && !host.search && !host.hash && host.pathname === '/';
    } catch { /* Invalid Host is denied. */ }
    const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].some(header => request.headers[header] !== undefined);
    if (!loopbackIp(peer) || !validHost || forwarded ||
        (request.headers.origin !== undefined && request.headers.origin !== config.frontendOrigin)) throw forbidden();
    return { scope: 'local-demo', identity:{kind:'local-demo'} };
  };
  const keys = keyResolver ?? createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30000 });
  return async request => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) throw unauthenticated();
    let identity: { issuer: string; subject: string; roles: string[] };
    let verifiedSubject: string | undefined;
    try {
      const { payload } = await jwtVerify(header.slice(7), keys, {
        algorithms: config.algorithms, issuer: config.issuer, audience: config.audience,
        requiredClaims: ['exp']
      });
      const now = Date.now() / 1000;
      if (!Number.isFinite(payload.exp) || payload.exp! - now > 900 ||
          (payload.sub !== undefined && (typeof payload.sub !== 'string' || !payload.sub)) ||
          (payload.iat !== undefined && (!Number.isFinite(payload.iat) || payload.iat > now || payload.exp! <= payload.iat || payload.exp! - payload.iat > 900))) throw unauthenticated();
      const roles = Array.isArray(payload.roles) && payload.roles.every(role => typeof role === 'string') ? payload.roles as string[] : [];
      // The contract does not require sub/iat. Bind subject-less service tokens
      // to this exact signed credential so they cannot share another token's cursor.
      verifiedSubject=payload.sub;
      const subject = payload.sub ?? `token:${createHash('sha256').update(header.slice(7)).digest('hex')}`;
      identity = { issuer: payload.iss!, subject, roles };
    } catch { throw unauthenticated(); }
    if (!identity.roles.includes('inventory_admin')) throw forbidden();
    const peer = normalizeIp(request.raw.socket.remoteAddress ?? '');
    const tls = (request.raw.socket as typeof request.raw.socket & { encrypted?: boolean }).encrypted === true;
    const trustedTlsProxy = config.httpsProxyIps.includes(peer) && request.headers['x-forwarded-proto'] === 'https';
    if ((!tls && !trustedTlsProxy) || (request.headers.origin !== undefined && request.headers.origin !== config.frontendOrigin)) throw forbidden();
    const scope = createHash('sha256').update(JSON.stringify([identity.issuer, identity.subject, [...new Set(identity.roles)].sort()])).digest('hex');
    return { scope, identity:{kind:'jwt',issuer:identity.issuer,roles:identity.roles,...(verifiedSubject?{subject:verifiedSubject}:{})} };
  };
}
