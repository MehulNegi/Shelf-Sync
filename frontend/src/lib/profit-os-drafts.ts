import { emptyProductInputs, type ProductInputs } from './profit-os'
import type { City } from '../types/products'

export type ProfitDrafts = ReadonlyMap<string, Partial<ProductInputs>>

function draftKey(city: City, productId: string) {
  return JSON.stringify([city, productId])
}

export function productDraft(drafts: ProfitDrafts, city: City, productId: string, defaults = emptyProductInputs) {
  const edits = drafts.get(draftKey(city, productId)) ?? {}
  return { ...defaults, ...edits }
}

export function editedProductFields(drafts: ProfitDrafts, city: City, productId: string): ReadonlySet<string> {
  return new Set(Object.keys(drafts.get(draftKey(city, productId)) ?? {}))
}

export function updateProductDraft(
  drafts: ProfitDrafts, city: City, productId: string, fields: Partial<ProductInputs>,
): ProfitDrafts {
  const key = draftKey(city, productId)
  return new Map(drafts).set(key, { ...drafts.get(key), ...fields })
}

export function resetProductDraft(drafts: ProfitDrafts, city: City, productId: string): ProfitDrafts {
  const next = new Map(drafts)
  next.delete(draftKey(city, productId))
  return next
}
