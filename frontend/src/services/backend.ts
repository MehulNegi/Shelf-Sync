import { ApiError } from './api-error'

const configuredUrl: string = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
export const baseUrl = configuredUrl.replace(/\/+$/, '').replace(/\/api$/, '')
export const isMockMode = !configuredUrl

export async function requestJson<T>(path: string, status: number, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api${path}`, { cache: 'no-store', ...init })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'Couldn’t reach the store. Check your connection and try again.')
  }

  if (response.status !== status) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, body?.error?.code ?? 'UNEXPECTED_RESPONSE',
      body?.error?.message ?? `Unexpected response from the store (HTTP ${response.status}).`)
  }

  return response.json()
}
