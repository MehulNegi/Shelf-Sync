import { PackageSearch } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useProducts } from '../../hooks/use-products'
import { catalogPricePaise, formatPaise, type ProductInputs } from '../../lib/profit-os'
import { demoProductInputs } from '../../lib/profit-os-demo'
import { editedProductFields, productDraft, type ProfitDrafts } from '../../lib/profit-os-drafts'
import { isMockMode } from '../../services/backend'
import { cities, type City } from '../../types/products'
import { ProductImage } from '../products/ProductImage'
import { EarningsProductCard } from './EarningsProductCard'
import { Input } from '../ui/input'
import { EarningsGuide } from './EarningsGuide'

export interface CatalogSelection {
  city: City
  productId: string
}

interface ProductProfitOSProps {
  selection: CatalogSelection
  drafts: ProfitDrafts
  onSelect: (selection: CatalogSelection) => void
  onReset: (selection: CatalogSelection) => void
  onEdit: (selection: CatalogSelection, fields: Partial<ProductInputs>) => void
}

export function ProductProfitOS({ selection, drafts, onSelect, onEdit, onReset }: ProductProfitOSProps) {
  const { city, productId } = selection
  const [search, setSearch] = useState('')
  const [attempt, setAttempt] = useState(0)
  const query = useMemo(() => ({ city }), [city])
  const result = useProducts(query, attempt)
  const products = result && 'data' in result ? result.data.products.filter((product) => product.city === city) : []
  const product = products.find(({ id }) => id === productId)
  const needle = search.trim().toLowerCase()
  const matches = products.filter(({ name, id }) => name.toLowerCase().includes(needle) || id.toLowerCase().includes(needle))
  const price = catalogPricePaise(product?.price)
  const defaults = product ? demoProductInputs(product, price) : undefined
  const input = productDraft(drafts, city, productId, defaults)
  const editedFields = editedProductFields(drafts, city, productId)

  const searchInput = useRef<HTMLInputElement>(null)
  const summaryHeading = useRef<HTMLHeadingElement>(null)
  const focusSummary = useRef(false)

  useEffect(() => {
    if (product && focusSummary.current) {
      focusSummary.current = false
      summaryHeading.current?.focus()
    }
  }, [product])

  function chooseProduct(nextId: string) {
    if (nextId === productId) {
      summaryHeading.current?.focus()
      return
    }
    focusSummary.current = true
    onSelect({ city, productId: nextId })
  }

  return (
    <>
      <section className="command-panel profit-catalog" aria-labelledby="profit-catalog-heading">
        <h2 id="profit-catalog-heading"><PackageSearch size={20} aria-hidden="true" /> Choose a Product</h2>
        <p>{isMockMode ? 'Sample catalog prices' : 'Current catalog prices for the city you choose.'}</p>
        <div className="profit-catalog-fields">
          <label className="filter-control">Where are you selling?
            <select className="control" value={city} onChange={(event) => onSelect({ city: event.target.value as City, productId })}>
              {Object.entries(cities).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>
          <label className="filter-control">Search products
            <Input ref={searchInput} type="search" placeholder="Search your products..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>
        {!result ? <p role="status">Loading products for {cities[city]}…</p>
          : 'error' in result ? (
            <>
              <p role="alert">Couldn’t load products for {cities[city]}. {result.error}</p>
              <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry catalog</button>
            </>
          ) : !products.length ? <p role="status">No products available in the {cities[city]} catalog.</p>
          : !matches.length ? <p role="status">No products match your search.</p>
          : (
            <ul className="earnings-product-grid" aria-label="Products to choose from">
              {matches.map((item) => (
                <li key={item.id}>
                  <EarningsProductCard product={item} selected={item.id === product?.id} onSelect={() => chooseProduct(item.id)} />
                </li>
              ))}
            </ul>
          )}
      </section>
      {product && (
        <>
          <section className="command-panel earnings-selection" aria-labelledby="earnings-selected-heading">
            <ProductImage product={product} />
            <div>
              <h2 id="earnings-selected-heading" ref={summaryHeading} tabIndex={-1}>{product.name}</h2>
              <p>Let's see how much money may be left after selling this product.</p>
              <dl>
                <div><dt>Catalog selling price</dt><dd>{price === null ? 'Unavailable' : formatPaise(price)}</dd></div>
                <div><dt>Selling in</dt><dd>{cities[product.city]}</dd></div>
                <div><dt>Product ID</dt><dd>{product.id}</dd></div>
              </dl>
              <button className="clear-filters" type="button" onClick={() => searchInput.current?.focus()}>Choose another product</button>
            </div>
          </section>
          {defaults && (
            <div className="profit-demo-controls">
              <p><strong>Sample costs for demonstration — not your actual expenses.</strong>
                {' '}Replace the sample costs with your own numbers for a more useful estimate. Your edits stay here until you leave My Earnings.</p>
              <button className="clear-filters" type="button" disabled={!editedFields.size}
                onClick={() => onReset(selection)}>Reset to demo estimates</button>
            </div>
          )}
          <EarningsGuide key={`${city}:${productId}`} price={price} input={input} editedFields={editedFields}
            onEdit={(fields) => onEdit(selection, fields)} />
        </>
      )}
    </>
  )
}
