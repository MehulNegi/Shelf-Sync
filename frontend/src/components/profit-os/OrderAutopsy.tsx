import { ReceiptText } from 'lucide-react'
import { baseline, calculateScenario, formatDiscount, formatPaise } from '../../lib/profit-os'

const result = calculateScenario(baseline)

export function OrderAutopsy() {
  return (
    <section className="command-panel profit-autopsy" aria-labelledby="autopsy-heading">
      <h2 id="autopsy-heading"><ReceiptText size={20} aria-hidden="true" /> Order Autopsy</h2>
      <p>Illustrative order · Demo assumptions</p>
      <h3>Illustrative revenue</h3>
      <dl className="profit-ledger">
        <div><dt>Original merchandise price</dt><dd>{formatPaise(baseline.merchandisePaise)}</dd></div>
        <div><dt>Retailer discount ({formatDiscount(baseline.discountBps)})</dt><dd>{formatPaise(-result.discountPaise)}</dd></div>
        <div><dt>Discounted merchandise</dt><dd>{formatPaise(result.discountedMerchandisePaise)}</dd></div>
        <div><dt>Customer-paid delivery fee</dt><dd>{formatPaise(baseline.deliveryFeePaise)}</dd></div>
        <div className="profit-subtotal"><dt>Total illustrative revenue</dt><dd>{formatPaise(result.revenuePaise)}</dd></div>
      </dl>
      <h3>Modeled expenses</h3>
      <dl className="profit-ledger">
        <div><dt>Acquisition</dt><dd>{formatPaise(baseline.acquisitionPaise)}</dd></div>
        <div><dt>Courier paid by retailer</dt><dd>{formatPaise(baseline.courierPaise)}</dd></div>
        <div><dt>Packaging</dt><dd>{formatPaise(baseline.packagingPaise)}</dd></div>
        <div><dt>Payment processing</dt><dd>{formatPaise(baseline.paymentPaise)}</dd></div>
        <div><dt>Marketing</dt><dd>{formatPaise(baseline.marketingPaise)}</dd></div>
        <div className="profit-subtotal"><dt>Total modeled expenses</dt><dd>{formatPaise(result.expensesPaise)}</dd></div>
      </dl>
      <dl className="profit-ledger profit-autopsy-total"><div>
        <dt>Baseline estimated contribution</dt><dd data-sign="loss">{formatPaise(result.contributionPaise, true)}</dd>
      </div></dl>
    </section>
  )
}
