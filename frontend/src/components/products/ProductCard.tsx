import { Check, Minus } from 'lucide-react'
import { useState } from 'react'
import { productImageUrl } from '../../services/products'
import type { Product } from '../../types/products'
import { Card } from '../ui/card'

const priceFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0,
})

export function ProductCard({ product }: { product: Product }) {
  const imageUrl = productImageUrl(product.imageUrl)
  const [failedImage, setFailedImage] = useState<string>()
  return (
    <Card className="overflow-hidden min-w-0">
      <div className={`product-image ${product.category}`}>
        {failedImage === imageUrl
          ? <span className="image-placeholder">Image unavailable</span>
          : <img src={imageUrl} alt={product.name} width="300" height="300"
              onError={() => setFailedImage(imageUrl)} />}
      </div>
      <div className="product-body">
        <p className="product-category capitalize">{product.category}</p>
        <h3>{product.name}</h3>
        <p className="product-price">{priceFormatter.format(product.price)}</p>
        <div className="stock-row">
          <span className={`stock-pill ${product.available ? 'available' : 'unavailable'}`}>
            {product.available ? <Check size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
            {product.available ? 'In stock' : 'Out of stock'}
          </span>
          <span>{product.stock} left</span>
        </div>
      </div>
    </Card>
  )
}
