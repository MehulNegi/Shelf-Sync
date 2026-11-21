import { Check, Laptop, Minus, Package, Plus, Shirt, ShoppingBasket, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { formatPrice } from '../../lib/format-price'
import { baseUrl, isMockMode } from '../../services/backend'
import { productImageCandidates } from '../../services/product-images'
import { cities, type Product } from '../../types/products'
import { Card } from '../ui/card'

const categoryIcons = new Map<string, LucideIcon>([
  ['electronics', Laptop], ['apparel', Shirt], ['groceries', ShoppingBasket],
])

interface ProductCardProps {
  product: Product
  quantity: number
  onAdd: (product: Product) => void
  onDetails?: () => void
  showDescription?: boolean
}

export function ProductCard({ product, quantity, onAdd, onDetails, showDescription }: ProductCardProps) {
  const candidates = productImageCandidates(product, isMockMode ? undefined : baseUrl, window.location.origin)
  const PlaceholderIcon = categoryIcons.get(product.category) ?? Package
  const [failedImages, setFailedImages] = useState<string[]>([])
  const image = candidates.find((url) => !failedImages.includes(url))
  return (
    <Card className="product-card" data-available={product.available}>
      <div className={`product-image ${product.category}`}>
        {image
          ? <img key={image} src={image} alt={product.name} width="300" height="300" decoding="async"
              onError={() => setFailedImages((urls) => [...urls, image])} />
          : <div className="image-placeholder">
              <span className="placeholder-icon"><PlaceholderIcon size={32} aria-hidden="true" /></span>
              <span>Image unavailable</span>
            </div>}
      </div>
      <div className="product-body">
        <p className="product-category capitalize">{product.category}</p>
        <h3>{onDetails ? (
          <button type="button" className="product-link" onClick={onDetails}>{product.name}</button>
        ) : product.name}</h3>
        {showDescription && <p className="product-description">{product.description}</p>}
        <p className="product-price">{formatPrice(product.price)}</p>
        <div className="stock-row">
          <span className={`stock-pill ${product.available ? 'available' : 'unavailable'}`}>
            {product.available ? <Check size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
            {product.available ? 'In stock' : 'Out of stock'}
          </span>
          <span className="stock-quantity">{product.stock} left in {cities[product.city]}</span>
        </div>
        <div className="product-actions">
          <button type="button" className="primary-button" disabled={!product.available || quantity >= product.stock}
            onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
            {product.available && quantity < product.stock && <Plus size={16} aria-hidden="true" />}
            {!product.available ? 'Unavailable' : quantity >= product.stock ? 'Stock limit reached' : 'Add to cart'}
          </button>
          <span role="status">{quantity > 0 && `${quantity} in cart`}</span>
        </div>
      </div>
    </Card>
  )
}
