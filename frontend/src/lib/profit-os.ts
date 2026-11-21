const fullRate = 10_000n

export interface Scenario {
  merchandisePaise: bigint
  discountBps: bigint
  acquisitionPaise: bigint
  courierPaise: bigint
  packagingPaise: bigint
  paymentPaise: bigint
  marketingPaise: bigint
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

export function calculateScenario(scenario: Scenario) {
  const discountPaise = roundedDiscount(scenario.merchandisePaise, scenario.discountBps)
  const discountedMerchandisePaise = scenario.merchandisePaise - discountPaise
  const revenuePaise = discountedMerchandisePaise + scenario.deliveryFeePaise
  const expensesPaise = scenario.acquisitionPaise + scenario.courierPaise + scenario.packagingPaise +
    scenario.paymentPaise + scenario.marketingPaise
  return {
    discountPaise, discountedMerchandisePaise, revenuePaise, expensesPaise,
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
