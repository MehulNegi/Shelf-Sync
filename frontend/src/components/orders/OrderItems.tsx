import { formatPrice } from '../../lib/format-price'
import type { OrderDetails } from '../../types/orders'

export function OrderItems({ items }: Pick<OrderDetails, 'items'>) {
  return (
    <ul className="cart-list" aria-label="Ordered items">
      {items.map((item) => (
        <li key={item.productId} className="order-line">
          <span>{item.name} × {item.quantity}</span>
          <span>{formatPrice(item.unitPrice)} each</span>
        </li>
      ))}
    </ul>
  )
}
