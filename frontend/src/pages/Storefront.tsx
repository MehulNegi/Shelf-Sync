import { ChevronDown, MapPin, PackageCheck, PackageSearch, RotateCcw } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { ReservationFeedback } from '../components/cart/ReservationFeedback'
import { CartDialog } from '../components/cart/CartDialog'
import { Header } from '../components/layout/Header'
import { ProductCard } from '../components/products/ProductCard'
import { ProductDetails } from '../components/products/ProductDetails'
import { Input } from '../components/ui/input'
import { useCartReservations } from '../hooks/use-cart-reservations'
import { useCart } from '../hooks/use-cart'
import { useProducts } from '../hooks/use-products'
import { isMockMode } from '../services/backend'
import { remainingSeconds, reservationDisplay } from '../services/reservations'
import { categories, cities, type Product, type ProductQuery } from '../types/products'

export function Storefront() {
  const [cart, dispatch] = useCart()
  const { city } = cart
  const items = cart.itemsByCity[city]
  const cartCount = items.reduce((count, item) => count + item.quantity, 0)
  const [dialog, setDialog] = useState<{ kind: 'cart' } | { kind: 'product'; id: string }>()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [attempt, setAttempt] = useState(0)
  const reservations = useCartReservations(cart, dispatch, refreshCatalog)
  const reservationLocked = reservations.enabled && Boolean(reservations.busy || reservations.pending)

  const hasFilters = Boolean(search || category || min || max)
  const q = useDeferredValue(search.trim())
  const minPrice = min === '' ? undefined : Number(min)
  const maxPrice = max === '' ? undefined : Number(max)
  const invalidPrice = (minPrice !== undefined && (!Number.isFinite(minPrice) || minPrice < 0)) ||
    (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < (minPrice ?? 0)))
  const query = useMemo<ProductQuery>(() => ({
    city, q, category,
    minPrice: invalidPrice ? undefined : minPrice,
    maxPrice: invalidPrice ? undefined : maxPrice,
  }), [city, q, category, minPrice, maxPrice, invalidPrice])
  const result = useProducts(query, attempt)
  const data = result && 'data' in result ? result.data : undefined
  const error = result && 'error' in result ? result.error : undefined

  function quantityOf(productId: string) {
    return items.find((item) => item.productId === productId)?.quantity ?? 0
  }

  function addProduct(product: Product) {
    if (!product.available) return
    if (reservations.enabled) {
      const quantity = quantityOf(product.id)
      const hold = reservations.holds.find((row) => row.city === city && row.productId === product.id)
      const target = remainingSeconds(hold, performance.now()) > 0 && hold
        ? hold.quantity + 1 : Math.max(quantity, 1)
      if (target <= 99) void reservations.changeQuantity(city, { productId: product.id, quantity: target }, true)
      return
    }
    dispatch({ type: 'adjust', city: product.city, productId: product.id, delta: 1, stock: product.stock })
  }

  function refreshCatalog() {
    setAttempt((value) => value + 1)
  }

  function closeDialog() {
    reservations.dismissOrder()
    setDialog(undefined)
  }

  function clearFilters() {
    setSearch('')
    setCategory('')
    setMin('')
    setMax('')
  }

  return (
    <>
      <Header city={city} cityDisabled={reservationLocked} onCityChange={(selected) => {
        if (reservations.enabled) void reservations.switchCity(selected)
        else dispatch({ type: 'selectCity', city: selected })
      }}
        cartCount={cartCount} onOpenCart={() => setDialog({ kind: 'cart' })}
        search={search} onSearchChange={setSearch} />
      <main className="shell">
        {reservations.enabled && !dialog && <div className="reservation-notice"><ReservationFeedback reservations={reservations} /></div>}
        <section className="hero" aria-labelledby="store-heading">
          <div className="hero-copy">
            <p className="hero-city"><MapPin size={15} aria-hidden="true" /> Local inventory · {cities[city]}</p>
            <h1 id="store-heading">Good finds.<br /> <em>Closer to home.</em></h1>
            <p className="hero-description">Browse tech, everyday wear, and pantry staples in your city.</p>
            <a className="primary-button hero-cta" href="#catalog">Shop the catalog</a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-frame hero-frame-back">
              <img src="/images/headphones.webp" alt="" width="300" height="300" />
            </div>
            <div className="hero-frame hero-frame-front">
              <img src="/images/sneakers.webp" alt="" width="300" height="300" />
            </div>
          </div>
        </section>

        <section id="catalog" className="catalog" aria-labelledby="catalog-heading">
          <div className="catalog-heading">
            <div>
              <h2 id="catalog-heading">Shop the catalog</h2>
              <p role="status">{invalidPrice ? '' : data
                ? `${data.total} ${data.total === 1 ? 'product' : 'products'} in ${cities[city]}`
                : error ? '' : `Checking availability in ${cities[city]}…`}</p>
            </div>
            <div className="catalog-context">
              <p className="inventory-label"><PackageCheck size={16} aria-hidden="true" /> Inventory for {cities[city]}</p>
              <p className="catalog-mode">{isMockMode ? 'Mock mode' : 'Live API mode'}</p>
            </div>
          </div>
          <div className="filters" role="group" aria-label="Product filters">
            <label className="filter-control">
              Category
              <span className="select-wrap">
                <select className="control" data-active={category !== ''} value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((value) => (
                    <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </span>
            </label>
            <label className="filter-control">
              Min price (₹)
              <Input type="number" min="0" step="any" placeholder="No minimum" value={min} data-active={min !== ''}
                aria-invalid={invalidPrice} aria-describedby={invalidPrice ? 'price-error' : undefined}
                onChange={(event) => setMin(event.target.value)} />
            </label>
            <label className="filter-control">
              Max price (₹)
              <Input type="number" min="0" step="any" placeholder="No maximum" value={max} data-active={max !== ''}
                aria-invalid={invalidPrice} aria-describedby={invalidPrice ? 'price-error' : undefined}
                onChange={(event) => setMax(event.target.value)} />
            </label>
            <button className="clear-filters" type="button" disabled={!hasFilters} onClick={clearFilters}>
              <RotateCcw size={16} aria-hidden="true" /> Clear filters
            </button>
          </div>

          {invalidPrice ? (
            <p id="price-error" className="state-panel" role="alert">
              Enter non-negative prices and make sure the maximum is at least the minimum.
            </p>
          ) : error ? (
            <div className="state-panel">
              <p role="alert">{error}</p>
              <button className="text-button" type="button" onClick={refreshCatalog}>Try again</button>
            </div>
          ) : !data ? (
            <div className="product-grid" aria-hidden="true">
              {[0, 1, 2].map((item) => (
                <div className="product-skeleton motion-safe:animate-pulse" key={item}>
                  <div className="skeleton-media" />
                  <div className="skeleton-body"><span /><span /><span /></div>
                </div>
              ))}
            </div>
          ) : !data.products.length ? (
            <div className="state-panel">
              <PackageSearch size={28} aria-hidden="true" />
              <h3>No products found</h3>
              <p>Try a different search or adjust your filters.</p>
              <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button>
            </div>
          ) : (
            <div className="product-grid">
              {data.products.map((product) => {
                const quantity = quantityOf(product.id)
                const display = reservations.enabled && product.city === city
                  ? reservationDisplay(reservations.holds, city, { productId: product.id, quantity }, reservations.now)
                  : undefined
                return (
                  <ProductCard key={product.id} product={product} quantity={quantity} onAdd={addProduct}
                    reservationMode={reservations.enabled} addDisabled={reservationLocked} reservation={display}
                    reservationPending={reservations.workingProduct === product.id}
                    onDetails={() => setDialog({ kind: 'product', id: product.id })} />
                )
              })}
            </div>
          )}
        </section>
      </main>
      <footer>
        <div className="shell footer-inner">
          <strong>ShelfSync</strong>
          <nav className="store-footer-links" aria-label="Storefront footer navigation">
            <a href="#/admin">My Shop</a>
            <a href="#top">Back to top</a>
          </nav>
        </div>
      </footer>
      {dialog?.kind === 'product' && !reservations.order && (
        <ProductDetails id={dialog.id} city={city} quantity={quantityOf(dialog.id)}
          onAdd={addProduct} onClose={closeDialog}
          stockRevision={reservations.enabled ? attempt : 0} reservationMode={reservations.enabled}
          reservationPending={reservations.workingProduct === dialog.id} addDisabled={reservationLocked}
          reservationFeedback={reservations.enabled && <ReservationFeedback reservations={reservations} />} />
      )}
      {(dialog?.kind === 'cart' || reservations.order) && (
        <CartDialog city={city} items={items} stockRevision={reservations.enabled ? attempt : 0}
          reservations={reservations.enabled ? reservations : undefined}
          onAdjust={(productId, delta, stock) => dispatch({ type: 'adjust', city, productId, delta, stock })}
          onRemove={(productId) => dispatch({ type: 'remove', city, productId })}
          onPlaced={() => dispatch({ type: 'clear', city })}
          refreshCatalog={refreshCatalog} onClose={closeDialog} />
      )}
    </>
  )
}
