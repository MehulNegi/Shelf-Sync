import { advise, calculateScenario, displayInput, formatDiscount, formatPaise, type ProductInputs, type Scenario } from './profit-os'

export function expenseGroups(scenario: Scenario) {
  return [
    { label: 'Product purchase cost', amount: scenario.acquisitionPaise },
    { label: 'Delivery and packaging', amount: scenario.courierPaise + scenario.packagingPaise },
    { label: 'Other expenses', amount: scenario.paymentPaise + scenario.marketingPaise + scenario.labourPaise + scenario.taxPaise },
  ]
}

export function improvementOptions(scenario: Scenario) {
  const options: { label: string; fields: Partial<ProductInputs> }[] = []
  const { discount } = advise(scenario)
  const current = calculateScenario(scenario).contributionPaise
  const smallerDiscount = discount.kind === 'available' && discount.rate < scenario.discountBps
    ? discount.rate
    : scenario.discountBps > 500n ? scenario.discountBps - 500n : 0n
  if (smallerDiscount < scenario.discountBps &&
      calculateScenario({ ...scenario, discountBps: smallerDiscount }).contributionPaise > current) {
    options.push({ label: `Try a smaller discount of ${formatDiscount(smallerDiscount)}`, fields: { discount: displayInput(smallerDiscount) } })
  }

  const saving = scenario.courierPaise < 2000n ? scenario.courierPaise : 2000n
  if (saving > 0n) {
    options.push({ label: `Try spending ${formatPaise(saving)} less on delivery`, fields: { courier: displayInput(scenario.courierPaise - saving) } })
  }
  return options
}
