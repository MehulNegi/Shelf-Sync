import { Database } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatPrice } from '../../lib/format-price'
import type { AdminSnapshot, InventoryQuery, StockStatus } from '../../types/admin'
import { cities, type City } from '../../types/products'
import { Input } from '../ui/input'

const stockLabels: Record<StockStatus, string> = {
  in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock',
}

interface InventoryPanelProps {
  data?: AdminSnapshot['inventory']
  loading: boolean
  filters?: InventoryQuery
  pageNumber: number
  onFilters: (filters: InventoryQuery) => void
  onPage: (cursor?: string) => void
}

export function InventoryPanel({ data, loading, filters, pageNumber, onFilters, onPage }: InventoryPanelProps) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const visible = data?.inventory.filter((row) =>
    row.name.toLowerCase().includes(needle) || row.productId.toLowerCase().includes(needle),
  )

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    onFilters({
      city: String(values.get('city')) as City || undefined,
      category: String(values.get('category')) || undefined,
      stockStatus: String(values.get('stockStatus')) as StockStatus || undefined,
      limit: Number(values.get('limit')),
    })
  }

  return (
    <section className="command-panel command-inventory" aria-labelledby="command-inventory-title">
      <h2 id="command-inventory-title"><Database size={19} aria-hidden="true" /> Inventory</h2>
      <form className="command-filters" onSubmit={submit}>
        <label className="filter-control">City
          <select className="control" name="city" defaultValue={filters?.city}>
            <option value="">All cities</option>
            {Object.entries(cities).map(([city, name]) => <option key={city} value={city}>{name}</option>)}
          </select>
        </label>
        <label className="filter-control">Category
          <Input name="category" defaultValue={filters?.category} maxLength={100} placeholder="All categories" />
        </label>
        <label className="filter-control">Stock status
          <select className="control" name="stockStatus" defaultValue={filters?.stockStatus}>
            <option value="">All stock statuses</option>
            {Object.entries(stockLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
        <label className="filter-control">Page size
          <Input name="limit" type="number" min={1} max={100} defaultValue={filters?.limit ?? 50} required />
        </label>
        <button className="primary-button" type="submit">Apply filters</button>
      </form>
      <label className="filter-control command-search">Search this page
        <Input type="search" value={search} placeholder="Product name or ID" onChange={(event) => setSearch(event.target.value)} />
      </label>
      {!data && loading && (
        <div className="command-table-skeleton motion-safe:animate-pulse" aria-hidden="true"><span /><span /><span /></div>
      )}
      {data && (visible?.length ? (
        <>
          <p className="retailer-scroll-note">Scroll the table sideways to see all stock details.</p>
          <div className="command-table-wrap" role="region" aria-label="Inventory records table" tabIndex={0}>
            <table className="command-table">
              <caption className="sr-only">Current inventory by product and city</caption>
              <thead><tr>
                <th scope="col">Product</th><th scope="col">Category</th><th scope="col">City</th>
                <th scope="col">Price</th><th scope="col">Stock</th><th scope="col">Status</th>
              </tr></thead>
              <tbody>{visible.map((row) => (
                <tr key={`${row.productId}:${row.city}`}>
                  <th scope="row">{row.name}</th><td>{row.category}</td><td>{cities[row.city]}</td>
                  <td>{formatPrice(row.price)}</td><td>{row.stock}</td>
                  <td><span className="command-stock-badge" data-status={row.stockStatus}>{stockLabels[row.stockStatus]}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      ) : <p className="command-empty">{data.inventory.length ? 'No products on this page match your search.' : 'No inventory records match these filters.'}</p>)}
      {(data || pageNumber > 1) && (
        <div className="command-pagination">
          <p>Page {pageNumber}{data && ` · ${data.inventory.length} records`}</p>
          <div>
            <button className="clear-filters" type="button" disabled={pageNumber === 1} onClick={() => onPage()}>Previous</button>
            <button className="clear-filters" type="button" disabled={!data?.page.nextCursor || loading}
              onClick={() => { if (data?.page.nextCursor) onPage(data.page.nextCursor) }}>Next</button>
          </div>
        </div>
      )}
    </section>
  )
}
