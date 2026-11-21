import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const {
  baseline, calculateScenario, breakEvenDiscount, advise, parseHundredths, formatPaise, formatDiscount, strategies,
} = await vite.ssrLoadModule('/src/lib/profit-os.ts')
const { ProfitOS } = await vite.ssrLoadModule('/src/pages/ProfitOS.tsx')
const { ProfitLab } = await vite.ssrLoadModule('/src/components/profit-os/ProfitLab.tsx')
after(() => vite.close())

test('the illustrative autopsy balances in integer paise and all strategies match the specification', () => {
  assert.deepEqual(calculateScenario(baseline), {
    discountPaise: 40_000n, discountedMerchandisePaise: 160_000n, revenuePaise: 160_000n,
    expensesPaise: 165_000n, contributionPaise: -5_000n,
  })
  assert.deepEqual(strategies.map(({ scenario }) => calculateScenario(scenario).contributionPaise),
    [-5_000n, 5_000n, 1_000n, 11_000n])
  assert.equal(breakEvenDiscount(baseline).rate, 1_750n)
  assert.equal(calculateScenario({ ...baseline, discountBps: 1_750n }).contributionPaise, 0n)
  assert.equal(calculateScenario({ ...baseline, discountBps: 1_751n }).contributionPaise, -20n)
})

test('delivery fees affect revenue independently of courier costs', () => {
  const withFee = calculateScenario({ ...baseline, deliveryFeePaise: 5_000n })
  assert.equal(withFee.discountPaise, 40_000n)
  assert.equal(withFee.expensesPaise, 165_000n)
  assert.equal(withFee.revenuePaise, 165_000n)
  assert.equal(withFee.contributionPaise, 0n)
  const cheaperCourier = calculateScenario({ ...baseline, courierPaise: 12_000n })
  assert.equal(cheaperCourier.revenuePaise, 160_000n)
  assert.equal(cheaperCourier.expensesPaise, 159_000n)
})

test('input parsing and formatting are exact and reject invalid decimal syntax', () => {
  assert.equal(parseHundredths(' 15.01 '), 1_501n)
  assert.equal(parseHundredths('0.1'), 10n)
  assert.equal(parseHundredths('0'), 0n)
  assert.equal(parseHundredths('999999999999.99'), 99_999_999_999_999n)
  for (const input of ['', '-1', '1e3', '+2', '1,000', '0.001', '1.']) assert.equal(parseHundredths(input), null)
  assert.equal(formatPaise(-12_345_670n), '−₹1,23,456.70')
  assert.equal(formatPaise(11_000n, true), '+₹110')
  assert.equal(formatDiscount(1_750n), '17.5%')
  assert.equal(formatDiscount(1_501n), '15.01%')
})

test('break-even handles rounded paise ties, no feasible rate, zero price and the 100% cap', () => {
  const noCosts = { ...baseline, acquisitionPaise: 0n, courierPaise: 0n, packagingPaise: 0n,
    paymentPaise: 0n, marketingPaise: 0n }
  const cent = { ...noCosts, merchandisePaise: 1n, acquisitionPaise: 1n, discountBps: 5_000n }
  assert.equal(calculateScenario(cent).discountPaise, 1n)
  assert.equal(calculateScenario({ ...cent, discountBps: 4_999n }).discountPaise, 0n)
  assert.deepEqual(breakEvenDiscount(cent), { kind: 'available', rate: 4_999n, contributionPaise: 0n })
  assert.deepEqual(breakEvenDiscount({ ...baseline, courierPaise: 100_000n }), { kind: 'unreachable' })
  assert.deepEqual(breakEvenDiscount({ ...baseline, merchandisePaise: 0n }), { kind: 'not_applicable' })
  assert.deepEqual(breakEvenDiscount(noCosts), { kind: 'available', rate: 10_000n, contributionPaise: 0n })
  assert.deepEqual(breakEvenDiscount({ ...noCosts, deliveryFeePaise: 1n }),
    { kind: 'available', rate: 10_000n, contributionPaise: 1n })
})

test('modeled advice gives feasible recovery targets and explains an insufficient courier reduction', () => {
  const initial = advise(baseline)
  assert.equal(initial.shortfallPaise, 5_000n)
  assert.equal(initial.minimumDeliveryFeePaise, 5_000n)
  assert.equal(initial.breakEvenCourierPaise, 13_000n)
  assert.equal(initial.remainingLossWithoutCourierPaise, 0n)
  const severe = advise({ ...baseline, discountBps: 8_000n })
  assert.equal(severe.breakEvenCourierPaise, null)
  assert.equal(severe.remainingLossWithoutCourierPaise, 107_000n)
})

test('page renders demo labels and suppresses misleading results for invalid inputs', () => {
  const html = renderToStaticMarkup(createElement(ProfitOS))
  for (const word of ['Order Autopsy', 'Demo assumptions', 'Illustrative revenue', 'Modeled expenses',
    'Loss Prevention Lab', 'Smart Profit Advisor', 'Estimated contribution', 'Strategy comparison', '−₹50', '+₹110', '17.5%']) {
    assert(html.includes(word), word)
  }
  const invalid = renderToStaticMarkup(createElement(ProfitLab, {
    inputs: { discount: '101', courier: '180', deliveryFee: '0' }, onChange() {},
  }))
  assert.match(invalid, /aria-invalid="true"/)
  assert.match(invalid, /Enter valid scenario inputs/)
  assert.doesNotMatch(invalid, /Estimated contribution/)
})
