import { Lightbulb, SlidersHorizontal } from 'lucide-react'
import { Input } from '../ui/input'
import { advise, baseline, calculateScenario, contributionTone, formatDiscount, formatPaise, parseHundredths, type Scenario } from '../../lib/profit-os'

export interface ScenarioInputs {
  discount: string
  courier: string
  deliveryFee: string
}

interface LabProps {
  inputs: ScenarioInputs
  onChange: (field: keyof ScenarioInputs, value: string) => void
}

const fields = [
  { name: 'discount', label: 'Retailer discount (%)', error: 'Enter 0–100% with up to two decimal places.' },
  { name: 'courier', label: 'Courier cost (₹)', error: 'Enter a non-negative amount with up to two decimal places.' },
  { name: 'deliveryFee', label: 'Customer delivery fee (₹)', error: 'Enter a non-negative amount with up to two decimal places.' },
] as const

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

export function ProfitLab({ inputs, onChange }: LabProps) {
  const parsedDiscount = parseHundredths(inputs.discount)
  const discount = parsedDiscount !== null && parsedDiscount <= 10_000n ? parsedDiscount : null
  const courier = parseHundredths(inputs.courier)
  const deliveryFee = parseHundredths(inputs.deliveryFee)
  const values = { discount, courier, deliveryFee }
  const scenario = discount === null || courier === null || deliveryFee === null ? null : {
    ...baseline, discountBps: discount, courierPaise: courier, deliveryFeePaise: deliveryFee,
  }
  const result = scenario && calculateScenario(scenario)

  return (
    <section className="command-panel profit-lab" aria-labelledby="lab-heading">
      <h2 id="lab-heading"><SlidersHorizontal size={20} aria-hidden="true" /> Loss Prevention Lab</h2>
      <p>Change the assumptions to compare estimated outcomes.</p>
      <div className="profit-inputs" role="group" aria-label="Scenario inputs">
        {fields.map(({ name, label, error }) => (
          <label className="filter-control" key={name}>
            {label}
            <Input id={`profit-${name}`} inputMode="decimal" maxLength={15} value={inputs[name]}
              aria-invalid={values[name] === null}
              aria-describedby={values[name] === null ? `profit-${name}-error` : undefined}
              onChange={(event) => onChange(name, event.target.value)} />
            {values[name] === null && <span id={`profit-${name}-error`} className="checkout-error">{error}</span>}
          </label>
        ))}
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
            <div><dt>Change vs baseline</dt><dd data-sign={contributionTone(result.contributionPaise - baselineContribution)}>
              {formatPaise(result.contributionPaise - baselineContribution, true)}
            </dd></div>
          </dl>
          <SmartAdvisor scenario={scenario} />
        </>
      ) : <p className="profit-validation" role="status">Enter valid scenario inputs to calculate an estimate.</p>}
    </section>
  )
}
