import { ChartNoAxesCombined, Layers3 } from 'lucide-react'
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
      <header className="site-header">
        <nav className="shell history-nav" aria-label="ProfitOS navigation">
          <a href="#top" className="brand">
            <span className="brand-icon"><Layers3 size={22} aria-hidden="true" /></span>
            ShelfSync
          </a>
          <a href="#/admin" className="orders-nav-link">Inventory Command Center</a>
        </nav>
      </header>
      <main className="shell command-center profit-os">
        <div className="command-intro profit-intro">
          <div>
            <span className="profit-title-icon"><ChartNoAxesCombined size={23} aria-hidden="true" /></span>
            <h1 ref={heading} tabIndex={-1}>ProfitOS</h1>
            <p>Smart Profit Advisor</p>
          </div>
          <div className="profit-demo">
            <span className="command-state">{mode === 'demo' ? 'Demo assumptions' : 'Unsaved financial assumptions'}</span>
            <p>{mode === 'demo' ? 'Read-only simulator using an illustrative sale.' : 'Product scenarios use catalog prices and fictional demo estimates.'} Changes apply only to this scenario.</p>
          </div>
        </div>
        <div className="profit-modes" role="group" aria-label="ProfitOS mode">
          <button type="button" className="clear-filters" aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>Demo scenario</button>
          <button type="button" className="clear-filters" aria-pressed={mode === 'product'} onClick={() => setMode('product')}>Analyze a product</button>
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
