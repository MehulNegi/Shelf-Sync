import { randomBytes } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import type { EnabledAdminConfig } from '../../src/config/admin.js';

export async function adminCredentials() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'isolated-test-key', alg: 'ES256' };
  const config: Extract<EnabledAdminConfig, { mode: 'jwt' }> = {
    mode: 'jwt', issuer: 'https://identity.example.test/', audience: 'shelfsync-admin-test', jwksUrl: 'https://identity.example.test/jwks',
    algorithms: ['ES256'], httpsProxyIps: ['127.0.0.1'], frontendOrigin: 'http://localhost:5173', cursorSecret: randomBytes(32)
  };
  const resolver = createLocalJWKSet({ keys: [jwk] });
  async function token(claims: JWTPayload = {}, omit: string[] = []) {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = { iss: config.issuer, aud: config.audience, sub: 'isolated-admin', iat: now, exp: now + 300, roles: ['inventory_admin'], ...claims };
    for (const key of omit) delete payload[key];
    return new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(privateKey);
  }
  const headers = (accessToken: string) => ({ authorization: `Bearer ${accessToken}`, 'x-forwarded-proto': 'https', host: 'localhost:3000', origin: config.frontendOrigin });
  return { config, resolver, token, headers };
}
