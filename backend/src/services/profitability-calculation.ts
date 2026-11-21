import { inputComponents, type Amount, type FinancialInputs, type FinancialLine, type CostInputs, type Summary, type Quality } from '../types/profitability.js';

export const unknown = (): Amount => ({ paise: null, quality: 'unknown' });
const canonical = /^(?:0|-?[1-9][0-9]*)$/;
export function amount(paise: string | bigint | null, quality: Quality = 'actual'): Amount {
  if (paise === null) return unknown();
  const text=typeof paise==='bigint'?paise.toString():paise;
  if (typeof text!=='string' || !canonical.test(text) || quality==='unknown') throw new Error('Invalid financial amount');
  return {paise:text,quality};
}
export function validateAmount(value: Amount) {
  if (!value || !['actual','estimated','mixed','unknown'].includes(value.quality) ||
    (value.paise===null ? value.quality!=='unknown' : typeof value.paise!=='string' || !canonical.test(value.paise) || value.quality==='unknown')) throw new Error('Invalid financial amount');
}
function quality(values: Amount[]): Quality {
  if (values.some(v=>v.quality==='unknown')) return 'unknown';
  const kinds=new Set(values.map(v=>v.quality));
  return kinds.size===0?'actual':kinds.size===1?[...kinds][0]!:'mixed';
}
export function sum(values: Amount[], signs?: bigint[]): Amount {
  values.forEach(validateAmount);
  const q=quality(values);if(q==='unknown') return unknown();
  return amount(values.reduce((n,v,i)=>n+BigInt(v.paise!)*(signs?.[i]??1n),0n),q);
}
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if(denominator<=0n) throw new Error('Invalid financial denominator');
  const sign=numerator<0n?-1n:1n, absolute=numerator*sign;
  return sign*(absolute/denominator+(absolute%denominator*2n>=denominator?1n:0n));
}
export function ratio(value: Amount, denominator: Amount, scale=1n): Amount {
  validateAmount(value);validateAmount(denominator);
  if(value.paise===null || denominator.paise===null || BigInt(denominator.paise)<=0n) return unknown();
  return amount(roundRatio(BigInt(value.paise)*scale,BigInt(denominator.paise)),quality([value,denominator]));
}
export function unknownInputs(): FinancialInputs { return Object.fromEntries(inputComponents.map(key=>[key,unknown()])) as FinancialInputs; }
export function normalizeCharges(charges:{merchandise:Amount;shipping:Amount;merchandiseDiscount:Amount;shippingDiscount:Amount;merchandiseRefund:Amount;shippingRefund:Amount;taxCollected:Amount;taxRefunded:Amount}):Pick<FinancialInputs,'grossSales'|'customerShipping'|'discounts'|'refunds'|'taxCollected'|'taxRefunded'> {
  Object.values(charges).forEach(value=>{validateAmount(value);if(value.paise!==null&&BigInt(value.paise)<0n)throw new Error('Negative original charge or refund');});
  for(const [gross,discount,refund] of [[charges.merchandise,charges.merchandiseDiscount,charges.merchandiseRefund],[charges.shipping,charges.shippingDiscount,charges.shippingRefund]]) {
    if(gross!.paise!==null&&discount!.paise!==null) {
      const remaining=BigInt(gross!.paise)-BigInt(discount!.paise);
      if(remaining<0n||(refund!.paise!==null&&BigInt(refund!.paise)>remaining))throw new Error('Discount or refund exceeds paid charge');
    }
  }
  if(charges.taxCollected.paise!==null&&charges.taxRefunded.paise!==null&&BigInt(charges.taxRefunded.paise)>BigInt(charges.taxCollected.paise))throw new Error('Tax refund exceeds collected tax');
  return {grossSales:charges.merchandise,customerShipping:charges.shipping,discounts:sum([charges.merchandiseDiscount,charges.shippingDiscount]),
    refunds:sum([charges.merchandiseRefund,charges.shippingRefund]),taxCollected:charges.taxCollected,taxRefunded:charges.taxRefunded};
}
export function profileEstimates(costs: CostInputs | null, quantity: number, feeBearingCharge: Amount = unknown()): FinancialInputs {
  const values=unknownInputs();if(!costs) return values;
  const fields={procurement:'procurementPaisePerUnit',retailerShipping:'retailerShippingPaisePerUnit',packaging:'packagingPaisePerUnit',
    labour:'labourPaisePerUnit',nonRecoverableTaxes:'nonRecoverableTaxesPaisePerUnit',allocatedOverhead:'overheadPaisePerUnit'} as const;
  for(const [component,field] of Object.entries(fields) as [keyof typeof fields,typeof fields[keyof typeof fields]][]) {
    const value=costs[field];values[component]=value===null?unknown():amount(BigInt(value)*BigInt(quantity),'estimated');
  }
  if(costs.paymentProcessing?.method==='per_unit') values.paymentFees=amount(BigInt(costs.paymentProcessing.paisePerUnit)*BigInt(quantity),'estimated');
  else if(costs.paymentProcessing?.method==='rate' && feeBearingCharge.paise!==null) values.paymentFees=amount(roundRatio(BigInt(feeBearingCharge.paise)*BigInt(costs.paymentProcessing.basisPoints),10000n),'estimated');
  return values;
}
function safeCount(value: number) { if(!Number.isSafeInteger(value)||value<0) throw new Error('Financial coverage exceeds safe count range');return value; }
function derived(input: FinancialInputs) {
  const netRevenue=sum([input.grossSales,input.customerShipping,input.discounts,input.refunds],[1n,1n,-1n,-1n]);
  const fulfilmentExpenses=sum([input.retailerShipping,input.packaging,input.labour]);
  const totalCost=sum([input.procurement,fulfilmentExpenses,input.paymentFees,input.nonRecoverableTaxes,input.allocatedOverhead]);
  const contributionProfit=sum([netRevenue,input.procurement,fulfilmentExpenses,input.paymentFees,input.nonRecoverableTaxes],[1n,-1n,-1n,-1n,-1n]);
  return {netRevenue,fulfilmentExpenses,totalCost,contributionProfit,profitAfterOverhead:sum([netRevenue,totalCost],[1n,-1n])};
}
export function summarize(lines: FinancialLine[]): Summary {
  const inputs=Object.fromEntries(inputComponents.map(key=>[key,sum(lines.map(line=>line.inputs[key]))])) as FinancialInputs;
  const d=derived(inputs), unitsSold=safeCount(lines.reduce((s,l)=>s+safeCount(l.quantity),0));
  for(const line of lines) if(line.returnedUnits!==null && (!Number.isSafeInteger(line.returnedUnits)||line.returnedUnits<0||line.returnedUnits>line.quantity)) throw new Error('Invalid verified return quantity');
  const unitsReturned=lines.some(l=>l.returnedUnits===null)?null:safeCount(lines.reduce((s,l)=>s+l.returnedUnits!,0));
  const netUnits=unitsReturned===null?null:unitsSold-unitsReturned;
  const profitPerUnit=ratio(d.profitAfterOverhead,netUnits===null?unknown():amount(BigInt(netUnits)));
  const margin=ratio(d.profitAfterOverhead,d.netRevenue,10000n);
  const lineQualities=lines.map(l=>derived(l.inputs).profitAfterOverhead.quality);
  return {metrics:{grossSales:inputs.grossSales,customerShipping:inputs.customerShipping,discounts:inputs.discounts,refunds:inputs.refunds,
    taxCollected:inputs.taxCollected,taxRefunded:inputs.taxRefunded,netRevenue:d.netRevenue,costOfGoodsSold:inputs.procurement,
    fulfilmentExpenses:d.fulfilmentExpenses,paymentFees:inputs.paymentFees,otherExpenses:inputs.nonRecoverableTaxes,allocatedOverhead:inputs.allocatedOverhead,
    totalCost:d.totalCost,contributionProfit:d.contributionProfit,profitAfterOverhead:d.profitAfterOverhead,profitPerUnit,
    profitMargin:{basisPoints:margin.paise,quality:margin.quality}},
    costs:{procurement:inputs.procurement,retailerShipping:inputs.retailerShipping,packaging:inputs.packaging,labour:inputs.labour,
      paymentFees:inputs.paymentFees,nonRecoverableTaxes:inputs.nonRecoverableTaxes,allocatedOverhead:inputs.allocatedOverhead},
    coverage:{orderCount:safeCount(new Set(lines.map(l=>l.orderId)).size),lineCount:safeCount(lines.length),unitsSold,unitsReturned,netUnits,
      legacyLineCount:lines.filter(l=>l.legacy).length,actualProfitLineCount:lineQualities.filter(q=>q==='actual').length,
      estimatedProfitLineCount:lineQualities.filter(q=>q==='estimated'||q==='mixed').length,unknownProfitLineCount:lineQualities.filter(q=>q==='unknown').length}};
}

// Largest remainder with caps, signed amounts, quantity fallback and numeric item-ID ties.
export function allocate(total: bigint, lines: {id: string; weight: bigint; quantity: bigint; cap?: bigint}[]): Map<string,bigint> {
  if(new Set(lines.map(l=>l.id)).size!==lines.length || lines.some(l=>!/^\d+$/.test(l.id)||l.weight<0n||l.quantity<=0n||(l.cap!==undefined&&l.cap<0n))) throw new Error('Invalid financial allocation');
  const sign=total<0n?-1n:1n;let remaining=total*sign;
  if(!lines.length && remaining) throw new Error('No allocation lines');
  const shares=new Map(lines.map(l=>[l.id,0n]));
  while(remaining>0n) {
    const eligible=lines.filter(l=>l.cap===undefined||shares.get(l.id)!<l.cap);
    if(!eligible.length) throw new Error('Financial allocation exceeds caps');
    const useQuantity=eligible.every(l=>l.weight===0n);
    const weights=eligible.map(l=>useQuantity?l.quantity:l.weight),denominator=weights.reduce((a,b)=>a+b,0n);
    const initial=remaining;
    const remainders=eligible.map((line,i)=>{
      const numerator=initial*weights[i]!,floor=numerator/denominator;
      const available=line.cap===undefined?initial:line.cap-shares.get(line.id)!;
      const share=floor<available?floor:available;
      shares.set(line.id,shares.get(line.id)!+share);remaining-=share;
      return {line,remainder:numerator%denominator};
    }).sort((a,b)=>a.remainder===b.remainder?(BigInt(a.line.id)<BigInt(b.line.id)?-1:1):a.remainder>b.remainder?-1:1);
    for(const {line} of remainders) if(remaining && (line.cap===undefined||shares.get(line.id)!<line.cap)) {shares.set(line.id,shares.get(line.id)!+1n);remaining--;}
  }
  return new Map([...shares].map(([id,share])=>[id,share*sign]));
}
