import { Search, ShoppingBag, ShoppingCart } from 'lucide-react'
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
            <span className="brand-icon"><ShoppingBag size={20} aria-hidden="true" /></span>
            ShelfSync
          </a>
        </nav>
        <div className="search-box" role="search">
          <label>
            <span className="sr-only">Search products</span>
            <Search size={19} aria-hidden="true" />
            <Input type="search" placeholder="Search products" value={search}
              onChange={(event) => onSearchChange(event.target.value)} />
          </label>
        </div>
        <div className="header-actions">
          <CitySelector city={city} onChange={onCityChange} />
          <button type="button" className="cart-toggle" onClick={onOpenCart}
            aria-label={`Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}>
            <ShoppingCart size={19} aria-hidden="true" />
            <span>Cart</span>
            <span className="cart-count">{cartCount}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
