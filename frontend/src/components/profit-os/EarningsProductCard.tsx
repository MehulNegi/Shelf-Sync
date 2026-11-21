import { Check } from 'lucide-react'
import { catalogPricePaise, formatPaise } from '../../lib/profit-os'
import type { Product } from '../../types/products'
import { ProductImage } from '../products/ProductImage'

export function EarningsProductCard({ product, selected, onSelect }: {
  product: Product
  selected: boolean
  onSelect: () => void
}) {
  const price = catalogPricePaise(product.price)
  return (
    <button type="button" className="earnings-product-card" aria-pressed={selected}
      aria-label={product.name} aria-describedby={`earnings-price-${product.id}`} onClick={onSelect}>
      <ProductImage product={product} lazy />
      <span className="earnings-card-copy">
        <strong>{product.name}</strong>
        <span id={`earnings-price-${product.id}`}>{price === null ? 'Price unavailable' : formatPaise(price)}</span>
        <span className="earnings-card-status">
          {selected ? <><Check size={16} aria-hidden="true" /> Selected</> : 'Choose product'}
        </span>
      </span>
    </button>
  )
}
