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
      <h2 id="strategy-heading"><GitCompareArrows size={20} aria-hidden="true" /> Ways to Earn More</h2>
      <p>{options.length > 1 ? 'Compare the options, then pick one to try with your estimate.'
        : options.length === 1 ? 'Adjust the discount or delivery fee to compare options.'
          : 'Fill in the costs above to compare options.'}</p>
      {reference !== undefined && <ul className="retailer-strategies">
        {options.map(({ name, scenario }) => {
          const { contributionPaise } = calculateScenario(scenario)
          const delta = contributionPaise - reference
          const title = name === 'Baseline' ? 'Original example'
            : name === 'Apply both adjustments' ? 'Lower discount and delivery cost'
              : name.replace(/courier/i, 'delivery')
          return (
            <li key={name}>
              <h3>{title}</h3>
              <dl>
                <div><dt>Discount</dt><dd>{formatDiscount(scenario.discountBps)}</dd></div>
                <div><dt>Delivery cost you pay</dt><dd>{formatPaise(scenario.courierPaise)}</dd></div>
                <div><dt>Delivery fee the customer pays</dt><dd>{formatPaise(scenario.deliveryFeePaise)}</dd></div>
                <div><dt>Estimated contribution</dt><dd data-sign={contributionTone(contributionPaise)}>{formatPaise(contributionPaise, true)}</dd></div>
                <div><dt>{demo ? 'Change from example' : 'Change from current estimate'}</dt><dd data-sign={contributionTone(delta)}>{formatPaise(delta, true)}</dd></div>
              </dl>
              <button className="clear-filters" type="button" onClick={() => onApply(scenario)}
                aria-label={`Try this option: ${title}`}>Try this option</button>
            </li>
          )
        })}
      </ul>}
    </section>
  )
}
