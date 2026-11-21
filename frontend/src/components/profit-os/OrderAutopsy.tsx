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
      <h2 id="autopsy-heading"><ReceiptText size={20} aria-hidden="true" /> Order Autopsy</h2>
      <p>{catalog ? 'Catalog price and unsaved financial assumptions' : 'Illustrative order · Demo assumptions'}</p>
      <h3>{catalog ? 'Scenario revenue' : 'Illustrative revenue'}</h3>
      <dl className="profit-ledger">
        <LedgerRow label={catalog ? 'Catalog selling price' : 'Original merchandise price'} amount={price} />
        <LedgerRow label={rate !== null ? `Retailer discount (${formatDiscount(rate)})` : 'Retailer discount'}
          amount={sale ? -sale.discountPaise : null} />
        <LedgerRow label="Discounted merchandise" amount={sale?.discountedMerchandisePaise ?? null} />
        <LedgerRow label="Customer-paid delivery fee" amount={fee} />
        <LedgerRow label={catalog ? 'Total scenario revenue' : 'Total illustrative revenue'}
          amount={sale && fee !== null ? sale.discountedMerchandisePaise + fee : null} subtotal />
      </dl>
      <h3>Modeled expenses</h3>
      <dl className="profit-ledger">
        <LedgerRow label="Courier paid by retailer" amount={parseHundredths(input.courier)} />
        {expenseFields.filter(({ name }) => catalog || name !== 'labour' && name !== 'tax').map(({ name, label }) => (
          <LedgerRow key={name} label={label} amount={parseHundredths(input[name])} />
        ))}
        <LedgerRow label="Total modeled expenses" amount={result?.expensesPaise ?? null} subtotal />
      </dl>
      <dl className="profit-ledger profit-autopsy-total">
        <LedgerRow label={catalog ? 'Estimated contribution' : 'Baseline estimated contribution'}
          amount={result?.contributionPaise ?? null} signed />
      </dl>
    </section>
  )
}
