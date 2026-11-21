import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amount,profileEstimates,summarize } from '../src/services/profitability-calculation.js';
import type { CostInputs,FinancialLine } from '../src/types/profitability.js';
import type { City } from '../src/types/product.js';

// Normalized calculation fixtures, not retailer records or inferred legacy facts.
const ear:CostInputs={procurementPaisePerUnit:'105000',retailerShippingPaisePerUnit:'15000',packagingPaisePerUnit:'3000',labourPaisePerUnit:'2000',paymentProcessing:{method:'per_unit',paisePerUnit:'4000'},nonRecoverableTaxesPaisePerUnit:'0',overheadPaisePerUnit:'5000'};
const jacket:CostInputs={procurementPaisePerUnit:'75000',retailerShippingPaisePerUnit:'8000',packagingPaisePerUnit:'2500',labourPaisePerUnit:'1500',paymentProcessing:{method:'per_unit',paisePerUnit:'2500'},nonRecoverableTaxesPaisePerUnit:'1000',overheadPaisePerUnit:'4000'};
function normalized(productId:string,city:City,costs:CostInputs,quantity:number,unitSale:bigint):FinancialLine {
  const inputs=profileEstimates(costs,quantity);
  Object.assign(inputs,{grossSales:amount(unitSale*BigInt(quantity)),customerShipping:amount('0'),discounts:amount('0'),refunds:amount('0'),taxCollected:amount('0'),taxRefunded:amount('0')});
  return {orderId:'modeled_fixture',itemId:productId,productId,name:productId,category:productId==='prod_001'?'electronics':'apparel',city,date:'2026-01-03',quantity,returnedUnits:0,legacy:false,inputs};
}
test('independent product/city profiles give exact, different contributions and post-overhead margins',()=>{
  const earbuds=summarize([normalized('prod_001','pune',ear,2,199900n)]);
  assert.equal(earbuds.metrics.totalCost.paise,'268000');assert.equal(earbuds.metrics.contributionProfit.paise,'141800');assert.equal(earbuds.metrics.profitAfterOverhead.paise,'131800');assert.equal(earbuds.metrics.profitMargin.basisPoints,'3297');
  const coat=summarize([normalized('prod_007','delhi',jacket,1,179900n)]);
  assert.equal(coat.metrics.totalCost.paise,'94500');assert.equal(coat.metrics.contributionProfit.paise,'89400');assert.equal(coat.metrics.profitAfterOverhead.paise,'85400');assert.equal(coat.metrics.profitMargin.basisPoints,'4747');
  assert.equal(earbuds.metrics.profitAfterOverhead.quality,'mixed');assert.equal(coat.metrics.profitAfterOverhead.quality,'mixed');
  const delhi=normalized('prod_001','delhi',{...ear,procurementPaisePerUnit:'100000',retailerShippingPaisePerUnit:'18000'},1,199900n);
  const aggregate=summarize([normalized('prod_001','pune',ear,2,199900n),delhi]);
  assert.equal(aggregate.metrics.totalCost.paise,'400000');assert.equal(aggregate.metrics.profitAfterOverhead.paise,'199700');assert.equal(aggregate.metrics.profitMargin.basisPoints,'3330');
});
test('overhead, pass-through taxes, retailer taxes and customer shipping remain separate per product',()=>{
  const original=normalized('prod_001','pune',ear,2,199900n),baseline=summarize([original]);
  const overhead=summarize([normalized('prod_001','pune',{...ear,overheadPaisePerUnit:'6000'},2,199900n)]);
  assert.deepEqual(overhead.metrics.contributionProfit,baseline.metrics.contributionProfit);assert.equal(overhead.metrics.profitAfterOverhead.paise,'129800');
  const passThrough=normalized('prod_001','pune',ear,2,199900n);passThrough.inputs.taxCollected=amount('71964');passThrough.inputs.taxRefunded=amount('1000');
  assert.deepEqual(summarize([passThrough]).metrics.netRevenue,baseline.metrics.netRevenue);assert.deepEqual(summarize([passThrough]).metrics.totalCost,baseline.metrics.totalCost);
  const retailerTax=summarize([normalized('prod_001','pune',{...ear,nonRecoverableTaxesPaisePerUnit:'1000'},2,199900n)]);assert.equal(retailerTax.metrics.profitAfterOverhead.paise,'129800');
  const delivery=normalized('prod_001','pune',ear,2,199900n);delivery.inputs.customerShipping=amount('5000');
  const charged=summarize([delivery]);assert.equal(charged.metrics.netRevenue.paise,'404800');assert.equal(charged.costs.retailerShipping.paise,'30000');assert.equal(charged.metrics.profitAfterOverhead.paise,'136800');
});
test('a sparse city profile or unknown processor base cannot become zero or borrow another product cost',()=>{
  const sparse=summarize([normalized('prod_007','pune',{...jacket,procurementPaisePerUnit:null,packagingPaisePerUnit:'0'},3,179900n)]);
  assert.equal(sparse.costs.procurement.paise,null);assert.deepEqual(sparse.costs.packaging,amount('0','estimated'));assert.equal(sparse.metrics.totalCost.paise,null);assert.equal(sparse.metrics.profitMargin.basisPoints,null);
  const rate={...jacket,paymentProcessing:{method:'rate' as const,basisPoints:200}};
  assert.equal(profileEstimates(rate,1).paymentFees.paise,null);assert.deepEqual(profileEstimates(rate,1,amount('200000')).paymentFees,amount('4000','estimated'));
});
