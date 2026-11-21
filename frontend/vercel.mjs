const apiPath = '/api/:path*'
const git = { deploymentEnabled: { 'feature/b14-reservation-gateway': false, 'fix/vercel-reservation-discovery': false } }

export function vercelConfig(env) {
  const upstream = env.RENDER_API_ORIGIN?.trim()
  const browserBase = env.VITE_API_BASE_URL?.trim()
  if (env.VITE_CART_RESERVATIONS === 'true' && (env.RESERVATION_GATEWAY_ROUTING !== 'true' || browserBase !== '/api')) {
    throw new Error('Enable signed gateway routing before enabling reservations in a Vercel build.')
  }
  if (env.VITE_CART_RESERVATIONS === 'true' && env.RESERVATION_GATEWAY_VERCEL_VERIFIED !== 'true') {
    throw new Error('Verify the deployed Vercel gateway metadata before enabling the reservation UI.')
  }
  if (!upstream && !browserBase) return { framework: 'vite', outputDirectory: 'dist', git }
  if (!upstream || browserBase !== '/api') {
    throw new Error('Configure both RENDER_API_ORIGIN and VITE_API_BASE_URL=/api for a live deployment.')
  }

  // Restrict the build-time destination to an HTTPS Render web service origin.
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com\/?$/i.test(upstream)) {
    throw new Error('RENDER_API_ORIGIN must be an HTTPS onrender.com origin with no path, port, or credentials.')
  }

  const signed = env.RESERVATION_GATEWAY_ROUTING === 'true'
  const protectedRoutes = signed ? [
    { source: '/api/cart/session', destination: '/api/reservation-gateway/session' },
    { source: '/api/cart/reservations', destination: '/api/reservation-gateway/reservations' },
    { source: '/api/cart/reservations/release', destination: '/api/reservation-gateway/release' },
    { source: '/api/orders', destination: '/api/reservation-gateway/orders' },
  ] : []
  const source = signed ? '/api/:path((?!cart(?:/|$)|orders/?$|reservation-gateway(?:/|$)|_reservation(?:/|$)).*)' : apiPath
  return {
    framework: 'vite',
    git,
    outputDirectory: 'dist',
    rewrites: [...protectedRoutes, { source, destination: `${new URL(upstream).origin}${apiPath}` }],
    headers: [{
      source: apiPath,
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'CDN-Cache-Control', value: 'no-store' },
        { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
      ],
    }],
  }
}

export const config = vercelConfig(process.env)
