import { useEffect, useState } from 'react'
import { getProducts } from '../services/products'
import type { ProductQuery, ProductsResponse } from '../types/products'

type Result = { data: ProductsResponse } | { error: string }

export function useProducts(query: ProductQuery, attempt: number): Result | undefined {
  const [settled, setSettled] = useState<{ query: ProductQuery; attempt: number; result: Result }>()
  useEffect(() => {
    const controller = new AbortController()
    function settle(result: Result) {
      if (!controller.signal.aborted) setSettled({ query, attempt, result })
    }

    getProducts(query, controller.signal).then(
      (data) => settle({ data }),
      (error: unknown) => settle({
        error: error instanceof Error ? error.message : 'Unable to load products.',
      }),
    )
    return () => controller.abort()
  }, [query, attempt])

  if (settled?.query === query && settled.attempt === attempt) return settled.result
}
