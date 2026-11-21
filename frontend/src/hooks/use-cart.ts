import { useEffect, useReducer } from 'react'
import { baseUrl, isMockMode } from '../services/backend'
import { cartReducer, loadCart, saveCart } from '../services/cart'

const storageKey = `shelfsync.cart.v1:${isMockMode ? 'mock' : baseUrl}`
const storage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
}

export function useCart() {
  const [cart, dispatch] = useReducer(cartReducer, storageKey, (key) => loadCart(storage, key))
  useEffect(() => saveCart(storage, storageKey, cart), [cart])
  return [cart, dispatch] as const
}
