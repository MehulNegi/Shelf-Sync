import { utcMicros } from './admin.js';
import { ApiError } from './products.js';
import { unitCostKeys, type CostWrite, type ProfitFilters, type ProfitQuery } from '../types/profitability.js';
import { cities } from '../types/product.js';

export const invalidProfitRequest=()=>new ApiError(400,'VALIDATION_ERROR','Invalid request parameters');
function object(value:unknown,keys:string[]):asserts value is Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==keys.length || keys.some(k=>!Object.hasOwn(value,k))) throw invalidProfitRequest();
}
export function validateCostWrite(value:unknown):CostWrite {
  object(value,['currency','effectiveAt','costs']);
  if(value.currency!=='INR' || !(value.effectiveAt===null || (typeof value.effectiveAt==='string'&&utcMicros(value.effectiveAt)!==undefined))) throw invalidProfitRequest();
  object(value.costs,[...unitCostKeys,'paymentProcessing']);
  const minor=(v:unknown)=>v===null || (typeof v==='string'&&/^(?:0|[1-9][0-9]{0,11})$/.test(v));
  for(const key of unitCostKeys) if(!minor(value.costs[key])) throw invalidProfitRequest();
  const p=value.costs.paymentProcessing;
  if(p!==null) {
    if(!p || typeof p!=='object' || Array.isArray(p)) throw invalidProfitRequest();
    const method=(p as Record<string,unknown>).method;
    if(method==='per_unit') {object(p,['method','paisePerUnit']);if(p.paisePerUnit===null||!minor(p.paisePerUnit)) throw invalidProfitRequest();}
    else if(method==='rate') {object(p,['method','basisPoints']);if(typeof p.basisPoints!=='number'||!Number.isInteger(p.basisPoints)||p.basisPoints<0||p.basisPoints>10000) throw invalidProfitRequest();}
    else throw invalidProfitRequest();
  }
  return value as unknown as CostWrite;
}
export function validProductId(value:unknown):value is string {return typeof value==='string'&&value.trim().length>0&&value.length<=100;}
function date(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01') return false;
  const parsed=Date.parse(value+'T00:00:00Z');return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value;
}
export function validateProfitQuery(value:unknown, mode:'overview'|'products'|'detail'|'costs'): ProfitQuery {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw invalidProfitRequest();
  const q=value as Record<string,unknown>;
  const allowed=mode==='costs'?['city']:mode==='detail'?['from','to','city']:mode==='products'?['from','to','city','productId','limit','cursor']:['from','to','city','productId'];
  if(Object.keys(q).some(k=>!allowed.includes(k)) || (q.city!==undefined&&!cities.includes(q.city as never)) || (q.productId!==undefined&&!validProductId(q.productId))) throw invalidProfitRequest();
  if(mode!=='costs') {
    if(!date(q.from)||!date(q.to)||q.from>=q.to || Date.parse(q.to+'T00:00:00Z')-Date.parse(q.from+'T00:00:00Z')>366*86400000) throw invalidProfitRequest();
  }
  if(q.limit!==undefined&&(typeof q.limit!=='string'||!/^(?:[1-9][0-9]?|100)$/.test(q.limit))) throw invalidProfitRequest();
  if(q.cursor!==undefined&&typeof q.cursor!=='string') throw invalidProfitRequest();
  return q as unknown as ProfitQuery;
}
export function reportFilters(query:ProfitQuery):ProfitFilters {
  return {from:query.from,to:query.to,...(query.city?{city:query.city}:{}),...(query.productId?{productId:query.productId}:{})};
}
export function validateIfMatch(value:unknown):string {
  if(value===undefined) throw new ApiError(428,'PRECONDITION_REQUIRED','If-Match is required');
  if(typeof value!=='string'||!/^"[!#-+\--~]+"$/.test(value)||value.includes(',')) throw invalidProfitRequest();
  return value;
}
