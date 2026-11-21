import { Lightbulb, SlidersHorizontal } from 'lucide-react'
import { Input } from '../ui/input'
import {
  advise, baseline, calculateScenario, completeScenario, contributionMarginBps, contributionTone, expenseFields,
  formatDiscount, formatPaise, labFields, parseHundredths, parseRate, toInputs,
  type ProductInputs, type Scenario, type ScenarioInputs,
} from '../../lib/profit-os'

type LabProps =
  | { inputs: ScenarioInputs; onChange: (field: keyof ScenarioInputs, value: string) => void; catalog?: undefined }
  | { catalog: {
      input: ProductInputs
      scenario: Scenario | null
      hasPrice: boolean
      editedFields: ReadonlySet<string>
      onChange: (field: keyof ProductInputs, value: string) => void
    } }

const baselineInputs = toInputs(baseline)

const baselineContribution = calculateScenario(baseline).contributionPaise

function SmartAdvisor({ scenario }: { scenario: Scenario }) {
  const recommendation = advise(scenario)
  const { shortfallPaise, discount } = recommendation
  const deliverySavings = scenario.courierPaise < 2000n ? scenario.courierPaise : 2000n
  return (
    <div className="profit-advice">
      <h3><Lightbulb size={19} aria-hidden="true" /> Suggestions for this sale</h3>
      <p>{shortfallPaise > 0n
        ? <>This scenario is {formatPaise(shortfallPaise)} short of covering its costs.</>
        : <>This sale covers the costs you entered.</>}</p>
      <p>{discount.kind === 'not_applicable' ? 'A discount threshold needs a positive merchandise price.'
        : discount.kind === 'unreachable' ? 'Even a 0% discount leaves a loss at these costs and fees.'
          : <>Maximum discount without a loss is <strong>{formatDiscount(discount.rate)}</strong>.
            {' '}{discount.contributionPaise === 0n ? 'That rate breaks even.' : <>That rate leaves {formatPaise(discount.contributionPaise)} contribution.</>}</>}</p>
      {shortfallPaise > 0n && <ul>
        <li>At the current discount, a customer delivery fee of {formatPaise(recommendation.minimumDeliveryFeePaise)} covers the shortfall.</li>
        <li>{recommendation.breakEvenCourierPaise === null
          ? <>Removing the entire courier cost still leaves a {formatPaise(recommendation.remainingLossWithoutCourierPaise)} loss.</>
          : <>Keeping the other inputs fixed, a courier cost of {formatPaise(recommendation.breakEvenCourierPaise)} breaks even.</>}</li>
      </ul>}
      {deliverySavings > 0n && <p>Reducing delivery cost by {formatPaise(deliverySavings)} could leave {formatPaise(deliverySavings)} more per order, assuming everything else stays the same.</p>}
      <p className="profit-caption">Break even means the sale covers its costs, with ₹0 left over.</p>
    </div>
  )
}

export function ProfitLab(props: LabProps) {
  const { catalog } = props
  const input = props.catalog ? props.catalog.input : { ...baselineInputs, ...props.inputs }
  const scenario = catalog ? catalog.scenario : completeScenario(baseline.merchandisePaise, input)
  const result = scenario && calculateScenario(scenario)
  const margin = result && contributionMarginBps(result)
  const fields = catalog
    ? [...labFields, ...expenseFields.map(({ name, label }) => ({ name, label: `${label} (₹)` }))]
    : labFields

  return (
    <section className="command-panel profit-lab" aria-labelledby="lab-heading">
      <h2 id="lab-heading"><SlidersHorizontal size={20} aria-hidden="true" /> Try Different Prices</h2>
      <p>{catalog ? 'Try your own costs for one item. Enter 0 when you have no cost to include.' : 'Change the discount or delivery amounts to see what happens.'}</p>
      <div className="profit-inputs" role="group" aria-label="Scenario inputs">
        {fields.map(({ name, label }) => {
          const value = input[name]
          const invalid = value.trim() !== '' && (name === 'discount' ? parseRate(value) : parseHundredths(value)) === null
          const error = name === 'discount' ? 'Enter 0–100% with up to two decimal places.'
            : 'Enter a non-negative amount with up to two decimal places.'
          return (
            <label className="filter-control" key={name}>
              <span className="profit-field-label"><span id={`profit-${name}-label`}>{label}</span>{catalog?.hasPrice && (
                <span id={`profit-${name}-source`} className="profit-field-source">
                  {catalog.editedFields.has(name) ? 'Your edit' : 'Demo estimate'}
                </span>
              )}</span>
              <Input id={`profit-${name}`} inputMode="decimal" maxLength={15} value={value}
                placeholder={catalog ? 'Unknown' : undefined} aria-invalid={invalid} aria-labelledby={`profit-${name}-label`}
                aria-describedby={[
                  catalog?.hasPrice && `profit-${name}-source`, invalid && `profit-${name}-error`,
                ].filter(Boolean).join(' ') || undefined}
                onChange={(event) => {
                  if (props.catalog) props.catalog.onChange(name, event.target.value)
                  else if (name === 'discount' || name === 'courier' || name === 'deliveryFee') props.onChange(name, event.target.value)
                }} />
              {invalid && <span id={`profit-${name}-error`} className="checkout-error">{error}</span>}
            </label>
          )
        })}
      </div>
      {scenario && result ? (
        <>
          <dl className="profit-results" aria-label="Scenario results">
            <div><dt>Money coming in</dt><dd>{formatPaise(result.revenuePaise)}</dd></div>
            <div><dt>Estimated costs</dt><dd>{formatPaise(result.expensesPaise)}</dd></div>
            <div className="profit-result-primary">
              <dt>Estimated contribution</dt>
              <dd data-sign={contributionTone(result.contributionPaise)} aria-live="polite">
                {formatPaise(result.contributionPaise, true)} <span className="retailer-result-word">
                  {result.contributionPaise < 0n ? 'Estimated loss' : result.contributionPaise > 0n ? 'Estimated gain' : 'Break even'}
                </span>
              </dd>
            </div>
            {catalog && <div><dt>Share of revenue left after costs</dt><dd data-sign={margin === null ? undefined : contributionTone(margin)}>
              {margin === null ? 'Unavailable' : formatDiscount(margin)}
            </dd></div>}
            {!catalog && <div><dt>Change from example sale</dt><dd data-sign={contributionTone(result.contributionPaise - baselineContribution)}>
              {formatPaise(result.contributionPaise - baselineContribution, true)}
            </dd></div>}
          </dl>
          <SmartAdvisor scenario={scenario} />
        </>
      ) : <p className="profit-validation" role="status">{catalog
        ? catalog.hasPrice ? 'Incomplete data. Enter valid amounts for all costs and scenario inputs to calculate an estimate.'
          : 'Incomplete data. The catalog selling price is unavailable.'
        : 'Enter valid scenario inputs to calculate an estimate.'}</p>}
    </section>
  )
}
