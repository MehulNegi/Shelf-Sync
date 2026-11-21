import { mockProducts } from '../mocks/products'
import type { ProductQuery, ProductsResponse } from '../types/products'

const baseUrl: string = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

export async function getProducts(query: ProductQuery, signal: AbortSignal): Promise<ProductsResponse> {
  if (!baseUrl) return mockProducts(query)

  const params = new URLSearchParams({ city: query.city })
  for (const key of ['q', 'category', 'minPrice', 'maxPrice'] as const) {
    const value = query[key]
    if (value !== undefined && value !== '') params.set(key, String(value))
  }

  const response = await fetch(`${baseUrl}/api/products?${params}`, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message || `Unable to load products (HTTP ${response.status}).`)
  }
  return response.json()
}

export function productImageUrl(imageUrl: string): string {
  return baseUrl && imageUrl.startsWith('/') && !imageUrl.startsWith('//')
    ? new URL(imageUrl, new URL(baseUrl, window.location.origin)).href
    : imageUrl
}
