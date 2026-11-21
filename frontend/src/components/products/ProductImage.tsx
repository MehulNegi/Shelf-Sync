import { Laptop, Package, Shirt, ShoppingBasket, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { baseUrl, isMockMode } from '../../services/backend'
import { productImageCandidates } from '../../services/product-images'
import type { Product } from '../../types/products'

const categoryIcons = new Map<string, LucideIcon>([
  ['electronics', Laptop], ['apparel', Shirt], ['groceries', ShoppingBasket],
])

export function ProductImage({ product, lazy = false }: { product: Product; lazy?: boolean }) {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const candidates = productImageCandidates(product, isMockMode ? undefined : baseUrl, origin)
  const PlaceholderIcon = categoryIcons.get(product.category) ?? Package
  const [failedImages, setFailedImages] = useState<string[]>([])
  const image = candidates.find((url) => !failedImages.includes(url))
  return (
    <span className={`product-image ${product.category}`}>
      {image
        ? <img key={image} src={image} alt={product.name} width="300" height="300" decoding="async" loading={lazy ? 'lazy' : undefined}
            onError={() => setFailedImages((urls) => [...urls, image])} />
        : <span className="image-placeholder" role="img" aria-label={`Image unavailable for ${product.name}`}>
            <span className="placeholder-icon"><PlaceholderIcon size={32} aria-hidden="true" /></span>
            <span>Image unavailable</span>
          </span>}
    </span>
  )
}
