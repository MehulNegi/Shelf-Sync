import { RetailerHeader } from '../components/admin/RetailerHeader'
import { useEffect, useRef, useState } from 'react'
import { ProductProfitOS, type CatalogSelection } from '../components/profit-os/ProductProfitOS'
import { resetProductDraft, updateProductDraft, type ProfitDrafts } from '../lib/profit-os-drafts'

export function ProfitOS() {
  const [selection, setSelection] = useState<CatalogSelection>({ city: 'pune', productId: '' })
  const [drafts, setDrafts] = useState<ProfitDrafts>(() => new Map())
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <RetailerHeader active="earnings" />
      <main className="shell command-center retailer-page profit-os">
        <div className="retailer-welcome">
          <div>
            <h1 ref={heading} tabIndex={-1}>My Earnings</h1>
            <p>Understand your profit</p>
          </div>
        </div>
        <ol className="retailer-steps" aria-label="How to estimate earnings">
          <li><span aria-hidden="true">1</span> Choose a product</li>
          <li><span aria-hidden="true">2</span> See how much money may be left after costs</li>
          <li><span aria-hidden="true">3</span> Try changing your discount, delivery or other expenses</li>
        </ol>
        <ProductProfitOS selection={selection} drafts={drafts} onSelect={setSelection}
          onEdit={({ city, productId }, fields) =>
            setDrafts((previous) => updateProductDraft(previous, city, productId, fields))}
          onReset={({ city, productId }) => setDrafts((previous) => resetProductDraft(previous, city, productId))} />
      </main>
    </>
  )
}
