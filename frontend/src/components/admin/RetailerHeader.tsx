import { House, Layers3, Package, ReceiptText, Wallet } from 'lucide-react'

export type RetailerView = 'shop' | 'products' | 'orders' | 'earnings'

const links = [
  { view: 'shop', href: '#/admin', label: 'My Shop', Icon: House },
  { view: 'products', href: '#/admin/products', label: 'My Products', Icon: Package },
  { view: 'orders', href: '#/admin/orders', label: 'Customer Orders', Icon: ReceiptText },
  { view: 'earnings', href: '#/admin/profit-os', label: 'My Earnings', Icon: Wallet },
] as const

export function RetailerHeader({ active }: { active: RetailerView }) {
  return (
    <header className="site-header retailer-header">
      <div className="shell retailer-header-inner">
        <a href="#/admin" className="brand">
          <span className="brand-icon"><Layers3 size={22} aria-hidden="true" /></span>
          ShelfSync
        </a>
        <a href="#top" className="orders-nav-link retailer-shopping">Back to shopping</a>
        <nav aria-label="Shop navigation" className="retailer-nav">
          {links.map(({ view, href, label, Icon }) => (
            <a key={view} href={href} aria-current={active === view ? 'page' : undefined}>
              <Icon size={19} aria-hidden="true" /> {label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  )
}
