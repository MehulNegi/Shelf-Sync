const apiPath = '/api/:path*'

export function vercelConfig(env) {
  const upstream = env.RENDER_API_ORIGIN?.trim()
  const browserBase = env.VITE_API_BASE_URL?.trim()
  if (!upstream && !browserBase) return { framework: 'vite', outputDirectory: 'dist' }
  if (!upstream || browserBase !== '/api') {
    throw new Error('Configure both RENDER_API_ORIGIN and VITE_API_BASE_URL=/api for a live deployment.')
  }

  // Restrict the build-time destination to an HTTPS Render web service origin.
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com\/?$/i.test(upstream)) {
    throw new Error('RENDER_API_ORIGIN must be an HTTPS onrender.com origin with no path, port, or credentials.')
  }

  return {
    framework: 'vite',
    outputDirectory: 'dist',
    rewrites: [{ source: apiPath, destination: `${new URL(upstream).origin}${apiPath}` }],
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
