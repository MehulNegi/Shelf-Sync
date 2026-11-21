import { ChevronDown, MapPin, PackageSearch, SlidersHorizontal } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { CartDialog } from '../components/cart/CartDialog'
import { Header } from '../components/layout/Header'
import { ProductCard } from '../components/products/ProductCard'
import { ProductDetails } from '../components/products/ProductDetails'
import { Input } from '../components/ui/input'
import { useCart } from '../hooks/use-cart'
import { useProducts } from '../hooks/use-products'
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
    dispatch({ type: 'adjust', city: product.city, productId: product.id, delta: 1, stock: product.stock })
  }

  function refreshCatalog() {
    setAttempt((value) => value + 1)
  }

  function closeDialog() {
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
      <Header city={city} onCityChange={(selected) => dispatch({ type: 'selectCity', city: selected })}
        cartCount={cartCount} onOpenCart={() => setDialog({ kind: 'cart' })}
        search={search} onSearchChange={setSearch} />
      <main className="shell">
        <section className="hero" aria-labelledby="store-heading">
          <p className="hero-city"><MapPin size={17} aria-hidden="true" /> Shopping in {cities[city]}</p>
          <h1 id="store-heading">Shop near you.</h1>
          <p>Browse electronics, apparel and groceries and see what’s in stock in your city.</p>
        </section>

        <section className="catalog" aria-labelledby="catalog-heading">
          <div className="catalog-heading">
            <h2 id="catalog-heading">Browse products</h2>
            <p role="status">{invalidPrice ? '' : data
              ? `${data.total} ${data.total === 1 ? 'product' : 'products'} in ${cities[city]}`
              : error ? '' : 'Loading products…'}</p>
          </div>
          <div className="filters" role="group" aria-label="Product filters">
            <span className="filter-title"><SlidersHorizontal size={18} aria-hidden="true" /> Filters</span>
            <label className="filter-control">
              Category
              <span className="select-wrap">
                <select className="control" value={category} onChange={(event) => setCategory(event.target.value)}>
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
              <Input type="number" min="0" step="any" placeholder="0" value={min}
                aria-invalid={invalidPrice} aria-describedby={invalidPrice ? 'price-error' : undefined}
                onChange={(event) => setMin(event.target.value)} />
            </label>
            <label className="filter-control">
              Max price (₹)
              <Input type="number" min="0" step="any" placeholder="Any" value={max}
                aria-invalid={invalidPrice} aria-describedby={invalidPrice ? 'price-error' : undefined}
                onChange={(event) => setMax(event.target.value)} />
            </label>
            {(search || category || min || max) && (
              <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button>
            )}
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
              {[0, 1, 2].map((item) => <div className="skeleton motion-safe:animate-pulse" key={item} />)}
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
              {data.products.map((product) => (
                <ProductCard key={product.id} product={product} quantity={quantityOf(product.id)} onAdd={addProduct}
                  onDetails={() => setDialog({ kind: 'product', id: product.id })} />
              ))}
            </div>
          )}
        </section>
      </main>
      <footer>
        <div className="shell footer-inner"><strong>ShelfSync</strong><a href="#top">Back to top</a></div>
      </footer>
      {dialog?.kind === 'product' && (
        <ProductDetails id={dialog.id} city={city} quantity={quantityOf(dialog.id)}
          onAdd={addProduct} onClose={closeDialog} />
      )}
      {dialog?.kind === 'cart' && (
        <CartDialog city={city} items={items}
          onAdjust={(productId, delta, stock) => dispatch({ type: 'adjust', city, productId, delta, stock })}
          onRemove={(productId) => dispatch({ type: 'remove', city, productId })}
          onPlaced={() => dispatch({ type: 'clear', city })}
          refreshCatalog={refreshCatalog} onClose={closeDialog} />
      )}
    </>
  )
}
