import { Layers3, ReceiptText, Search, ShoppingBag, X } from 'lucide-react'
import { CitySelector } from '../city/CitySelector'
import { Input } from '../ui/input'
import type { City } from '../../types/products'

interface HeaderProps {
  city: City
  onCityChange: (city: City) => void
  cartCount: number
  onOpenCart: () => void
  search: string
  onSearchChange: (search: string) => void
}

export function Header({ city, onCityChange, cartCount, onOpenCart, search, onSearchChange }: HeaderProps) {
  return (
    <header className="site-header" id="top">
      <div className="shell header-inner">
        <nav aria-label="Main navigation">
          <a href="#top" className="brand">
            <span className="brand-icon"><Layers3 size={22} aria-hidden="true" /></span>
            ShelfSync
          </a>
        </nav>
        <div className="header-discovery">
          <div className="search-box" role="search">
            <label>
              <span className="sr-only">Search products</span>
              <Search size={19} aria-hidden="true" />
              <Input type="search" placeholder="Search products" value={search}
                onChange={(event) => onSearchChange(event.target.value)} />
            </label>
            {search && <button type="button" className="search-clear" onClick={() => onSearchChange('')} aria-label="Clear search">
              <X size={18} aria-hidden="true" />
            </button>}
          </div>
          <nav aria-label="Order navigation">
            <a href="#/orders" className="orders-nav-link"><ReceiptText size={17} aria-hidden="true" /> My Orders</a>
          </nav>
        </div>
        <div className="header-actions">
          <CitySelector city={city} onChange={onCityChange} />
          <button type="button" className="cart-toggle" onClick={onOpenCart}
            aria-label={`Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}>
            <ShoppingBag size={18} aria-hidden="true" />
            <span className="cart-label">Cart</span>
            <span className="cart-count">{cartCount}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
