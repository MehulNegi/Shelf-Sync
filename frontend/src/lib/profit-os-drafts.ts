import { emptyProductInputs, type ProductInputs } from './profit-os'
import type { City } from '../types/products'

export type ProfitDrafts = ReadonlyMap<string, ProductInputs>

export function productDraft(drafts: ProfitDrafts, city: City, productId: string): ProductInputs {
  return drafts.get(JSON.stringify([city, productId])) ?? emptyProductInputs
}

export function updateProductDraft(
  drafts: ProfitDrafts, city: City, productId: string, fields: Partial<ProductInputs>,
): ProfitDrafts {
  const key = JSON.stringify([city, productId])
  return new Map(drafts).set(key, { ...productDraft(drafts, city, productId), ...fields })
}
