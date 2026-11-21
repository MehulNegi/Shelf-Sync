import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { PgCartRepository } from '../../src/repositories/cart.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { SearchProductRepository } from '../../src/repositories/search-products.js';
import { reconcileReservations } from '../../src/services/reservation-expiry.js';
import { indexCatalog } from '../../src/services/catalog-indexer.js';
import type { ReservationConfig } from '../../src/config/reservations.js';

test('C7 reservations with real PostgreSQL, isolated inventory and database-clock expiry', {
  skip:process.env.RUN_DB_TESTS!=='1'?'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests':false,timeout:150000
},async t=>{
  const runtime=loadConfig(); const schema=`shelfsync_cart_${randomUUID().replaceAll('-','')}`;
  const database=createPool(runtime);
  const pool=createPool({...runtime,database:{...runtime.database,options:`-c search_path=${schema}`}});
  const config:ReservationConfig={enabled:true,ttlSeconds:30,localHttp:true,origin:'http://127.0.0.1:5173',rateSecret:randomBytes(32),httpsProxyIps:[]};
  const products=new PgProductRepository(pool),orders=new PgOrderRepository(pool);
  const repository=new PgCartRepository(pool,config);
  const app=buildApp({products,orders,tracking:orders,frontendOrigin:config.origin,cart:{config,repository}});
  let created=false;
  t.after(async()=>{try{await app.close();await pool.end();if(created)await database.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await database.end();}});
  await database.query(`CREATE SCHEMA "${schema}"`);created=true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
  await migrate(pool);
  const headers={host:'127.0.0.1:3000',origin:config.origin,'content-type':'application/json'};
  const session=async()=>{
    const r=await app.inject({method:'POST',url:'/api/cart/session',headers,payload:{}});
    assert.equal(r.statusCode,201,r.body);
    assert.match(String(r.headers['set-cookie']),/HttpOnly; SameSite=Strict/);
    return String(r.headers['set-cookie']).split(';')[0]!;
  };
  const send=(cookie:string,url:string,payload:object,method:'POST'|'PATCH'='POST',key=randomUUID())=>app.inject({method,url,headers:{...headers,cookie,'idempotency-key':key},payload});
  const create=(cookie:string,id:string,quantity=1,city='pune',key=randomUUID())=>send(cookie,'/api/cart/reservations',{city,items:[{productId:id,quantity}]},'POST',key);
  const read=(cookie:string)=>app.inject({url:'/api/cart/reservations',headers:{...headers,cookie}});
  const stock=async(id:string)=>(await app.inject(`/api/products/${id}?city=pune`)).json().stock;
  const fixture=async(quantity=1)=>{
    const id=`reservation_${randomUUID()}`;
    await pool.query("INSERT INTO products(id,name,description,category,price,image_url) VALUES ($1,'Reservation fixture','Isolated data','electronics',1999,'/images/test.jpg')",[id]);
    await pool.query("INSERT INTO inventory(product_id,city,quantity) VALUES ($1,'pune',$2),($1,'delhi',8)",[id,quantity]);return id;
  };
  const counts=async(id:string)=>(await pool.query(`SELECT
    (SELECT quantity FROM inventory WHERE product_id=$1 AND city='pune') AS physical,
    (SELECT count(*)::int FROM order_items WHERE product_id=$1) AS orders,
    (SELECT count(*)::int FROM outbox_events WHERE payload->>'productId'=$1) AS events`,[id])).rows[0];

  await t.test('two browsers compete for one unit: exactly one 201 and one 409, including legacy checkout protection',async()=>{
    const id=await fixture(),a=await session(),b=await session();
    const results=await Promise.all([create(a,id),create(b,id)]);
    assert.deepEqual(results.map(r=>r.statusCode).sort(),[201,409]);
    assert.equal(results.find(r=>r.statusCode===409)!.json().error.code,'INSUFFICIENT_STOCK');
    assert.equal(await stock(id),0);assert.deepEqual(await counts(id),{physical:1,orders:0,events:1});
    const legacy=await app.inject({method:'POST',url:'/api/orders',payload:{city:'pune',items:[{productId:id,quantity:1}]}});
    assert.equal(legacy.statusCode,409);
    const owner=results[0]!.statusCode===201?a:b,foreign=owner===a?b:a;
    const hold=results.find(r=>r.statusCode===201)!.json().reservations[0];
    const stolen=await send(foreign,'/api/cart/reservations/release',{reservationIds:[hold.reservationId]});
    assert.equal(stolen.statusCode,404);assert.equal(await stock(id),0);
    const stolenOrder=await send(foreign,'/api/orders',{city:'pune',items:[{productId:id,quantity:1}],reservationIds:[hold.reservationId]});
    assert.equal(stolenOrder.statusCode,404);
    const released=await send(owner,'/api/cart/reservations/release',{reservationIds:[hold.reservationId]});
    assert.equal(released.statusCode,200);assert.equal(await stock(id),1);
  });
  await t.test('idempotent retries, duplicate product normalization, quantity changes and refresh preserve the original deadline',async()=>{
    const id=await fixture(5),cookie=await session(),key=randomUUID();
    const body={city:'pune',items:[{productId:id,quantity:1},{productId:id,quantity:1}]};
    const first=await send(cookie,'/api/cart/reservations',body,'POST',key);
    assert.equal(first.statusCode,201,first.body);const hold=first.json().reservations[0];assert.equal(hold.quantity,2);
    const retry=await create(cookie,id,2,'pune',key);assert.deepEqual(retry.json(),first.json());
    assert.equal((await create(cookie,id,3,'pune',key)).json().error.code,'IDEMPOTENCY_CONFLICT');
    assert.equal((await create(cookie,id)).json().error.code,'RESERVATION_EXISTS');
    for(const quantity of [3,1,1]) {
      const patch=await send(cookie,'/api/cart/reservations',{city:'pune',items:[{reservationId:hold.reservationId,quantity}]},'PATCH');
      assert.equal(patch.statusCode,200,patch.body);assert.equal(patch.json().reservations[0].expiresAt,hold.expiresAt);
      assert.equal(await stock(id),5-quantity);
    }
    const refreshed=await read(cookie);assert.equal(refreshed.json().reservations[0].expiresAt,hold.expiresAt);
    const reused=await send(cookie,'/api/cart/session',{});assert.equal(reused.statusCode,200);assert.equal(reused.headers['set-cookie'],undefined);
    await send(cookie,'/api/cart/reservations/release',{reservationIds:[hold.reservationId]});
    const before=await counts(id);
    const again=await send(cookie,'/api/cart/reservations/release',{reservationIds:[hold.reservationId]});
    assert.equal(again.statusCode,200);assert.deepEqual(await counts(id),before);
    const cooldown=await create(cookie,id);assert.equal(cooldown.statusCode,429);assert.ok(Number(cooldown.headers['retry-after'])>0);
  });
  await t.test('reserved checkout consumes once at server prices with confirmed tracking and replay-safe order creation',async()=>{
    const id=await fixture(2),cookie=await session();
    const hold=(await create(cookie,id)).json().reservations[0];const key=randomUUID();
    const body={city:'pune',items:[{productId:id,quantity:1}],reservationIds:[hold.reservationId]};
    const responses=await Promise.all([send(cookie,'/api/orders',body,'POST',key),send(cookie,'/api/orders',body,'POST',key)]);
    assert.deepEqual(responses.map(r=>r.statusCode),[201,201]);assert.deepEqual(responses[0]!.json(),responses[1]!.json());
    const order=responses[0]!.json();assert.equal(order.total,1999);assert.equal(order.status,'confirmed');
    assert.deepEqual(await counts(id),{physical:1,orders:1,events:2});assert.equal(await stock(id),1);
    const tracked=(await app.inject(`/api/orders/${order.orderId}/tracking`)).json();assert.equal(tracked.history[0].status,'confirmed');
    assert.equal((await send(cookie,'/api/orders',body)).json().error.code,'RESERVATION_CONSUMED');
    const consumed=(await read(cookie)).json().reservations[0];assert.equal(consumed.status,'consumed');assert.equal(consumed.orderId,order.orderId);
    await send(cookie,'/api/cart/reservations/release',{reservationIds:[hold.reservationId]});assert.equal(await stock(id),1);
  });
  await t.test('multi-product failures and mismatched checkout roll back every allocation/outbox/order change',async()=>{
    const a=await fixture(2),b=await fixture(0),cookie=await session();
    const failed=await send(cookie,'/api/cart/reservations',{city:'pune',items:[{productId:a,quantity:1},{productId:b,quantity:1}]});
    assert.equal(failed.statusCode,409);assert.deepEqual(await counts(a),{physical:2,orders:0,events:0});
    const hold=(await create(cookie,a)).json().reservations[0];
    const mismatch=await send(cookie,'/api/orders',{city:'pune',items:[{productId:a,quantity:2}],reservationIds:[hold.reservationId]});
    assert.equal(mismatch.json().error.code,'RESERVATION_MISMATCH');assert.deepEqual(await counts(a),{physical:2,orders:0,events:1});
    // Same failed key remains a stable failure even if an operator changes stock.
    const key=randomUUID();assert.equal((await create(cookie,b,1,'pune',key)).statusCode,409);
    await pool.query("UPDATE inventory SET quantity=2 WHERE product_id=$1 AND city='pune'",[b]);
    assert.equal((await create(cookie,b,1,'pune',key)).statusCode,409);
  });
  await t.test('city switching requires explicit release and never transfers a hold',async()=>{
    const id=await fixture(3),cookie=await session();const hold=(await create(cookie,id)).json().reservations[0];
    assert.equal((await create(cookie,id,1,'delhi')).json().error.code,'RESERVATION_CITY_CONFLICT');
    await send(cookie,'/api/cart/reservations/release',{reservationIds:[hold.reservationId]});
    const delhi=await create(cookie,id,1,'delhi');assert.equal(delhi.statusCode,201,delhi.body);
    assert.equal(delhi.json().reservations[0].city,'delhi');assert.equal(await stock(id),3);
  });
  await t.test('a reservation and legacy checkout competing for the final unit cannot both succeed',async()=>{
    const id=await fixture(),cookie=await session();
    const results=await Promise.all([create(cookie,id),app.inject({method:'POST',url:'/api/orders',payload:{city:'pune',items:[{productId:id,quantity:1}]}})]);
    assert.deepEqual(results.map(r=>r.statusCode).sort(),[201,409]);
    const live=(await pool.query("SELECT count(*)::int AS count FROM cart_reservations WHERE product_id=$1 AND state='active' AND expires_at>clock_timestamp()",[id])).rows[0].count;
    const persisted=await counts(id);assert.equal(persisted.orders+live,1);assert.equal(persisted.events,1);assert.equal(await stock(id),0);
  });
  await t.test('multi-item checkout rolls back consumed flags, inventory, order and events after a late database failure',async()=>{
    const a=await fixture(2),b=await fixture(2),cookie=await session();
    const holds=await send(cookie,'/api/cart/reservations',{city:'pune',items:[{productId:a,quantity:1},{productId:b,quantity:1}]});
    assert.equal(holds.statusCode,201,holds.body);
    await pool.query(`CREATE FUNCTION fail_reserved_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated checkout failure'; END $$`);
    await pool.query('CREATE TRIGGER fail_reserved_item BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_reserved_item()');
    try {
      const response=await send(cookie,'/api/orders',{city:'pune',items:[{productId:a,quantity:1},{productId:b,quantity:1}],reservationIds:holds.json().reservations.map((r:{reservationId:string})=>r.reservationId)});
      assert.equal(response.statusCode,500);for(const id of [a,b]) assert.deepEqual(await counts(id),{physical:2,orders:0,events:1});
      assert.ok((await read(cookie)).json().reservations.every((r:{status:string})=>r.status==='active'));
    } finally {await pool.query('DROP TRIGGER fail_reserved_item ON order_items');}
    const success=await send(cookie,'/api/orders',{city:'pune',items:[{productId:a,quantity:1},{productId:b,quantity:1}],reservationIds:holds.json().reservations.map((r:{reservationId:string})=>r.reservationId)});
    assert.equal(success.statusCode,201,success.body);assert.equal(success.json().total,3998);
  });
  await t.test('shared PostgreSQL quotas deny creation while preserving owner release',async()=>{
    const id=await fixture(2),cookie=await session();const hold=(await create(cookie,id)).json().reservations[0];
    const hash=createHash('sha256').update(cookie.slice(cookie.indexOf('=')+1)).digest();
    const otherInstance=new PgCartRepository(pool,config);
    const admissions=await Promise.all(Array.from({length:21},(_,i)=>(i%2?otherInstance:repository).admit(pool,'session',hash,60,20)));
    assert.ok(admissions.some(value=>value!==undefined));
    const denied=await create(cookie,await fixture());assert.equal(denied.statusCode,429);assert.equal(denied.json().error.code,'RESERVATION_RATE_LIMITED');
    const release=await send(cookie,'/api/cart/reservations/release',{reservationIds:[hold.reservationId]});assert.equal(release.statusCode,200);assert.equal(await stock(id),2);
  });
  await t.test('stale OpenSearch stock is always hydrated from live PostgreSQL, with reservation-aware bootstrap',async()=>{
    const id=await fixture(1),cookie=await session();await create(cookie,id);
    const product=(await app.inject(`/api/products/${id}?city=pune`)).json();
    const search=new SearchProductRepository({async search(){return [{...product,stock:999,price:1}];}},products);
    const result=await search.list({city:'pune'});assert.equal(result[0]!.stock,0);assert.equal(result[0]!.price,1999);
    // Isolate this one fixture from the full catalog for a bounded bootstrap check.
    const docs:import('../../src/services/search-projection.js').ProductDocument[]=[];
    await indexCatalog(pool,{async ensureIndex(){},async upsertProduct(doc){if(doc.id===id) docs.push(doc);}});
    assert.equal(docs.find(d=>d.city==='pune')!.stock,0);assert.equal(docs.find(d=>d.city==='pune')!.physicalQuantity,1);
  });
  await t.test('input, ownership, Origin, forwarding and admin boundaries reject unsafe requests',async()=>{
    const cookie=await session(),id=await fixture(5);
    for(const quantity of [0,-1,1.5,'1',true,100]) assert.equal((await send(cookie,'/api/cart/reservations',{city:'pune',items:[{productId:id,quantity}]})).statusCode,400);
    assert.equal((await send(cookie,'/api/cart/reservations',{city:'pune',items:[]})).statusCode,400);
    for(const extra of [{expiresAt:'2099-01-01T00:00:00Z'},{userId:'someone'},{price:1}]) assert.equal((await send(cookie,'/api/cart/reservations',{city:'pune',items:[{productId:id,quantity:1}],...extra})).statusCode,400);
    for(const extra of [{origin:'null'},{'x-forwarded-for':'127.0.0.1'},{host:'untrusted.example'}]) {
      const r=await app.inject({url:'/api/cart/reservations',headers:{...headers,cookie,...extra}});assert.equal(r.statusCode,403);
    }
    assert.equal((await app.inject({url:'/api/cart/reservations',headers})).statusCode,401);
    assert.equal((await app.inject({url:'/api/admin/orders',headers:{...headers,cookie}})).statusCode,503);
    const preflight=await app.inject({method:'OPTIONS',url:'/api/cart/reservations',headers:{origin:config.origin,'access-control-request-method':'POST'}});
    assert.equal(preflight.headers['access-control-allow-credentials'],'true');
  });
  await t.test('a real 30-second deadline restores availability without cleanup; expired checkout rolls back and reconciliation is repeatable',async()=>{
    const id=await fixture(1),cookie=await session();const first=await create(cookie,id);assert.equal(first.statusCode,201,first.body);
    const hold=first.json().reservations[0];assert.equal(Date.parse(hold.expiresAt)-Date.parse(hold.createdAt),30000);
    assert.equal(await stock(id),0);
    await delay(Math.max(0,Date.parse(hold.expiresAt)-Date.now()+80));
    const raw=(await pool.query('SELECT state FROM cart_reservations WHERE id=$1',[hold.reservationId])).rows[0];assert.equal(raw.state,'active');
    assert.equal(await stock(id),1);
    const observed=(await read(cookie)).json().reservations[0];assert.equal(observed.status,'expired');assert.equal(observed.requiresReservation,true);assert.equal(observed.expiresAt,hold.expiresAt);
    const failed=await send(cookie,'/api/orders',{city:'pune',items:[{productId:id,quantity:1}],reservationIds:[hold.reservationId]});
    assert.equal(failed.json().error.code,'RESERVATION_EXPIRED');assert.deepEqual(await counts(id),{physical:1,orders:0,events:1});
    const other=await session();const won=await create(other,id);assert.equal(won.statusCode,201,won.body);
    const events=(await pool.query("SELECT payload FROM outbox_events WHERE payload->>'productId'=$1 ORDER BY (payload->>'inventoryVersion')::bigint",[id])).rows;
    assert.equal(events.length,2);assert.equal(events[1].payload.schemaVersion,2);assert.ok(events[1].payload.causes.includes('reservation.expired'));
    await reconcileReservations(pool);const before=await counts(id);await reconcileReservations(pool);assert.deepEqual(await counts(id),before);
    t.diagnostic('Real 30-second PostgreSQL hold expired with cleanup stopped; public availability restored before materialization; original checkout rejected; competing browser acquired the unit.');
  });
});
