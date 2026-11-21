import { Search, ShoppingBag } from 'lucide-react'
import { CitySelector } from '../city/CitySelector'
import { Input } from '../ui/input'
import type { City } from '../../types/products'

interface HeaderProps {
  city: City
  onCityChange: (city: City) => void
  search: string
  onSearchChange: (search: string) => void
}

export function Header({ city, onCityChange, search, onSearchChange }: HeaderProps) {
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
            <Input type="search" placeholder="Search for products" value={search}
              onChange={(event) => onSearchChange(event.target.value)} />
          </label>
        </div>
        <CitySelector city={city} onChange={onCityChange} />
      </div>
    </header>
  )
}
