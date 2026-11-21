import { PackageSearch } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useProducts } from '../../hooks/use-products'
import { catalogPricePaise, completeScenario, formatPaise, toInputs, type ProductInputs } from '../../lib/profit-os'
import { demoProductInputs } from '../../lib/profit-os-demo'
import { editedProductFields, productDraft, type ProfitDrafts } from '../../lib/profit-os-drafts'
import { isMockMode } from '../../services/backend'
import { cities, type City } from '../../types/products'
import { Input } from '../ui/input'
import { OrderAutopsy } from './OrderAutopsy'
import { ProfitLab } from './ProfitLab'
import { StrategyComparison } from './StrategyComparison'

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
  const options = product && !matches.includes(product) ? [product, ...matches] : matches
  const price = catalogPricePaise(product?.price)
  const defaults = product ? demoProductInputs(product, price) : undefined
  const input = productDraft(drafts, city, productId, defaults)
  const editedFields = editedProductFields(drafts, city, productId)
  const scenario = completeScenario(price, input)

  return (
    <>
      <section className="command-panel profit-catalog" aria-labelledby="profit-catalog-heading">
        <h2 id="profit-catalog-heading"><PackageSearch size={20} aria-hidden="true" /> Choose a Product</h2>
        <p>{isMockMode ? 'Mock catalog · Set VITE_API_BASE_URL to use live ShelfSync prices.' : 'ShelfSync catalog · Current selling prices by city'}</p>
        <div className="profit-catalog-fields">
          <label className="filter-control">City
            <select className="control" value={city} onChange={(event) => onSelect({ city: event.target.value as City, productId })}>
              {Object.entries(cities).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>
          <label className="filter-control">Search products
            <Input type="search" placeholder="Product name or ID" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="filter-control">Select product
            <select className="control" value={product?.id ?? ''} disabled={!options.length}
              onChange={(event) => onSelect({ city, productId: event.target.value })}>
              <option value="">Choose a product</option>
              {options.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
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
          : !product ? <p>Choose a product to start a scenario.</p> : null}
        {product && (
          <div className="profit-selected-product">
            <h3>{product.name}</h3>
            <dl>
              <div><dt>Product ID</dt><dd>{product.id}</dd></div>
              <div><dt>City</dt><dd>{cities[product.city]}</dd></div>
              <div><dt>Catalog selling price</dt><dd>{price === null ? 'Unavailable' : formatPaise(price)}</dd></div>
            </dl>
          </div>
        )}
      </section>
      {product && (
        <>
          {defaults && (
            <div className="profit-demo-controls">
              <p><strong>Demo financial estimates — fictional costs generated for demonstration.</strong>
                {' '}The selling price comes from the catalog. Changes to sample costs stay here until you leave My Earnings.</p>
              <button className="clear-filters" type="button" disabled={!editedFields.size}
                onClick={() => onReset(selection)}>Reset to demo estimates</button>
            </div>
          )}
          <div className="profit-workspace">
            <OrderAutopsy catalog={{ price, input }} scenario={scenario} />
            <ProfitLab catalog={{ input, scenario, hasPrice: price !== null, editedFields,
                onChange: (field, value) => onEdit(selection, { [field]: value }) }} />
          </div>
          <StrategyComparison catalogScenario={scenario} onApply={(next) => {
            const values = toInputs(next)
            const changes = Object.fromEntries(Object.entries(values).filter(([field, value]) =>
              input[field as keyof ProductInputs] !== value,
            ))
            if (Object.keys(changes).length) onEdit(selection, changes)
            document.getElementById('profit-discount')?.focus()
          }} />
        </>
      )}
    </>
  )
}
