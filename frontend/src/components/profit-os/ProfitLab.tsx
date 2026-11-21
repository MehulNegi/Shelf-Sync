import { Lightbulb, SlidersHorizontal } from 'lucide-react'
import { Input } from '../ui/input'
import {
  advise, baseline, calculateScenario, completeScenario, contributionTone, expenseFields,
  formatDiscount, formatPaise, labFields, parseHundredths, parseRate, toInputs,
  type ProductInputs, type Scenario, type ScenarioInputs,
} from '../../lib/profit-os'

type LabProps =
  | { inputs: ScenarioInputs; onChange: (field: keyof ScenarioInputs, value: string) => void; catalog?: undefined }
  | { catalog: {
      input: ProductInputs
      scenario: Scenario | null
      hasPrice: boolean
      onChange: (field: keyof ProductInputs, value: string) => void
    } }

const baselineInputs = toInputs(baseline)

const baselineContribution = calculateScenario(baseline).contributionPaise

function SmartAdvisor({ scenario }: { scenario: Scenario }) {
  const recommendation = advise(scenario)
  const { shortfallPaise, discount } = recommendation
  return (
    <div className="profit-advice">
      <h3><Lightbulb size={19} aria-hidden="true" /> Smart Profit Advisor</h3>
      <p>{shortfallPaise > 0n
        ? <>This scenario is {formatPaise(shortfallPaise)} short of break-even.</>
        : <>This scenario covers its modeled expenses.</>}</p>
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
      <p className="profit-caption">Rules compare the entered values. Demand and other expenses stay fixed.</p>
    </div>
  )
}

export function ProfitLab(props: LabProps) {
  const { catalog } = props
  const input = props.catalog ? props.catalog.input : { ...baselineInputs, ...props.inputs }
  const scenario = catalog ? catalog.scenario : completeScenario(baseline.merchandisePaise, input)
  const result = scenario && calculateScenario(scenario)
  const fields = catalog
    ? [...labFields, ...expenseFields.map(({ name, label }) => ({ name, label: `${label} cost (₹)` }))]
    : labFields

  return (
    <section className="command-panel profit-lab" aria-labelledby="lab-heading">
      <h2 id="lab-heading"><SlidersHorizontal size={20} aria-hidden="true" /> Loss Prevention Lab</h2>
      <p>{catalog ? 'Unsaved financial assumptions per unit. Enter 0 only when you intend to model no expense.' : 'Change the assumptions to compare estimated outcomes.'}</p>
      <div className="profit-inputs" role="group" aria-label="Scenario inputs">
        {fields.map(({ name, label }) => {
          const value = input[name]
          const invalid = value.trim() !== '' && (name === 'discount' ? parseRate(value) : parseHundredths(value)) === null
          const error = name === 'discount' ? 'Enter 0–100% with up to two decimal places.'
            : 'Enter a non-negative amount with up to two decimal places.'
          return (
            <label className="filter-control" key={name}>
              {label}
              <Input id={`profit-${name}`} inputMode="decimal" maxLength={15} value={value}
                placeholder={catalog ? 'Unknown' : undefined} aria-invalid={invalid}
                aria-describedby={invalid ? `profit-${name}-error` : undefined}
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
            <div><dt>Scenario revenue</dt><dd>{formatPaise(result.revenuePaise)}</dd></div>
            <div><dt>Modeled expenses</dt><dd>{formatPaise(result.expensesPaise)}</dd></div>
            <div className="profit-result-primary">
              <dt>Estimated contribution</dt>
              <dd data-sign={contributionTone(result.contributionPaise)} aria-live="polite">
                {formatPaise(result.contributionPaise, true)}
              </dd>
            </div>
            {!catalog && <div><dt>Change vs baseline</dt><dd data-sign={contributionTone(result.contributionPaise - baselineContribution)}>
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
