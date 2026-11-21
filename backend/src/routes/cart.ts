import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ReservationConfig } from '../config/reservations.js';
import type { PgCartRepository } from '../repositories/cart.js';
import { cartCredential, cartSessionRequired, cartTransport, cookieName } from '../services/cart-security.js';
import { ApiError } from '../services/products.js';
import { normalizeOrder } from '../services/orders.js';
import { cities, type City } from '../types/product.js';
import type { CartResult, CreateHolds, PatchHolds } from '../types/cart.js';

export interface CartApi { config: ReservationConfig; repository: PgCartRepository }
const invalid = () => new ApiError(400,'VALIDATION_ERROR','Invalid request parameters');
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k))) throw invalid();
}
function ids(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length<1 || value.length>max || !value.every(uuid)) throw invalid();
  const normalized = value.map(v=>v.toLowerCase()).sort();
  if (new Set(normalized).size!==normalized.length) throw invalid();
  return normalized;
}
export function normalizeCart(body: unknown, operation: 'create' | 'patch' | 'release' | 'checkout') {
  object(body,operation==='release' ? ['reservationIds'] : operation==='checkout' ? ['city','items','reservationIds'] : ['city','items']);
  if (operation==='release') return { reservationIds:ids(body.reservationIds,100) };
  if (operation==='checkout') { try { return { ...normalizeOrder(body), reservationIds:ids(body.reservationIds,20) }; } catch { throw invalid(); } }
  if (!cities.includes(body.city as City) || !Array.isArray(body.items) || body.items.length<1 || body.items.length>(operation==='patch'?20:100)) throw invalid();
  if (operation==='create') {
    const quantities = new Map<string,number>();
    for (const item of body.items) {
      object(item,['productId','quantity']);
      if (typeof item.productId!=='string' || !item.productId.trim() || item.productId.length>100 || typeof item.quantity!=='number' || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>99) throw invalid();
      const quantity=(quantities.get(item.productId)??0)+item.quantity;
      if (quantity>99) throw invalid();
      quantities.set(item.productId,quantity);
    }
    return { city:body.city as City, items:[...quantities].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([productId,quantity])=>({productId,quantity})) } satisfies CreateHolds;
  }
  const items=body.items.map(item=> {
    object(item,['reservationId','quantity']);
    if (!uuid(item.reservationId) || typeof item.quantity!=='number' || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>99) throw invalid();
    return { reservationId:item.reservationId.toLowerCase(),quantity:item.quantity };
  }).sort((a,b)=>a.reservationId<b.reservationId?-1:1);
  if (new Set(items.map(i=>i.reservationId)).size!==items.length) throw invalid();
  return {city:body.city as City,items} satisfies PatchHolds;
}
export function sendCart(reply: FastifyReply, result: CartResult) {
  if (result.retryAfter) reply.header('Retry-After',result.retryAfter);
  return reply.code(result.status).send(result.body);
}
export async function cartCheckout(request: FastifyRequest, reply: FastifyReply, api?: CartApi) {
  reply.header('Cache-Control','no-store');
  if (!api?.config.enabled) throw new ApiError(503,'RESERVATIONS_DISABLED','Cart reservations are not enabled');
  const ip=cartTransport(request,api.config,true);
  const hash=cartCredential(request,api.config); if (!hash) throw cartSessionRequired();
  const key=request.headers['idempotency-key']; if (!uuid(key)) throw invalid();
  if (Object.keys(request.query as object).length) throw invalid();
  const input=normalizeCart(request.body,'checkout');
  const limited=await api.repository.httpAdmission(ip); if (limited) return sendCart(reply,limited);
  return sendCart(reply,await api.repository.mutate(hash,ip,key.toLowerCase(),'POST','/api/orders',input));
}
export function registerCartRoutes(app: FastifyInstance, api?: CartApi) {
  const noQuery={type:'object',additionalProperties:false,properties:{}};
  const bodySchema={type:'object',additionalProperties:true}; // Exact preValidation below rejects coercion/unknown keys.
  const rowsSchema={type:'object',additionalProperties:false,required:['serverTime','reservations'],properties:{serverTime:{type:'string'},reservations:{type:'array',maxItems:100,items:{
    type:'object',additionalProperties:false,required:['reservationId','productId','city','quantity','status','createdAt','expiresAt','updatedAt','requiresReservation','orderId'],
    properties:{reservationId:{type:'string',format:'uuid'},productId:{type:'string'},city:{type:'string',enum:cities},quantity:{type:'integer',minimum:1,maximum:99},
      status:{type:'string',enum:['active','expired','released','consumed']},createdAt:{type:'string'},expiresAt:{type:'string'},updatedAt:{type:'string'},requiresReservation:{type:'boolean'},orderId:{anyOf:[{type:'string'},{type:'null'}]}}
  }}}};
  for (const operation of ['session','read','create','patch','release'] as const) {
    const method=operation==='read'?'GET':operation==='patch'?'PATCH':'POST';
    const path=operation==='session'?'/api/cart/session':operation==='release'?'/api/cart/reservations/release':'/api/cart/reservations';
    app.route({method,url:path,
      onRequest:async(request,reply)=>{
        reply.header('Cache-Control','no-store');
        if (!api?.config.enabled) throw new ApiError(503,'RESERVATIONS_DISABLED','Cart reservations are not enabled');
        cartTransport(request,api.config,method!=='GET');
        if (operation!=='session' && !cartCredential(request,api.config)) throw cartSessionRequired();
      },
      preValidation:async request=>{
        if (operation==='session') { object(request.body,[]); }
        else if (operation!=='read') {
          if (!uuid(request.headers['idempotency-key'])) throw invalid();
          normalizeCart(request.body,operation);
        }
      },
      schema:{querystring:operation==='read'?{type:'object',additionalProperties:false,properties:{city:{type:'string',enum:cities}}}:noQuery,
        ...(method!=='GET'?{body:bodySchema}:{}),
        ...(operation!=='session'?{response:{200:rowsSchema,201:rowsSchema}}:{response:{200:{type:'object',required:['serverTime','sessionExpiresAt'],properties:{serverTime:{type:'string'},sessionExpiresAt:{type:'string'}}},201:{type:'object',required:['serverTime','sessionExpiresAt'],properties:{serverTime:{type:'string'},sessionExpiresAt:{type:'string'}}}}})},
      handler:async(request,reply)=>{
        const {config,repository}=api!;
        const ip=cartTransport(request,config,method!=='GET');
        const limited=await repository.httpAdmission(ip); if(limited) return sendCart(reply,limited);
        const hash=cartCredential(request,config);
        if(operation==='session') {
          const result=await repository.session(hash,ip);
          if(result.token) reply.header('Set-Cookie',`${cookieName(config)}=${result.token}; Path=/; HttpOnly; SameSite=Strict; Expires=${result.expires!.toUTCString()}${config.localHttp?'':'; Secure'}`);
          return sendCart(reply,result);
        }
        if(operation==='read') return sendCart(reply,await repository.read(hash!,(request.query as {city?:City}).city));
        return sendCart(reply,await repository.mutate(hash!,ip,(request.headers['idempotency-key'] as string).toLowerCase(),method,path,normalizeCart(request.body,operation)));
      }
    });
  }
}
