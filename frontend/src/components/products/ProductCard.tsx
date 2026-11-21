import { Check, ImageOff, Minus } from 'lucide-react'
import { useState } from 'react'
import { formatPrice } from '../../lib/format-price'
import { productImageUrl } from '../../services/products'
import type { Product } from '../../types/products'
import { Card } from '../ui/card'

interface ProductCardProps {
  product: Product
  quantity: number
  onAdd: (product: Product) => void
  onDetails?: () => void
  showDescription?: boolean
}

export function ProductCard({ product, quantity, onAdd, onDetails, showDescription }: ProductCardProps) {
  const imageUrl = productImageUrl(product.imageUrl)
  const localImage = product.imageUrl === '/images/speaker.jpg' ? '/images/speaker.webp' : product.imageUrl
  const [failedImages, setFailedImages] = useState<string[]>([])
  const image = (localImage.startsWith('/images/') ? [imageUrl, localImage] : [imageUrl]).find((url) => !failedImages.includes(url))
  return (
    <Card className="overflow-hidden min-w-0">
      <div className={`product-image ${product.category}`}>
        {image
          ? <img key={image} src={image} alt={product.name} width="300" height="300"
              onError={() => setFailedImages((urls) => [...urls, image])} />
          : <span className="image-placeholder"><ImageOff size={24} aria-hidden="true" /> Image unavailable</span>}
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
          <span>{product.stock} left</span>
        </div>
        <div className="product-actions">
          <button type="button" className="primary-button" disabled={!product.available || quantity >= product.stock}
            onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
            {product.available && quantity >= product.stock ? 'Stock limit reached' : 'Add to cart'}
          </button>
          <span role="status">{quantity > 0 && `${quantity} in cart`}</span>
        </div>
      </div>
    </Card>
  )
}
