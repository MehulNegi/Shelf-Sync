import { ReceiptText } from 'lucide-react'
import {
  baseline, calculateMerchandise, calculateScenario, contributionTone, expenseFields, formatDiscount,
  formatPaise, parseHundredths, parseRate, toInputs, type ProductInputs, type Scenario,
} from '../../lib/profit-os'

interface AutopsyProps {
  catalog?: { price: bigint | null; input: ProductInputs }
  scenario?: Scenario | null
}

const baselineInputs = toInputs(baseline)

function LedgerRow({ label, amount, subtotal, signed }: { label: string; amount: bigint | null; subtotal?: boolean; signed?: boolean }) {
  return (
    <div className={subtotal ? 'profit-subtotal' : undefined}>
      <dt>{label}</dt>
      <dd data-sign={signed && amount !== null ? contributionTone(amount) : undefined}>
        {amount === null ? 'Unknown' : formatPaise(amount, signed)}
      </dd>
    </div>
  )
}

export function OrderAutopsy({ catalog, scenario = baseline }: AutopsyProps) {
  const price = catalog ? catalog.price : baseline.merchandisePaise
  const input = catalog?.input ?? baselineInputs
  const rate = parseRate(input.discount)
  const fee = parseHundredths(input.deliveryFee)
  const sale = price !== null && rate !== null ? calculateMerchandise(price, rate) : null
  const result = scenario && calculateScenario(scenario)

  return (
    <section className="command-panel profit-autopsy" aria-labelledby="autopsy-heading">
      <h2 id="autopsy-heading"><ReceiptText size={20} aria-hidden="true" /> Where My Money Goes</h2>
      <p>{catalog ? 'Catalog selling price with sample costs and your edits' : 'Example sale with sample costs'}</p>
      <dl className="profit-ledger profit-autopsy-total">
        <LedgerRow label={catalog ? 'Estimated contribution' : 'Example sale: estimated contribution'}
          amount={result?.contributionPaise ?? null} signed />
      </dl>
      <p>Money left after the costs you entered. Your final take-home profit may differ.</p>
      <h3>Money coming in</h3>
      <dl className="profit-ledger">
        <LedgerRow label={catalog ? 'Catalog selling price' : 'Original product price'} amount={price} />
        <LedgerRow label={rate !== null ? `Retailer discount (${formatDiscount(rate)})` : 'Retailer discount'}
          amount={sale ? -sale.discountPaise : null} />
        <LedgerRow label="Product price after discount" amount={sale?.discountedMerchandisePaise ?? null} />
        <LedgerRow label="Delivery fee the customer pays" amount={fee} />
        <LedgerRow label="Total money coming in"
          amount={sale && fee !== null ? sale.discountedMerchandisePaise + fee : null} subtotal />
      </dl>
      <h3>Estimated costs</h3>
      <dl className="profit-ledger">
        <LedgerRow label="Delivery cost you pay" amount={parseHundredths(input.courier)} />
        {expenseFields.filter(({ name }) => catalog || name !== 'labour' && name !== 'tax').map(({ name, label }) => (
          <LedgerRow key={name} label={label} amount={parseHundredths(input[name])} />
        ))}
        <LedgerRow label="Total estimated costs" amount={result?.expensesPaise ?? null} subtotal />
      </dl>
    </section>
  )
}
