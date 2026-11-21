import { GitCompareArrows } from 'lucide-react'
import { calculateScenario, contributionTone, formatDiscount, formatPaise, productStrategies, strategies, type Scenario } from '../../lib/profit-os'

export function StrategyComparison({ onApply, catalogScenario }: {
  onApply: (scenario: Scenario) => void
  catalogScenario?: Scenario | null
}) {
  const demo = catalogScenario === undefined
  const options = demo ? strategies : catalogScenario ? productStrategies(catalogScenario) : []
  const reference = options[0] && calculateScenario(options[0].scenario).contributionPaise

  return (
    <section className="command-panel profit-strategies" aria-labelledby="strategy-heading">
      <h2 id="strategy-heading"><GitCompareArrows size={20} aria-hidden="true" /> Strategy comparison</h2>
      <p>{demo ? 'Compare demo strategies against the baseline, then load one into the lab.'
        : options.length > 1 ? 'Compare modeled alternatives against the current assumptions.'
          : options.length === 1 ? 'Adjust the discount or delivery fee to compare alternatives.'
            : 'Complete the product assumptions to compare strategies.'}</p>
      {reference !== undefined && <div className="command-table-wrap" tabIndex={0} role="region" aria-label="ProfitOS strategy comparison">
        <table className="command-table profit-strategy-table">
          <thead>
            <tr>
              <th scope="col">Strategy</th><th scope="col">Discount</th><th scope="col">Courier</th>
              <th scope="col">Delivery fee</th><th scope="col">Estimated contribution</th>
              <th scope="col">{demo ? 'Change vs baseline' : 'Change vs current'}</th><th scope="col" aria-label="Load strategy" />
            </tr>
          </thead>
          <tbody>
            {options.map(({ name, scenario }) => {
              const { contributionPaise } = calculateScenario(scenario)
              const delta = contributionPaise - reference
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
      </div>}
    </section>
  )
}
