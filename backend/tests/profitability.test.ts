import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amount,allocate,normalizeCharges,profileEstimates,roundRatio,sum,summarize,unknown,unknownInputs } from '../src/services/profitability-calculation.js';
import { validateCostWrite,validateIfMatch,validateProfitQuery } from '../src/services/profitability-validation.js';
import { inputComponents,type CostInputs,type FinancialLine } from '../src/types/profitability.js';
import { loadProfitabilityConfig } from '../src/config/profitability.js';

const line=(overrides:Partial<FinancialLine>={}):FinancialLine=>({orderId:'order',itemId:'1',productId:'product',name:'Product',category:'electronics',city:'pune',date:'2026-11-22',quantity:1,returnedUnits:0,legacy:false,
  inputs:Object.fromEntries(inputComponents.map(key=>[key,amount('0')])) as FinancialLine['inputs'],...overrides});
const allCosts:CostInputs={procurementPaisePerUnit:'100',retailerShippingPaisePerUnit:'20',packagingPaisePerUnit:'5',labourPaisePerUnit:'10',paymentProcessing:{method:'per_unit',paisePerUnit:'8'},nonRecoverableTaxesPaisePerUnit:'2',overheadPaisePerUnit:'5'};
test('C8 exact normalized financial vector separates discount, customer delivery, taxes and carrier expenses',()=>{
  const l=line();Object.assign(l.inputs,{grossSales:amount('100000'),customerShipping:amount('8000'),discounts:amount('10000'),refunds:amount('20000'),taxCollected:amount('16200'),taxRefunded:amount('3600'),
    procurement:amount('36000'),retailerShipping:amount('10000'),packaging:amount('2000'),labour:amount('1000'),paymentFees:amount('2800'),nonRecoverableTaxes:amount('500'),allocatedOverhead:amount('3000')});
  const r=summarize([l]);for(const [key,value] of Object.entries({netRevenue:'78000',contributionProfit:'25700',totalCost:'55300',profitAfterOverhead:'22700',fulfilmentExpenses:'13000'})) assert.deepEqual(r.metrics[key as keyof typeof r.metrics],amount(value));
  assert.deepEqual(r.metrics.profitMargin,{basisPoints:'2910',quality:'actual'});
  assert.equal(r.metrics.taxCollected.paise,'16200');assert.equal(r.costs.retailerShipping.paise,'10000');
});
test('losses, zero revenue, zero units, unknowns and estimated zero retain exact semantics',()=>{
  const l=line();l.inputs.procurement=amount('1');const loss=summarize([l]);assert.equal(loss.metrics.profitAfterOverhead.paise,'-1');assert.equal(loss.metrics.profitMargin.basisPoints,null);
  l.inputs.grossSales=amount('10');assert.equal(summarize([l]).metrics.profitMargin.basisPoints,'9000');l.inputs.procurement=amount('11');assert.equal(summarize([l]).metrics.profitMargin.basisPoints,'-1000');
  l.returnedUnits=1;assert.equal(summarize([l]).metrics.profitPerUnit.paise,null);
  l.inputs.packaging=unknown();assert.equal(summarize([l]).metrics.totalCost.paise,null);assert.equal(summarize([l]).coverage.unknownProfitLineCount,1);
  const costs=profileEstimates({...allCosts,procurementPaisePerUnit:'0'},2);assert.deepEqual(costs.procurement,amount('0','estimated'));
  assert.deepEqual(profileEstimates({...allCosts,procurementPaisePerUnit:null},2).procurement,unknown());
  assert.deepEqual(summarize([]).metrics.netRevenue,amount('0'));assert.equal(summarize([]).metrics.profitMargin.basisPoints,null);
});
test('aggregation propagates unknowns, counts distinct orders and calculates ratios after summing',()=>{
  const a=line(),b=line({itemId:'2',quantity:2});a.inputs.grossSales=amount('100');a.inputs.procurement=amount('90','estimated');b.inputs.grossSales=amount('900');
  const summary=summarize([a,b]);assert.equal(summary.coverage.orderCount,1);assert.equal(summary.coverage.unitsSold,3);assert.equal(summary.coverage.estimatedProfitLineCount,1);
  assert.equal(summary.metrics.profitMargin.basisPoints,'9100');assert.equal(summary.metrics.profitAfterOverhead.quality,'mixed');
  b.inputs.grossSales=unknown();assert.equal(summarize([a,b]).metrics.grossSales.paise,null);assert.equal(summarize([a,b]).metrics.profitAfterOverhead.paise,null);
  assert.deepEqual(summarize([line({legacy:true,returnedUnits:null,inputs:unknownInputs()})]).coverage,{orderCount:1,lineCount:1,unitsSold:1,unitsReturned:null,netUnits:null,legacyLineCount:1,actualProfitLineCount:0,estimatedProfitLineCount:0,unknownProfitLineCount:1});
});
test('bigint arithmetic, signed ties and rate estimates never pass through floating money',()=>{
  const l=line();l.inputs.grossSales=amount('9007199254740993123456789');l.inputs.procurement=amount('9007199254740993000000000');assert.equal(summarize([l]).metrics.contributionProfit.paise,'123456789');
  assert.equal(roundRatio(1n,2n),1n);assert.equal(roundRatio(-1n,2n),-1n);assert.equal(roundRatio(-3n,2n),-2n);
  assert.deepEqual(profileEstimates({...allCosts,paymentProcessing:{method:'rate',basisPoints:250}},1,amount('16200')).paymentFees,amount('405','estimated'));
  assert.deepEqual(profileEstimates({...allCosts,paymentProcessing:{method:'rate',basisPoints:250}},1).paymentFees,unknown());
  assert.throws(()=>amount('01'));assert.throws(()=>sum([{paise:'0',quality:'unknown'}]));
});
test('charge normalization deducts each discount/refund once and enforces paid-component caps',()=>{
  const charges={merchandise:amount('100'),shipping:amount('20'),merchandiseDiscount:amount('10'),shippingDiscount:amount('5'),merchandiseRefund:amount('30'),shippingRefund:amount('5'),taxCollected:amount('18'),taxRefunded:amount('3')};
  const l=line();Object.assign(l.inputs,normalizeCharges(charges));assert.equal(summarize([l]).metrics.netRevenue.paise,'70');
  assert.throws(()=>normalizeCharges({...charges,shippingRefund:amount('16')}));assert.throws(()=>normalizeCharges({...charges,merchandiseDiscount:amount('101')}));assert.throws(()=>normalizeCharges({...charges,taxRefunded:amount('19')}));
});
test('largest remainder preserves exact amounts, numeric item tie order, fallback, caps and reversals',()=>{
  const rows=[{id:'10',weight:1n,quantity:1n},{id:'2',weight:1n,quantity:1n}];
  assert.deepEqual([...allocate(1n,rows)],[['10',0n],['2',1n]]);
  assert.deepEqual([...allocate(-1n,rows)],[['10',0n],['2',-1n]]);
  assert.deepEqual([...allocate(10n,[{id:'1',weight:10n,quantity:1n,cap:2n},{id:'2',weight:0n,quantity:1n,cap:20n}])],[['1',2n],['2',8n]]);
  const huge=allocate(900719925474099399n,[{id:'1',weight:0n,quantity:1n},{id:'2',weight:0n,quantity:2n}]);assert.equal([...huge.values()].reduce((a,b)=>a+b),900719925474099399n);
  assert.throws(()=>allocate(3n,[{id:'1',weight:1n,quantity:1n,cap:2n}]));
});
test('cost inputs enforce exact canonical paise, prospective UTC syntax and mutually exclusive payment methods',()=>{
  const write={currency:'INR',effectiveAt:null,costs:allCosts};assert.deepEqual(validateCostWrite(write),write);
  for(const bad of ['-1','1.2','01','+1','1000000000000',1,true]) assert.throws(()=>validateCostWrite({...write,costs:{...allCosts,procurementPaisePerUnit:bad}}));
  for(const bad of [{method:'rate',basisPoints:1.5},{method:'rate',basisPoints:10001},{method:'rate',basisPoints:1,paisePerUnit:'1'},{method:'per_unit',paisePerUnit:null}])assert.throws(()=>validateCostWrite({...write,costs:{...allCosts,paymentProcessing:bad}}));
  assert.throws(()=>validateCostWrite({...write,currency:'USD'}));assert.throws(()=>validateCostWrite({...write,costs:{...allCosts,marketingPaisePerUnit:'1'}}));
  assert.throws(()=>validateCostWrite({...write,effectiveAt:'2026-02-30T00:00:00Z'}));
});
test('IST date windows, scalar query keys, conditional headers and default-off flags are validated',()=>{
  validateProfitQuery({from:'2024-01-01',to:'2025-01-01'},'overview');
  for(const q of [{from:'2026-02-30',to:'2026-03-01'},{from:'2025-01-01',to:'2027-01-01'},{from:'2026-01-01',to:'2026-01-01'},{from:['2026-01-01'],to:'2026-02-01'},{from:'2026-01-01',to:'2026-02-01',city:'Pune'}])assert.throws(()=>validateProfitQuery(q,'overview'));
  for(const value of [undefined,'*','W/"tag"','"a", "b"'])assert.throws(()=>validateIfMatch(value));assert.equal(validateIfMatch('"pc-abc"'),'"pc-abc"');
  assert.deepEqual(loadProfitabilityConfig({}),{enabled:false,demoWrites:false});assert.throws(()=>loadProfitabilityConfig({PROFITABILITY_ENABLED:'yes'}));
});
