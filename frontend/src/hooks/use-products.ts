import { useCallback } from 'react'
import { getProducts } from '../services/products'
import type { ProductQuery } from '../types/products'
import { useResource } from './use-resource'

export function useProducts(query: ProductQuery, attempt: number) {
  const load = useCallback((signal: AbortSignal) => getProducts(query, signal), [query])
  return useResource(load, attempt)
}
