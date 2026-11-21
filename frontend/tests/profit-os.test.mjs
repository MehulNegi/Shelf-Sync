import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const {
  baseline, toInputs, calculateScenario, breakEvenDiscount, advise, parseHundredths, formatPaise, formatDiscount, strategies,
  catalogPricePaise, completeScenario, contributionMarginBps, emptyProductInputs, productStrategies,
} = await vite.ssrLoadModule('/src/lib/profit-os.ts')
const { ProfitOS } = await vite.ssrLoadModule('/src/pages/ProfitOS.tsx')
const { EarningsProductCard } = await vite.ssrLoadModule('/src/components/profit-os/EarningsProductCard.tsx')
const { EarningsGuide } = await vite.ssrLoadModule('/src/components/profit-os/EarningsGuide.tsx')
const { improvementOptions, expenseGroups } = await vite.ssrLoadModule('/src/lib/profit-os-guidance.ts')
const { editedProductFields, productDraft, resetProductDraft, updateProductDraft } = await vite.ssrLoadModule('/src/lib/profit-os-drafts.ts')
const { demoProductInputs } = await vite.ssrLoadModule('/src/lib/profit-os-demo.ts')
const { mockProducts } = await vite.ssrLoadModule('/src/mocks/products.ts')
const seeds = JSON.parse(await readFile(new URL('../../backend/database/seed/products.json', import.meta.url), 'utf8'))
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

test('My Earnings opens on the visual catalog without preselecting an example sale', () => {
  const html = renderToStaticMarkup(createElement(ProfitOS))
  for (const text of ['Choose a Product', 'Search your products...', 'Where are you selling?', 'Loading products for Pune']) {
    assert(html.includes(text), text)
  }
  assert.doesNotMatch(html, /Example sale|Demo scenario|Where My Money Goes|Estimated contribution/)
})

test('visual picker cards expose selection, price and the shared product image or fallback', () => {
  const product = { ...seeds[0], id: 'shop-item', name: 'Shop item', price: 1999.25, imageUrl: '/images/headphones.webp' }
  const render = (item, selected) => renderToStaticMarkup(createElement(EarningsProductCard, { product: item, selected, onSelect() {} }))
  assert.match(render(product, true), /type="button".*aria-pressed="true".*aria-label="Shop item".*aria-describedby="earnings-price-shop-item"/)
  assert.match(render(product, true), /src="[^"]*\/images\/headphones.webp" alt="Shop item".*₹1,999.25.*Selected/)
  assert.match(render({ ...product, imageUrl: '', price: null }, false), /aria-pressed="false".*role="img" aria-label="Image unavailable for Shop item".*Price unavailable/)
})

function renderGuide(input, price = baseline.merchandisePaise) {
  return renderToStaticMarkup(createElement(EarningsGuide, { price, input, editedFields: new Set(), onEdit() {} }))
}

test('guided view displays gains, losses and break-even, with exact inputs collapsed', () => {
  for (const [discount, outcome] of [['15', 'Estimated gain'], ['20', 'Estimated loss'], ['17.5', 'Break even']]) {
    const markup = renderGuide({ ...toInputs(baseline), discount })
    assert(markup.includes(outcome))
    assert.equal(markup.match(/type="range"/g)?.length, 2)
    assert.match(markup, /<details class="command-panel retailer-details earnings-details"><summary>See all costs and edit details/)
  }
  const invalid = renderGuide({ ...toInputs(baseline), discount: '101' })
  assert.match(invalid, /aria-invalid="true"/)
  assert.match(invalid, /Fill in the missing or invalid amounts/)
  assert.doesNotMatch(invalid, /Estimated gain|Estimated loss/)
})

test('expense groups reconcile to exact paise and suggestions apply deterministic improvements', () => {
  const scenario = { ...baseline, packagingPaise: 3099n, labourPaise: 1001n, taxPaise: 175n }
  const groups = expenseGroups(scenario)
  assert.deepEqual(groups.map(({ amount }) => amount), [125000n, 21099n, 20176n])
  assert.equal(groups.reduce((total, { amount }) => total + amount, 0n), calculateScenario(scenario).expensesPaise)
  const options = improvementOptions(baseline)
  assert.deepEqual(options.map(({fields}) => fields), [{ discount: '17.5' }, { courier: '160' }])
  const results = options.map(({ fields }) => calculateScenario(completeScenario(
    baseline.merchandisePaise, { ...toInputs(baseline), ...fields },
  )).contributionPaise)
  assert.deepEqual(results, [0n, -3000n])
  assert.deepEqual(improvementOptions({ ...baseline, discountBps: 0n, courierPaise: 0n }), [])
})

const assumptions = {
  acquisition: '1250', packaging: '30', payment: '40', marketing: '150', labour: '20.25',
  tax: '5.50', discount: '15', deliveryFee: '12.50', courier: '120.05',
}

test('product switching and city switching keep independent draft amounts', () => {
  let drafts = new Map()
  drafts = updateProductDraft(drafts, 'pune', 'earbuds', assumptions)
  drafts = updateProductDraft(drafts, 'delhi', 'earbuds', { courier: '200' })
  drafts = updateProductDraft(drafts, 'pune', 'jacket', { acquisition: '400' })
  assert.deepEqual(productDraft(drafts, 'pune', 'earbuds'), assumptions)
  assert.equal(productDraft(drafts, 'delhi', 'earbuds').courier, '200')
  assert.equal(productDraft(drafts, 'delhi', 'earbuds').acquisition, '')
  assert.equal(productDraft(drafts, 'pune', 'jacket').acquisition, '400')
  assert.equal(productDraft(drafts, 'pune', 'jacket').courier, '')
  assert.deepEqual(productDraft(drafts, 'bengaluru', 'earbuds'), emptyProductInputs)
})

test('catalog prices use exact paise and selected city prices change contribution', () => {
  const pune = completeScenario(catalogPricePaise(1999.99), assumptions)
  assert.equal(pune.merchandisePaise, 199999n)
  assert.deepEqual(calculateScenario(pune), {
    discountPaise: 30000n, discountedMerchandisePaise: 169999n, revenuePaise: 171249n,
    expensesPaise: 161580n, contributionPaise: 9669n,
  })
  const delhi = completeScenario(catalogPricePaise(1799.99), assumptions)
  assert.equal(calculateScenario(delhi).contributionPaise, -7331n)
  const comparison = productStrategies(delhi)
  assert.equal(calculateScenario(comparison[0].scenario).contributionPaise, -7331n)
  const feeStrategy = comparison.find(({ name }) => name.includes('delivery fees'))
  assert.equal(calculateScenario(feeStrategy.scenario).contributionPaise, 0n)
})

test('unknown costs and unavailable prices do not produce an estimated contribution', () => {
  for (const price of [undefined, null, NaN, -1, 123.456, '1999.99']) {
    assert.equal(catalogPricePaise(price), null)
    assert.equal(completeScenario(catalogPricePaise(price), assumptions), null)
  }
  assert.equal(completeScenario(199999n, { ...assumptions, labour: '' }), null)
  assert.equal(completeScenario(199999n, { ...assumptions, tax: 'invalid' }), null)
  assert.equal(completeScenario(199999n, { ...assumptions, tax: '0' }).taxPaise, 0n)
  assert.match(renderGuide(emptyProductInputs), /Fill in the missing or invalid amounts/)
  assert.match(renderGuide(emptyProductInputs, null), /catalog selling price is unavailable/)
  assert.doesNotMatch(renderGuide(emptyProductInputs), /Estimated gain|Estimated loss/)
})


const cities = ['pune', 'delhi', 'bengaluru']

test('every seeded, mock, and unknown-category product with a valid price receives nine usable values', () => {
  for (const city of cities) {
    const products = [
      ...seeds.map((product) => ({ ...product, city })),
      ...mockProducts({ city }).products,
      { id: 'new-product', price: 123.45, city },
    ]
    for (const product of products) {
      const price = catalogPricePaise(product.price)
      const defaults = demoProductInputs(product, price)
      assert.deepEqual(Object.keys(defaults).sort(), Object.keys(emptyProductInputs).sort())
      assert(Object.values(defaults).every((value) => parseHundredths(value) !== null))
      const scenario = completeScenario(price, defaults)
      assert(scenario)
      assert(Object.values(calculateScenario(scenario)).every((value) => typeof value === 'bigint'))
    }
  }
})

test('demo costs are deterministic yet vary with product identity, category, price and city', () => {
  const product = { id: 'same-id', category: 'electronics', city: 'pune' }
  const price = 200_000n
  const original = demoProductInputs(product, price)
  assert.deepEqual(demoProductInputs({ ...product }, price), original)
  assert.notDeepEqual(demoProductInputs({ ...product, id: 'another-id' }, price), original)
  const apparel = demoProductInputs({ ...product, category: 'Clothing' }, price)
  const accessories = demoProductInputs({ ...product, category: 'accessories' }, price)
  assert(parseHundredths(original.acquisition) > parseHundredths(apparel.acquisition))
  assert(parseHundredths(accessories.courier) < parseHundredths(apparel.courier))
  assert(parseHundredths(accessories.packaging) < parseHundredths(apparel.packaging))
  const delhi = demoProductInputs({ ...product, city: 'delhi' }, price)
  assert.equal(parseHundredths(delhi.courier) - parseHundredths(original.courier), 900n)
  assert.notEqual(delhi.deliveryFee, original.deliveryFee)
  assert.notEqual(demoProductInputs(product, price * 2n).acquisition, original.acquisition)
  for (const invalid of [undefined, null, NaN, -1, 1.234]) {
    assert.equal(demoProductInputs(product, catalogPricePaise(invalid)), undefined)
  }
})

test('edited fields overlay demo defaults and reset affects only the selected product and city', () => {
  const product = { id: 'earbuds', city: 'pune', category: 'electronics' }
  const defaults = demoProductInputs(product, 199_900n)
  let drafts = updateProductDraft(new Map(), 'pune', product.id, { courier: '120.51', labour: '' })
  drafts = updateProductDraft(drafts, 'delhi', product.id, { courier: '81.11' })
  drafts = updateProductDraft(drafts, 'pune', 'jacket', { courier: '55' })
  const edited = productDraft(drafts, 'pune', product.id, defaults)
  assert.deepEqual(edited, { ...defaults, courier: '120.51', labour: '' })
  assert.equal(completeScenario(199_900n, edited), null)
  assert.deepEqual([...editedProductFields(drafts, 'pune', product.id)], ['courier', 'labour'])
  const reset = resetProductDraft(drafts, 'pune', product.id)
  assert.deepEqual(productDraft(reset, 'pune', product.id, defaults), defaults)
  assert.equal(editedProductFields(reset, 'pune', product.id).size, 0)
  assert.equal(productDraft(reset, 'delhi', product.id, defaults).courier, '81.11')
  assert.equal(productDraft(reset, 'pune', 'jacket', defaults).courier, '55')
})

test('fictional defaults produce positive and negative contributions, with exact signed margins', () => {
  const modeled = seeds.map((product) => {
    const price = catalogPricePaise(product.price)
    return calculateScenario(completeScenario(price, demoProductInputs({ ...product, city: 'pune' }, price)))
  })
  assert.deepEqual(modeled[0], {
    discountPaise: 14993n, discountedMerchandisePaise: 184907n, revenuePaise: 188407n,
    expensesPaise: 169821n, contributionPaise: 18586n,
  })
  assert.equal(contributionMarginBps(modeled[0]), 986n)
  assert(modeled.some((result) => result.contributionPaise < 0n && contributionMarginBps(result) < 0n))
  assert.equal(contributionMarginBps({ contributionPaise: 1n, revenuePaise: 20000n }), 1n)
  assert.equal(contributionMarginBps({ contributionPaise: -1n, revenuePaise: 20000n }), -1n)
  assert.equal(contributionMarginBps({ contributionPaise: -1n, revenuePaise: 0n }), null)
  assert.equal(formatDiscount(-1n), '−0.01%')
})
