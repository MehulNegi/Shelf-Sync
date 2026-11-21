import { GitCompareArrows } from 'lucide-react'
import { baseline, calculateScenario, contributionTone, formatDiscount, formatPaise, strategies, type Scenario } from '../../lib/profit-os'

const baselineContribution = calculateScenario(baseline).contributionPaise

export function StrategyComparison({ onApply }: { onApply: (scenario: Scenario) => void }) {
  return (
    <section className="command-panel profit-strategies" aria-labelledby="strategy-heading">
      <h2 id="strategy-heading"><GitCompareArrows size={20} aria-hidden="true" /> Strategy comparison</h2>
      <p>Compare demo strategies against the baseline, then load one into the lab.</p>
      <div className="command-table-wrap" tabIndex={0} role="region" aria-label="ProfitOS demo strategy comparison">
        <table className="command-table profit-strategy-table">
          <thead>
            <tr>
              <th scope="col">Strategy</th><th scope="col">Discount</th><th scope="col">Courier</th>
              <th scope="col">Delivery fee</th><th scope="col">Estimated contribution</th>
              <th scope="col">Change vs baseline</th><th scope="col" aria-label="Load strategy" />
            </tr>
          </thead>
          <tbody>
            {strategies.map(({ name, scenario }) => {
              const { contributionPaise } = calculateScenario(scenario)
              const delta = contributionPaise - baselineContribution
              return (
                <tr key={name}>
                  <th scope="row">{name}</th><td>{formatDiscount(scenario.discountBps)}</td>
                  <td>{formatPaise(scenario.courierPaise)}</td><td>{formatPaise(scenario.deliveryFeePaise)}</td>
                  <td data-sign={contributionTone(contributionPaise)}>{formatPaise(contributionPaise, true)}</td>
                  <td data-sign={contributionTone(delta)}>{formatPaise(delta, true)}</td>
                  <td><button className="clear-filters" type="button" onClick={() => onApply(scenario)}
                    aria-label={`Load strategy: ${name}`}>Load in lab</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
