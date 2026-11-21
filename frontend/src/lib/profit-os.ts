const fullRate = 10_000n

export interface Scenario {
  merchandisePaise: bigint
  discountBps: bigint
  acquisitionPaise: bigint
  courierPaise: bigint
  packagingPaise: bigint
  paymentPaise: bigint
  marketingPaise: bigint
  labourPaise: bigint
  taxPaise: bigint
  deliveryFeePaise: bigint
}

export const baseline: Readonly<Scenario> = {
  merchandisePaise: 200_000n,
  discountBps: 2_000n,
  acquisitionPaise: 125_000n,
  courierPaise: 18_000n,
  packagingPaise: 3_000n,
  paymentPaise: 4_000n,
  marketingPaise: 15_000n,
  labourPaise: 0n,
  taxPaise: 0n,
  deliveryFeePaise: 0n,
}

export function parseHundredths(value: string): bigint | null {
  const match = /^([0-9]{1,12})(?:\.([0-9]{1,2}))?$/.exec(value.trim())
  if (!match) return null
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}

function roundedDiscount(price: bigint, rate: bigint) {
  return (price * rate + fullRate / 2n) / fullRate
}

export function calculateMerchandise(price: bigint, rate: bigint) {
  const discountPaise = roundedDiscount(price, rate)
  return { discountPaise, discountedMerchandisePaise: price - discountPaise }
}

export function calculateScenario(scenario: Scenario) {
  const merchandise = calculateMerchandise(scenario.merchandisePaise, scenario.discountBps)
  const revenuePaise = merchandise.discountedMerchandisePaise + scenario.deliveryFeePaise
  const expensesPaise = scenario.acquisitionPaise + scenario.courierPaise + scenario.packagingPaise +
    scenario.paymentPaise + scenario.marketingPaise + scenario.labourPaise + scenario.taxPaise
  return {
    ...merchandise, revenuePaise, expensesPaise,
    contributionPaise: revenuePaise - expensesPaise,
  }
}

export function breakEvenDiscount(scenario: Scenario) {
  const { merchandisePaise, deliveryFeePaise } = scenario
  const { expensesPaise } = calculateScenario(scenario)
  const allowance = merchandisePaise + deliveryFeePaise - expensesPaise
  if (merchandisePaise === 0n) return { kind: 'not_applicable' } as const
  if (allowance < 0n) return { kind: 'unreachable' } as const

  // Invert round-half-up exactly. The last acceptable numerator is strictly below the next paise.
  const maxRate = (allowance * fullRate + fullRate / 2n - 1n) / merchandisePaise
  const rate = maxRate < fullRate ? maxRate : fullRate
  return { kind: 'available', rate, contributionPaise: allowance - roundedDiscount(merchandisePaise, rate) } as const
}

export function advise(scenario: Scenario) {
  const { contributionPaise } = calculateScenario(scenario)
  const shortfallPaise = contributionPaise < 0n ? -contributionPaise : 0n
  return {
    shortfallPaise,
    minimumDeliveryFeePaise: scenario.deliveryFeePaise + shortfallPaise,
    breakEvenCourierPaise: shortfallPaise <= scenario.courierPaise ? scenario.courierPaise - shortfallPaise : null,
    remainingLossWithoutCourierPaise: shortfallPaise > scenario.courierPaise ? shortfallPaise - scenario.courierPaise : 0n,
    discount: breakEvenDiscount(scenario),
  }
}

const rupees = new Intl.NumberFormat('en-IN')

function decimalPart(amount: bigint) {
  const remainder = amount % 100n
  return remainder === 0n ? '' : `.${String(remainder).padStart(2, '0').replace(/0$/, '')}`
}

export function formatPaise(amount: bigint, signed = false) {
  const sign = amount < 0n ? '−' : signed && amount > 0n ? '+' : ''
  const magnitude = amount < 0n ? -amount : amount
  const cents = String(magnitude % 100n).padStart(2, '0')
  return `${sign}₹${rupees.format(magnitude / 100n)}${cents === '00' ? '' : `.${cents}`}`
}

export function formatDiscount(rate: bigint) {
  return `${rate / 100n}${decimalPart(rate)}%`
}

export function displayInput(amount: bigint) {
  return `${amount / 100n}${decimalPart(amount)}`
}

export function contributionTone(value: bigint) {
  return value < 0n ? 'loss' : value > 0n ? 'gain' : 'even'
}

export const strategies = [
  { name: 'Baseline', scenario: baseline },
  { name: 'Lower discount', scenario: { ...baseline, discountBps: 1_500n } },
  { name: 'Lower courier cost', scenario: { ...baseline, courierPaise: 12_000n } },
  { name: 'Apply both adjustments', scenario: { ...baseline, discountBps: 1_500n, courierPaise: 12_000n } },
] as const

export const labFields = [
  { name: 'discount', label: 'Retailer discount (%)' },
  { name: 'courier', label: 'Courier cost (₹)' },
  { name: 'deliveryFee', label: 'Customer delivery fee (₹)' },
] as const

export const expenseFields = [
  { name: 'acquisition', label: 'Acquisition' },
  { name: 'packaging', label: 'Packaging' },
  { name: 'payment', label: 'Payment processing' },
  { name: 'marketing', label: 'Marketing' },
  { name: 'labour', label: 'Labour' },
  { name: 'tax', label: 'Non-recoverable taxes' },
] as const

type LabField = typeof labFields[number]['name']
type ExpenseField = typeof expenseFields[number]['name']
export type ScenarioInputs = Record<LabField, string>
export type ProductInputs = Record<LabField | ExpenseField, string>

export const emptyProductInputs: Readonly<ProductInputs> = {
  discount: '0', deliveryFee: '0', courier: '', acquisition: '', packaging: '', payment: '',
  marketing: '', labour: '', tax: '',
}

export function parseRate(text: string) {
  const rate = parseHundredths(text)
  return rate !== null && rate <= fullRate ? rate : null
}

export function catalogPricePaise(price: unknown) {
  return typeof price === 'number' && Number.isFinite(price) ? parseHundredths(String(price)) : null
}

export function completeScenario(price: bigint | null, input: ProductInputs): Scenario | null {
  const discountBps = parseRate(input.discount)
  const courierPaise = parseHundredths(input.courier)
  const deliveryFeePaise = parseHundredths(input.deliveryFee)
  const acquisitionPaise = parseHundredths(input.acquisition)
  const packagingPaise = parseHundredths(input.packaging)
  const paymentPaise = parseHundredths(input.payment)
  const marketingPaise = parseHundredths(input.marketing)
  const labourPaise = parseHundredths(input.labour)
  const taxPaise = parseHundredths(input.tax)
  if (price === null || discountBps === null || courierPaise === null || deliveryFeePaise === null ||
      acquisitionPaise === null || packagingPaise === null || paymentPaise === null ||
      marketingPaise === null || labourPaise === null || taxPaise === null) return null
  return {
    merchandisePaise: price, discountBps, courierPaise, deliveryFeePaise, acquisitionPaise,
    packagingPaise, paymentPaise, marketingPaise, labourPaise, taxPaise,
  }
}

export function toInputs(scenario: Scenario): ProductInputs {
  return {
    discount: displayInput(scenario.discountBps),
    courier: displayInput(scenario.courierPaise),
    deliveryFee: displayInput(scenario.deliveryFeePaise),
    acquisition: displayInput(scenario.acquisitionPaise),
    packaging: displayInput(scenario.packagingPaise),
    payment: displayInput(scenario.paymentPaise),
    marketing: displayInput(scenario.marketingPaise),
    labour: displayInput(scenario.labourPaise),
    tax: displayInput(scenario.taxPaise),
  }
}

export function productStrategies(scenario: Scenario) {
  const options = [{ name: 'Current assumptions', scenario }]
  const { discount, shortfallPaise, breakEvenCourierPaise, minimumDeliveryFeePaise } = advise(scenario)
  if (shortfallPaise > 0n) {
    if (discount.kind === 'available' && discount.rate < scenario.discountBps) {
      options.push({ name: 'Reduce to the break-even discount', scenario: { ...scenario, discountBps: discount.rate } })
    }
    if (breakEvenCourierPaise !== null) {
      options.push({ name: 'Reduce courier cost to break even', scenario: { ...scenario, courierPaise: breakEvenCourierPaise } })
    }
    options.push({ name: 'Cover the shortfall with delivery fees', scenario: { ...scenario, deliveryFeePaise: minimumDeliveryFeePaise } })
  } else {
    if (scenario.discountBps > 0n) options.push({ name: 'Remove the discount', scenario: { ...scenario, discountBps: 0n } })
    if (scenario.deliveryFeePaise > 0n) options.push({ name: 'Waive the delivery fee', scenario: { ...scenario, deliveryFeePaise: 0n } })
  }
  return options
}
