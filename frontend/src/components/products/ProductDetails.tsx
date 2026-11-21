import { useCallback, useState } from 'react'
import { useResource } from '../../hooks/use-resource'
import { getProduct } from '../../services/products'
import type { City, Product } from '../../types/products'
import { Dialog } from '../ui/dialog'
import { ProductCard } from './ProductCard'

interface ProductDetailsProps {
  id: string
  city: City
  quantity: number
  onAdd: (product: Product) => void
  onClose: () => void
}

export function ProductDetails({ id, city, quantity, onAdd, onClose }: ProductDetailsProps) {
  const [attempt, setAttempt] = useState(0)
  const load = useCallback((signal: AbortSignal) => getProduct(id, city, signal), [id, city])
  const result = useResource(load, attempt)

  return (
    <Dialog title="Product details" onClose={onClose}>
      {!result ? <p role="status">Loading product details…</p> : 'error' in result ? (
        <>
          <p role="alert">{result.error}</p>
          <button type="button" className="text-button" onClick={() => setAttempt(attempt + 1)}>Try again</button>
        </>
      ) : (
        <ProductCard product={result.data} quantity={quantity} onAdd={onAdd} showDescription />
      )}
    </Dialog>
  )
}
