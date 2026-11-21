import { SetupError } from './env.js';

// This initial Render rollout deliberately exposes only the storefront APIs.
// RENDER is supplied by the platform, not an HTTP header or a source of identity.
export function validateRenderEnvironment(service: 'api' | 'worker', env: NodeJS.ProcessEnv = process.env): void {
  if (env.RENDER !== 'true') return;
  if (env.NODE_ENV !== 'production') throw new SetupError('Render requires NODE_ENV=production. Local-demo modes must not run on public infrastructure.');
  if ((env.ADMIN_AUTH_MODE ?? 'disabled') !== 'disabled') throw new SetupError('The initial Render deployment requires ADMIN_AUTH_MODE=disabled. Configure and review a trusted identity provider before enabling public admin access.');
  for (const key of ['PROFITABILITY_ENABLED', 'PROFITABILITY_DEMO_WRITES_ENABLED', 'RESERVATION_ALLOW_LOCAL_HTTP']) {
    if (env[key] !== undefined && env[key] !== 'false') throw new SetupError(`Render requires ${key}=false.`);
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new SetupError('Render requires verified TLS; remove NODE_TLS_REJECT_UNAUTHORIZED=0.');
  if (service !== 'api') return;
  if ((env.HOST ?? '0.0.0.0') !== '0.0.0.0') throw new SetupError('Render web services require HOST=0.0.0.0.');
  try {
    const origin = new URL(env.FRONTEND_ORIGIN ?? '');
    if (origin.protocol !== 'https:' || origin.origin !== env.FRONTEND_ORIGIN) throw new Error();
  } catch { throw new SetupError('Render requires FRONTEND_ORIGIN set to one exact HTTPS frontend origin, without a trailing slash.'); }
  if (env.RESERVATIONS_ENABLED === 'true') {
    if (env.RESERVATION_BROWSER_API_ORIGIN !== env.FRONTEND_ORIGIN) {
      throw new SetupError('Render reservations require a verified same-origin HTTPS /api proxy. Set RESERVATION_BROWSER_API_ORIGIN to FRONTEND_ORIGIN only after configuring it. Direct vercel.app to onrender.com cookies are cross-site; see docs/render-deployment.md.');
    }
    if (!env.RESERVATION_HTTPS_PROXY_IPS?.trim()) throw new SetupError('Render reservations require verified explicit RESERVATION_HTTPS_PROXY_IPS. Do not trust arbitrary forwarded headers; see docs/render-deployment.md.');
  }
}
