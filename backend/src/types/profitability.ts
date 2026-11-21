import type { City } from './product.js';

export type Quality = 'actual' | 'estimated' | 'mixed' | 'unknown';
export interface Amount { paise: string | null; quality: Quality }
export interface Margin { basisPoints: string | null; quality: Quality }
export const inputComponents = ['grossSales','customerShipping','discounts','refunds','taxCollected','taxRefunded',
  'procurement','retailerShipping','packaging','labour','paymentFees','nonRecoverableTaxes','allocatedOverhead'] as const;
export type FinancialInputs = Record<typeof inputComponents[number], Amount>;
export interface Metrics {
  grossSales: Amount; customerShipping: Amount; discounts: Amount; refunds: Amount; taxCollected: Amount; taxRefunded: Amount;
  netRevenue: Amount; costOfGoodsSold: Amount; fulfilmentExpenses: Amount; paymentFees: Amount; otherExpenses: Amount;
  allocatedOverhead: Amount; totalCost: Amount; contributionProfit: Amount; profitAfterOverhead: Amount; profitPerUnit: Amount; profitMargin: Margin;
}
export interface CostBreakdown { procurement: Amount; retailerShipping: Amount; packaging: Amount; labour: Amount; paymentFees: Amount; nonRecoverableTaxes: Amount; allocatedOverhead: Amount }
export interface Coverage { orderCount: number; lineCount: number; unitsSold: number; unitsReturned: number | null; netUnits: number | null;
  legacyLineCount: number; actualProfitLineCount: number; estimatedProfitLineCount: number; unknownProfitLineCount: number }
export interface Summary { metrics: Metrics; costs: CostBreakdown; coverage: Coverage }
export interface FinancialLine { orderId: string; itemId: string; productId: string; name: string; category: string; city: City;
  date: string; quantity: number; returnedUnits: number | null; legacy: boolean; inputs: FinancialInputs }
export interface ProfitFilters { from: string; to: string; city?: City; productId?: string }
export interface ProfitQuery extends ProfitFilters { limit?: string; cursor?: string }
export type PaymentCost = { method: 'per_unit'; paisePerUnit: string } | { method: 'rate'; basisPoints: number };
export const unitCostKeys = ['procurementPaisePerUnit','retailerShippingPaisePerUnit','packagingPaisePerUnit','labourPaisePerUnit',
  'nonRecoverableTaxesPaisePerUnit','overheadPaisePerUnit'] as const;
export type CostInputs = Record<typeof unitCostKeys[number], string | null> & { paymentProcessing: PaymentCost | null };
export interface CostWrite { currency: 'INR'; effectiveAt: string | null; costs: CostInputs }
export interface CostProfile extends CostWrite { productId: string; city: City | null; version: number; effectiveAt: string; updatedAt: string }
export interface CostsResponse { productId: string; city: City | null; currency: 'INR'; latest: CostProfile | null; effective: CostProfile | null; inheritedEffective: CostProfile | null }
export interface ProductProfitability extends Summary { productId: string; name: string; category: string; outcome: 'profitable' | 'loss' | 'break_even' | 'unknown' | 'no_sales' }
