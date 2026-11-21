import { applyBasisPoints, toInputs, type ProductInputs } from './profit-os'
import type { City, Product } from '../types/products'

// Fictional demo profiles. Rates are basis points of the current catalog price.
const profiles = {
  electronics: { procurement: 6_450n, packaging: 180n, courier: 8_500n, labour: 125n },
  apparel: { procurement: 5_200n, packaging: 125n, courier: 6_500n, labour: 225n },
  accessories: { procurement: 4_800n, packaging: 65n, courier: 4_200n, labour: 100n },
  groceries: { procurement: 6_100n, packaging: 140n, courier: 5_200n, labour: 150n },
  other: { procurement: 5_700n, packaging: 130n, courier: 6_000n, labour: 175n },
}

const deliveryByCity: Record<City, { courierAdjustment: bigint; customerFee: bigint }> = {
  pune: { courierAdjustment: 0n, customerFee: 2_500n },
  delhi: { courierAdjustment: 900n, customerFee: 3_500n },
  bengaluru: { courierAdjustment: 500n, customerFee: 3_000n },
}

function profileFor(category: string | null | undefined) {
  switch (typeof category === 'string' ? category.trim().toLowerCase() : '') {
    case 'electronics': return profiles.electronics
    case 'apparel':
    case 'clothing': return profiles.apparel
    case 'accessories': return profiles.accessories
    case 'groceries': return profiles.groceries
    default: return profiles.other
  }
}

function productSeed(id: string) {
  let hash = 2_166_136_261
  for (const character of id) hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619)
  return hash >>> 0
}

export function demoProductInputs(
  product: Pick<Product, 'id' | 'city'> & { category?: string | null },
  price: bigint | null,
): ProductInputs | undefined {
  if (price === null || price < 0n) return
  const profile = profileFor(product.category)
  const city = deliveryByCity[product.city]
  const seed = productSeed(product.id)
  const variation = (shift: number, steps: number) => BigInt((seed >>> shift) % steps)
  const atRate = (rate: bigint) => applyBasisPoints(price, rate)

  return toInputs({
    merchandisePaise: price,
    discountBps: 750n + variation(0, 8) * 250n,
    courierPaise: profile.courier + city.courierAdjustment + variation(4, 5) * 500n,
    deliveryFeePaise: city.customerFee + variation(7, 3) * 500n,
    acquisitionPaise: atRate(profile.procurement + variation(10, 7) * 100n),
    packagingPaise: 500n + atRate(profile.packaging + variation(15, 3) * 25n),
    paymentPaise: atRate(160n + variation(18, 5) * 15n),
    marketingPaise: atRate(275n + variation(21, 5) * 80n),
    labourPaise: 800n + atRate(profile.labour + variation(24, 3) * 25n),
    taxPaise: atRate(65n + variation(27, 4) * 30n),
  })
}
