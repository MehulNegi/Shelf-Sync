import type { OrderItem } from '../types/orders'
import { cities, type City } from '../types/products'

export interface CartState {
  city: City
  itemsByCity: Record<City, OrderItem[]>
}

type CartAction =
  | { type: 'selectCity'; city: City }
  | { type: 'adjust'; city: City; productId: string; delta: number; stock: number }
  | { type: 'remove'; city: City; productId: string }
  | { type: 'clear'; city: City }

function emptyCart(): CartState {
  return { city: 'pune', itemsByCity: { pune: [], delhi: [], bengaluru: [] } }
}

export function loadCart(storage: Pick<Storage, 'getItem'>, key: string): CartState {
  const cart = emptyCart()
  try {
    const saved = JSON.parse(storage.getItem(key) ?? 'null')
    if (saved && Object.hasOwn(cities, saved.city)) cart.city = saved.city

    for (const city of Object.keys(cities) as City[]) {
      const items = saved?.itemsByCity?.[city]
      if (!Array.isArray(items)) continue
      const seen = new Set<string>()
      for (const item of items) {
        if (typeof item?.productId !== 'string' || !item.productId || seen.has(item.productId) ||
            !Number.isSafeInteger(item?.quantity) || item.quantity < 1) continue
        seen.add(item.productId)
        cart.itemsByCity[city].push({ productId: item.productId, quantity: item.quantity })
      }
    }
  } catch {
    // Storage can be blocked or contain invalid JSON.
  }
  return cart
}

export function saveCart(storage: Pick<Storage, 'setItem'>, key: string, cart: CartState) {
  try {
    storage.setItem(key, JSON.stringify(cart))
  } catch {
    // The in-memory cart remains usable when storage is unavailable.
  }
}

export function cartReducer(cart: CartState, action: CartAction): CartState {
  const { city } = action
  if (action.type === 'selectCity') return { ...cart, city }

  const previous = cart.itemsByCity[city]
  let items: OrderItem[]
  if (action.type === 'clear') {
    items = []
  } else if (action.type === 'remove') {
    items = previous.filter((item) => item.productId !== action.productId)
  } else {
    if (city !== cart.city) return cart
    const existing = previous.find((item) => item.productId === action.productId)
    const quantity = (existing?.quantity ?? 0) + action.delta
    if (!Number.isSafeInteger(quantity) || quantity < 1 || (action.delta > 0 && quantity > action.stock)) return cart
    items = existing
      ? previous.map((item) => item === existing ? { ...item, quantity } : item)
      : [...previous, { productId: action.productId, quantity }]
  }
  return { ...cart, itemsByCity: { ...cart.itemsByCity, [city]: items } }
}
