import { useCallback, useRef, useState } from 'react'
import { baseUrl, isMockMode } from '../services/backend'
import { cartReducer, loadCart, saveCart, type CartAction } from '../services/cart'

const storageKey = `shelfsync.cart.v1:${isMockMode ? 'mock' : baseUrl}`
const storage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
}

export function useCart() {
  const [cart, setCart] = useState(() => loadCart(storage, storageKey))
  const current = useRef(cart)
  const dispatch = useCallback((action: CartAction) => {
    const next = cartReducer(current.current, action)
    current.current = next
    saveCart(storage, storageKey, next)
    setCart(next)
  }, [])
  return [cart, dispatch] as const
}
