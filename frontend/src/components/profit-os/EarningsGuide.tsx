import { useRef } from 'react'
import {
  advise, calculateScenario, completeScenario, contributionMarginBps, contributionTone, displayInput,
  expenseFields, formatDiscount, formatPaise, labFields, parseHundredths, parseRate, toInputs,
  type ProductInputs, type Scenario,
} from '../../lib/profit-os'
import { expenseGroups, improvementOptions } from '../../lib/profit-os-guidance'
import { Input } from '../ui/input'
import { StrategyComparison } from './StrategyComparison'

interface EarningsGuideProps {
  price: bigint | null
  input: ProductInputs
  editedFields: ReadonlySet<string>
  onEdit: (fields: Partial<ProductInputs>) => void
}

export function EarningsGuide({ price, input, editedFields, onEdit }: EarningsGuideProps) {
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const scenario = completeScenario(price, input)
  const result = scenario && calculateScenario(scenario)
  const margin = result && contributionMarginBps(result)
  const discount = scenario && advise(scenario).discount
  const options = scenario ? improvementOptions(scenario) : []

  function apply(fields: Partial<ProductInputs>) {
    onEdit(fields)
    resultHeading.current?.focus()
  }

  function applyStrategy(next: Scenario) {
    const values = toInputs(next)
    const changes: Partial<ProductInputs> = {}
    for (const { name } of [...labFields, ...expenseFields]) {
      if (input[name] !== values[name]) changes[name] = values[name]
    }
    apply(changes)
  }

  return (
    <div className="earnings-guide">
      <section className="command-panel earnings-result" aria-labelledby="earnings-result-heading">
        <h2 id="earnings-result-heading" ref={resultHeading} tabIndex={-1}>Am I earning or losing money?</h2>
        <div role="status">
          {result ? (
            <div className="earnings-outcome" data-sign={contributionTone(result.contributionPaise)}>
              <strong>{formatPaise(result.contributionPaise, true)}</strong>
              <span>{result.contributionPaise > 0n ? 'Estimated gain' : result.contributionPaise < 0n ? 'Estimated loss' : 'Break even'}</span>
            </div>
          ) : <p>{price === null ? 'The catalog selling price is unavailable.' : 'Fill in the missing or invalid amounts under “See all costs and edit details” to see an estimate.'}</p>}
        </div>
        <p>Estimated money left after the costs below. Your final take-home profit may differ.</p>
        {result && <dl className="earnings-totals">
          <div><dt>Money received</dt><dd>{formatPaise(result.revenuePaise)}</dd></div>
          <div><dt>Total estimated expenses</dt><dd>{formatPaise(result.expensesPaise)}</dd></div>
        </dl>}
      </section>

      <section className="command-panel" aria-labelledby="earnings-spending-heading">
        <h2 id="earnings-spending-heading">Where does my money go?</h2>
        {scenario && result ? <dl className="earnings-bars">
          {expenseGroups(scenario).map(({ label, amount }) => (
            <div key={label}>
              <dt>{label}</dt><dd>{formatPaise(amount)}</dd>
              <dd className="earnings-bar" aria-hidden="true"><span style={{
                width: result.expensesPaise === 0n ? '0%' : formatDiscount(amount * 10_000n / result.expensesPaise),
              }} /></dd>
            </div>
          ))}
        </dl> : <p>The expense breakdown appears once the estimate is complete.</p>}
      </section>

      <section className="command-panel" aria-labelledby="earnings-improve-heading">
        <h2 id="earnings-improve-heading">What can I change to improve it?</h2>
        <p>Try changing one amount at a time to see how it affects this sale.</p>
        <div className="earnings-sliders">
          {labFields.filter(({ name }) => name !== 'deliveryFee').map(({ name, label }) => {
            const isDiscount = name === 'discount'
            const parsed = isDiscount ? parseRate(input[name]) : parseHundredths(input[name])
            const amount = parsed ?? 0n
            // A minimum ₹500 range keeps routine edits stable. Larger exact entries fit on the same slider.
            const max = isDiscount ? 10_000n : amount > 50_000n ? ((amount + 49_999n) / 50_000n) * 50_000n : 50_000n
            const valueText = parsed === null ? 'Enter a valid amount in details' : isDiscount ? formatDiscount(amount) : formatPaise(amount)
            return (
              <label key={name}>
                <span>{label} <strong aria-hidden="true">{valueText}</strong></span>
                <input type="range" min={0} max={String(max)} value={String(amount)} step={1}
                  disabled={price === null} aria-label={label} aria-valuetext={valueText} aria-describedby={`earnings-${name}-source`}
                  onChange={(event) => onEdit({ [name]: displayInput(BigInt(event.target.value)) })} />
                <small id={`earnings-${name}-source`}>{editedFields.has(name) ? 'Your edit' : price === null ? 'Price unavailable' : 'Sample value'}</small>
              </label>
            )
          })}
        </div>
        {options.length > 0 && (
          <div className="earnings-suggestions">
            <h3>Ideas to try</h3>
            {options.map(({ label, fields }) => (
              <button key={label} className="clear-filters" type="button" onClick={() => apply(fields)}>{label}</button>
            ))}
          </div>
        )}
      </section>

      <details className="command-panel retailer-details earnings-details">
        <summary>See all costs and edit details</summary>
        <p>Enter exact amounts for one item. Use zero when there is no cost to include.</p>
        <div className="profit-inputs">
          {[...labFields, ...expenseFields.map(({ name, label }) => ({ name, label: `${label} (₹)` }))].map(({ name, label }) => {
            const value = input[name]
            const invalid = !!value.trim() && (name === 'discount' ? parseRate(value) : parseHundredths(value)) === null
            return (
              <label className="filter-control" key={name}>
                <span id={`profit-${name}-label`}>{label}</span>
                <span id={`profit-${name}-source`} className="profit-field-source">
                  {editedFields.has(name) ? 'Your edit' : price === null ? 'Price unavailable' : 'Sample value'}
                </span>
                <Input id={`profit-${name}`} value={value} placeholder="Unknown" inputMode="decimal" maxLength={15}
                  aria-labelledby={`profit-${name}-label`} aria-invalid={invalid}
                  aria-describedby={`profit-${name}-source${invalid ? ` profit-${name}-error` : ''}`}
                  onChange={(event) => onEdit({ [name]: event.target.value })} />
                {invalid && <span id={`profit-${name}-error`} className="checkout-error">
                  {name === 'discount' ? 'Enter 0–100% with up to two decimal places.' : 'Enter a non-negative amount with up to two decimal places.'}
                </span>}
                <small id={`earnings-${name}-source`}>{editedFields.has(name) ? 'Your edit' : price === null ? 'Price unavailable' : 'Sample value'}</small>
              </label>
            )
          })}
        </div>
        {result && <dl className="earnings-totals">
          <div><dt>Product price after discount</dt><dd>{formatPaise(result.discountedMerchandisePaise)}</dd></div>
          <div><dt>Share of money received left after costs</dt><dd>{margin === null ? 'Unavailable' : formatDiscount(margin)}</dd></div>
          <div><dt>Largest discount that still covers costs</dt><dd>{discount?.kind === 'available' ? formatDiscount(discount.rate)
            : discount?.kind === 'unreachable' ? 'Even a 0% discount leaves a loss' : 'Requires a product price above ₹0'}</dd></div>
        </dl>}
        <StrategyComparison catalogScenario={scenario} onApply={applyStrategy} />
      </details>
    </div>
  )
}
