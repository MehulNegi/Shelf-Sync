import type { Product } from '../types/products'

const seededImages = new Map([
  ['prod_001', 'earphones'],
  ['prod_002', 'charger'],
  ['prod_003', 'speaker'],
  ['prod_004', 'mouse'],
  ['prod_005', 'tshirt'],
  ['prod_006', 'jeans'],
  ['prod_007', 'jacket'],
  ['prod_008', 'socks'],
  ['prod_009', 'rice'],
  ['prod_010', 'atta'],
  ['prod_011', 'tea'],
  ['prod_012', 'oil'],
])

export function productImageCandidates(
  product: Pick<Product, 'id' | 'imageUrl'>,
  apiBase: string | undefined,
  storefrontOrigin: string,
): string[] {
  const source = product.imageUrl.trim()
  // The mock catalog shares IDs with unrelated seeded products.
  const stem = apiBase === undefined ? undefined : seededImages.get(product.id)
  const bundled = stem ? `/images/${stem}.webp` : ''
  if (stem && (!source || source === `/images/${stem}.jpg` || source === bundled)) return [bundled]
  if (!source) return []

  const rootRelative = source.startsWith('/') && !source.startsWith('//')
  const supplied = apiBase && rootRelative
    ? new URL(source, new URL(apiBase, storefrontOrigin)).href
    : source
  return [...new Set([supplied, source.startsWith('/images/') ? source : '', bundled].filter(Boolean))]
}
