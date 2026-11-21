import { Check, Minus, Plus } from 'lucide-react'
import { formatPrice } from '../../lib/format-price'
import type { ReservationDisplay } from '../../services/reservations'
import { ProductImage } from './ProductImage'
import { cities, type Product } from '../../types/products'
import { ReservationCountdown } from '../cart/ReservationCountdown'
import { Card } from '../ui/card'

interface ProductCardProps {
  product: Product
  quantity: number
  onAdd: (product: Product) => void
  onDetails?: () => void
  showDescription?: boolean
  reservationMode?: boolean
  reservationPending?: boolean
  reservation?: ReservationDisplay
  addDisabled?: boolean
}

export function ProductCard({ product, quantity, onAdd, onDetails, showDescription, reservationMode, reservationPending, reservation, addDisabled }: ProductCardProps) {
  const atLimit = reservationMode ? quantity >= 99 : quantity >= product.stock
  const canAdd = product.available && !atLimit && !addDisabled
  return (
    <Card className="product-card" data-available={product.available}>
      <ProductImage product={product} />
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
        {reservation?.status === 'active' && <ReservationCountdown seconds={reservation.seconds} />}
        {reservation?.status === 'expired' && <p className="reservation-expired">Reservation expired</p>}
        <div className="product-actions">
          <button type="button" className="primary-button" disabled={!canAdd}
            onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
            {canAdd && <Plus size={16} aria-hidden="true" />}
            {reservationPending ? 'Reserving…' : !product.available ? 'Unavailable' : atLimit ? 'Stock limit reached' : 'Add to cart'}
          </button>
          <span role="status">{quantity > 0 && `${quantity} in cart`}</span>
        </div>
      </div>
    </Card>
  )
}
