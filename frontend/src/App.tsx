import { useSyncExternalStore } from 'react'
import { InventoryCommandCenter } from './pages/InventoryCommandCenter'
import { ProfitOS } from './pages/ProfitOS'
import { MyOrders } from './pages/MyOrders'
import { Storefront } from './pages/Storefront'

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function currentHash() {
  return window.location.hash
}

export default function App() {
  const hash = useSyncExternalStore(subscribeToHash, currentHash)
  if (hash === '#/admin/profit-os') return <ProfitOS />
  if (hash === '#/admin') return <InventoryCommandCenter />
  if (hash === '#/orders') return <MyOrders />
  return <Storefront />
}
