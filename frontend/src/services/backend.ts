import { ApiError } from './api-error'

const configuredUrl: string = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
export const baseUrl = configuredUrl.replace(/\/+$/, '').replace(/\/api$/, '')
export const isMockMode = !configuredUrl

export async function requestJson<T>(path: string, status: number | readonly number[], init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api${path}`, { cache: 'no-store', ...init })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'Couldn’t reach the store. Check your connection and try again.')
  }

  if (typeof status === 'number' ? response.status !== status : !status.includes(response.status)) {
    const body = await response.json().catch(() => null)
    const retryAfter = response.headers.get('Retry-After')
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined
    throw new ApiError(response.status, body?.error?.code ?? 'UNEXPECTED_RESPONSE',
      body?.error?.message ?? `Unexpected response from the store (HTTP ${response.status}).`,
      seconds && Number.isSafeInteger(seconds) ? seconds : undefined)
  }

  return response.json()
}
