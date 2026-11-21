import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadReservationConfig } from '../src/config/reservations.js';
import { normalizeCart } from '../src/routes/cart.js';
import { parseInventoryEvent } from '../src/types/inventory-event.js';
import { buildApp } from '../src/app.js';
import { runReservationExpiry } from '../src/services/reservation-expiry.js';

test('reservation configuration fails closed for weak secrets, unsafe local HTTP and invalid TTL',()=>{
  const runtime={host:'127.0.0.1',nodeEnv:'development',frontendOrigin:'http://127.0.0.1:5173'};
  const env={RESERVATIONS_ENABLED:'true',RESERVATION_ALLOW_LOCAL_HTTP:'true',RESERVATION_RATE_LIMIT_SECRET:randomBytes(32).toString('base64url'),INVENTORY_V1_CUTOFF_AT:new Date().toISOString()};
  assert.equal(loadReservationConfig(runtime,env).ttlSeconds,30);
  assert.equal(loadReservationConfig(runtime,{}).enabled,false);
  for(const ttl of ['0','301','5.5','oops']) assert.throws(()=>loadReservationConfig(runtime,{...env,RESERVATION_TTL_SECONDS:ttl}));
  assert.throws(()=>loadReservationConfig({...runtime,host:'0.0.0.0'},env));
  assert.throws(()=>loadReservationConfig({...runtime,nodeEnv:'production'},env));
  assert.throws(()=>loadReservationConfig(runtime,{...env,RESERVATION_RATE_LIMIT_SECRET:'short'}));
  assert.throws(()=>loadReservationConfig(runtime,{...env,RESERVATION_ALLOW_LOCAL_HTTP:'false'}));
  assert.throws(()=>loadReservationConfig(runtime,{...env,INVENTORY_V1_CUTOFF_AT:''}));
});
test('expiry worker finishes an in-flight poll and closes resources on shutdown',async()=>{
  const controller=new AbortController();let released=false,ended=false;
  const client={async query(sql:string){return {rows:sql.includes('clock_timestamp()::text')?[{time:new Date().toISOString()}]:[]};},release(){released=true;}};
  const pool={async connect(){return client;},async query(sql:string){if(sql.startsWith('DELETE FROM cart_sessions'))controller.abort();return {rows:[]};},async end(){ended=true;}};
  const events:string[]=[];
  await runReservationExpiry(pool as unknown as import('pg').Pool,controller.signal,entry=>events.push(entry.event));
  assert.equal(released,true);assert.equal(ended,true);assert.ok(events.includes('reservation_expiry_stopped'));
});
test('cart normalization combines products, rejects coercion/secrets/expiry and canonicalizes UUID keys',()=>{
  assert.deepEqual(normalizeCart({city:'pune',items:[{productId:'b',quantity:1},{productId:'a',quantity:2},{productId:'b',quantity:3}]},'create'),{city:'pune',items:[{productId:'a',quantity:2},{productId:'b',quantity:4}]});
  for(const quantity of [0,-1,1.5,'1',true,100]) assert.throws(()=>normalizeCart({city:'pune',items:[{productId:'a',quantity}]},'create'));
  for(const value of [{userId:'x'},{expiresAt:'2099-01-01'},{price:1}]) assert.throws(()=>normalizeCart({city:'pune',items:[{productId:'a',quantity:1}],...value},'create'));
  const id=randomUUID();assert.throws(()=>normalizeCart({reservationIds:[id,id.toUpperCase()]},'release'));
  assert.throws(()=>normalizeCart({city:'pune',items:[{reservationId:id,quantity:1},{reservationId:id,quantity:2}]},'patch'));
});
test('schema v2 validates full availability snapshots and preserves legacy physical quantity meaning',()=>{
  const v1={eventId:randomUUID(),type:'inventory.changed',schemaVersion:1,productId:'fixture',city:'pune',quantity:3,inventoryVersion:7,occurredAt:'2026-11-21T12:00:00Z'};
  assert.equal(parseInventoryEvent(v1).quantity,3);
  const v2={...v1,schemaVersion:2,reservedQuantity:2,availableQuantity:1,nextExpirationAt:'2026-11-21T12:00:30Z',causes:['reservation.created']};
  assert.equal(parseInventoryEvent(v2).schemaVersion,2);
  for(const extra of [{availableQuantity:3},{reservedQuantity:-1},{nextExpirationAt:'bad'},{causes:['fake']},{causes:['reservation.created','reservation.created']},{schemaVersion:'2'}]) assert.throws(()=>parseInventoryEvent({...v2,...extra}));
});
test('reservation endpoints remain disabled by default and do not change public/admin access',async t=>{
  const app=buildApp({frontendOrigin:'http://localhost:5173',products:{async list(){return[];},async findById(){return undefined;}},orders:{async checkout(){throw new Error();},async findById(){return undefined;}}});
  t.after(()=>app.close());
  for(const [method,url] of [['POST','/api/cart/session'],['POST','/api/cart/reservations'],['PATCH','/api/cart/reservations'],['POST','/api/cart/reservations/release'],['GET','/api/cart/reservations']] as const) {
    const response=await app.inject({method,url});assert.equal(response.statusCode,503);assert.equal(response.json().error.code,'RESERVATIONS_DISABLED');
  }
  assert.equal((await app.inject('/api/products?city=pune')).statusCode,200);
  assert.equal((await app.inject('/api/admin/orders')).statusCode,503);
});
