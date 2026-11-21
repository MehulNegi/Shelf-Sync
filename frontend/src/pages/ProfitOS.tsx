import { ChartNoAxesCombined, Layers3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { OrderAutopsy } from '../components/profit-os/OrderAutopsy'
import { ProfitLab, type ScenarioInputs } from '../components/profit-os/ProfitLab'
import { StrategyComparison } from '../components/profit-os/StrategyComparison'
import { baseline, displayInput, type Scenario } from '../lib/profit-os'

function toInputs(scenario: Scenario): ScenarioInputs {
  return {
    discount: displayInput(scenario.discountBps),
    courier: displayInput(scenario.courierPaise),
    deliveryFee: displayInput(scenario.deliveryFeePaise),
  }
}

export function ProfitOS() {
  const [inputs, setInputs] = useState(() => toInputs(baseline))
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
            <span className="command-state">Demo assumptions</span>
            <p>Read-only simulator using an illustrative sale. Changes apply only to this scenario.</p>
          </div>
        </div>
        <div className="profit-workspace">
          <OrderAutopsy />
          <ProfitLab inputs={inputs} onChange={changeInput} />
        </div>
        <StrategyComparison onApply={applyStrategy} />
      </main>
    </>
  )
}
