import { mockProduct, mockProducts } from '../mocks/products'
import type { City, Product, ProductQuery, ProductsResponse } from '../types/products'
import { isMockMode, requestJson } from './backend'

export async function getProducts(query: ProductQuery, signal: AbortSignal): Promise<ProductsResponse> {
  if (isMockMode) return mockProducts(query)

  const params = new URLSearchParams({ city: query.city })
  for (const key of ['q', 'category', 'minPrice', 'maxPrice'] as const) {
    const value = query[key]
    if (value !== undefined && value !== '') params.set(key, String(value))
  }

  return requestJson<ProductsResponse>(`/products?${params}`, 200, { signal })
}

export async function getProduct(id: string, city: City, signal: AbortSignal): Promise<Product> {
  if (isMockMode) return mockProduct(id, city)
  return requestJson<Product>(`/products/${encodeURIComponent(id)}?${new URLSearchParams({ city })}`,
    200, { signal })
}
