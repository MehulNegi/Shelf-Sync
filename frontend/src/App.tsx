import { useSyncExternalStore } from 'react'
import { MyOrders } from './pages/MyOrders'
import { Storefront } from './pages/Storefront'

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function isOrdersPage() {
  return window.location.hash === '#/orders'
}

export default function App() {
  const showOrders = useSyncExternalStore(subscribeToHash, isOrdersPage)
  return showOrders ? <MyOrders /> : <Storefront />
}
