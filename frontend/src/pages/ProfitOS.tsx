import { RetailerHeader } from '../components/admin/RetailerHeader'
import { useEffect, useRef, useState } from 'react'
import { OrderAutopsy } from '../components/profit-os/OrderAutopsy'
import { ProfitLab } from '../components/profit-os/ProfitLab'
import { ProductProfitOS, type CatalogSelection } from '../components/profit-os/ProductProfitOS'
import { StrategyComparison } from '../components/profit-os/StrategyComparison'
import { baseline, toInputs, type Scenario, type ScenarioInputs } from '../lib/profit-os'
import { resetProductDraft, updateProductDraft, type ProfitDrafts } from '../lib/profit-os-drafts'

export function ProfitOS() {
  const [inputs, setInputs] = useState(() => toInputs(baseline))
  const [mode, setMode] = useState<'demo' | 'product'>('demo')
  const [selection, setSelection] = useState<CatalogSelection>({ city: 'pune', productId: '' })
  const [drafts, setDrafts] = useState<ProfitDrafts>(() => new Map())
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [])

  function changeInput(field: keyof ScenarioInputs, value: string) {
    setInputs((previous) => ({ ...previous, [field]: value }))
  }

  function applyStrategy(scenario: Scenario) {
    setInputs(toInputs(scenario))
    const discount = document.getElementById('profit-discount')
    discount?.focus()
  }

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
        <aside className="retailer-demo-note" aria-label="About these estimates">
          <strong>These are sample costs for demonstration. Replace them with your own numbers for a more useful estimate.</strong>
          <p>Changes are temporary and apply only to this estimate.</p>
        </aside>
        <div className="profit-modes" role="group" aria-label="Choose what to estimate">
          <button type="button" className="clear-filters" aria-pressed={mode === 'product'} onClick={() => setMode('product')}>Choose a product</button>
          <button type="button" className="clear-filters" aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>Example sale</button>
        </div>
        {mode === 'demo' ? (
          <>
            <div className="profit-workspace">
              <OrderAutopsy />
              <ProfitLab inputs={inputs} onChange={changeInput} />
            </div>
            <StrategyComparison onApply={applyStrategy} />
          </>
        ) : (
          <ProductProfitOS selection={selection} drafts={drafts} onSelect={setSelection}
            onEdit={({ city, productId }, fields) =>
              setDrafts((previous) => updateProductDraft(previous, city, productId, fields))}
            onReset={({ city, productId }) => setDrafts((previous) => resetProductDraft(previous, city, productId))} />
        )}
      </main>
    </>
  )
}
