import type { FastifyInstance,FastifyRequest,onRequestAsyncHookHandler } from 'fastify';
import { adminDisabled,type AdminPrincipal } from '../services/admin-auth.js';
import { ApiError } from '../services/products.js';
import { profitabilityActor,type ProfitabilityApi } from '../services/profitability.js';
import { invalidProfitRequest,validateCostWrite,validateProfitQuery,validateIfMatch,validProductId } from '../services/profitability-validation.js';
import { cities,type City } from '../types/product.js';

const object=(properties:Record<string,object>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullable=(schema:object)=>({anyOf:[schema,{type:'null'}]});
const text={type:'string'}, timestamp={type:'string',format:'date-time'}, city={type:'string',enum:cities},count={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const minor={type:'string',pattern:'^(?:0|-?[1-9][0-9]*)$'},quality={type:'string',enum:['actual','estimated','mixed','unknown']};
const amount=object({paise:nullable(minor),quality});
const metricKeys=['grossSales','customerShipping','discounts','refunds','taxCollected','taxRefunded','netRevenue','costOfGoodsSold','fulfilmentExpenses','paymentFees','otherExpenses','allocatedOverhead','totalCost','contributionProfit','profitAfterOverhead','profitPerUnit'];
const metrics=object({...Object.fromEntries(metricKeys.map(key=>[key,amount])),profitMargin:object({basisPoints:nullable(minor),quality})});
const costs=object(Object.fromEntries(['procurement','retailerShipping','packaging','labour','paymentFees','nonRecoverableTaxes','allocatedOverhead'].map(key=>[key,amount])));
const coverage=object({orderCount:count,lineCount:count,unitsSold:count,unitsReturned:nullable(count),netUnits:nullable(count),legacyLineCount:count,actualProfitLineCount:count,estimatedProfitLineCount:count,unknownProfitLineCount:count});
const summaryProps={metrics,costs,coverage},summary=object(summaryProps);
const product=object({...summaryProps,productId:text,name:text,category:text,outcome:{type:'string',enum:['profitable','loss','break_even','unknown','no_sales']}});
const report=object({asOf:timestamp,currency:{type:'string',const:'INR'},from:text,to:text,timeZone:{type:'string',const:'Asia/Kolkata'},city:nullable(city),productId:nullable(text)});
const trend={type:'array',maxItems:366,items:object({date:text,netRevenue:amount,totalCost:amount,profitAfterOverhead:amount,orderCount:count})};
const costInputs=object({procurementPaisePerUnit:nullable(minor),retailerShippingPaisePerUnit:nullable(minor),packagingPaisePerUnit:nullable(minor),labourPaisePerUnit:nullable(minor),
  nonRecoverableTaxesPaisePerUnit:nullable(minor),overheadPaisePerUnit:nullable(minor),paymentProcessing:{anyOf:[{type:'null'},object({method:{const:'per_unit',type:'string'},paisePerUnit:minor}),object({method:{const:'rate',type:'string'},basisPoints:{type:'integer',minimum:0,maximum:10000}})]}});
const profile=object({productId:text,city:nullable(city),currency:{type:'string',const:'INR'},version:{type:'integer',minimum:1},effectiveAt:timestamp,updatedAt:timestamp,costs:costInputs});
const costsResponse=object({productId:text,city:nullable(city),currency:{type:'string',const:'INR'},latest:nullable(profile),effective:nullable(profile),inheritedEffective:nullable(profile)});
const queryProps={from:text,to:text,city,productId:{type:'string',maxLength:100},limit:{type:'string'},cursor:{type:'string'}};

export function registerProfitabilityRoutes(app:FastifyInstance,api?:ProfitabilityApi) {
  const principals=new WeakMap<FastifyRequest,AdminPrincipal>();
  const gate:onRequestAsyncHookHandler=async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    if(!api) throw adminDisabled();
    let principal:AdminPrincipal;
    try{principal=await api.authorize(request);}catch(error){if(error instanceof ApiError&&error.statusCode===401)reply.header('WWW-Authenticate','Bearer');throw error;}
    principals.set(request,principal);
    if(request.method!=='PUT'&&(Number(request.headers['content-length']??0)>0||request.headers['transfer-encoding']!==undefined)) throw invalidProfitRequest();
    if(request.method==='PUT') {
      profitabilityActor(principal,api.config);
      if(request.headers.origin!==api.origin) throw new ApiError(403,'FORBIDDEN','Profitability write origin is not allowed');
      if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type']??'')) throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','Content-Type must be application/json');
    }
  };
  for(const mode of ['overview','products','detail'] as const) {
    const path=mode==='detail'?'/api/admin/profitability/products/:productId':`/api/admin/profitability/${mode}`;
    const response=mode==='overview'?object({report,summary,trend}):mode==='detail'?object({report,product,byCity:{type:'array',maxItems:3,items:object({city,summary})},trend}):
      object({report,products:{type:'array',maxItems:100,items:product},page:object({limit:{type:'integer',minimum:1,maximum:100},nextCursor:nullable(text)})});
    app.get<{Params:{productId?:string}}>(path,{onRequest:gate,preValidation:async request=>{
      validateProfitQuery(request.query,mode);if(mode==='detail'&&!validProductId(request.params.productId))throw invalidProfitRequest();
    },schema:{querystring:{type:'object',properties:queryProps},response:{200:response}}},request=>{
      const query=validateProfitQuery(request.query,mode);
      return api!.service.report(mode,query,principals.get(request)!.scope,request.params.productId);
    });
  }
  for(const method of ['GET','PUT'] as const) app.route<{Params:{productId:string}}>({method,url:'/api/admin/products/:productId/costs',onRequest:gate,
    preValidation:async request=>{
      if(!validProductId(request.params.productId))throw invalidProfitRequest();validateProfitQuery(request.query,'costs');
      if(method==='PUT'){validateIfMatch(request.headers['if-match']);validateCostWrite(request.body);}
    },schema:{querystring:{type:'object',properties:{city}},...(method==='PUT'?{body:object({currency:{const:'INR',type:'string'},effectiveAt:nullable(timestamp),costs:costInputs})}:{}),response:{200:costsResponse}},
    handler:async(request,reply)=>{
      const query=validateProfitQuery(request.query,'costs');
      const result=method==='GET'?await api!.service.repository.readCosts(request.params.productId,query.city as City|undefined):
        await api!.service.repository.writeCosts(request.params.productId,query.city as City|undefined,validateCostWrite(request.body),validateIfMatch(request.headers['if-match']),profitabilityActor(principals.get(request)!,api!.config));
      reply.header('ETag',result.etag);return result.body;
    }
  });
}
