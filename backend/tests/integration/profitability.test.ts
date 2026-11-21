import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrations.js';
import { createProfitabilityApi } from '../../src/services/profitability.js';
import { captureOrderFinancials } from '../../src/services/profitability-snapshot.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { adminCredentials } from '../helpers/admin.js';
import type { CostInputs } from '../../src/types/profitability.js';

test('C8 profitability on isolated PostgreSQL: costs, audit, snapshots, legacy reporting and authorization',{
  skip:process.env.RUN_DB_TESTS!=='1'?'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests':false,timeout:120000
},async t=>{
  const db=loadConfig(),schema=`shelfsync_profit_${randomUUID().replaceAll('-','')}`;
  const database=createPool(db),pool=createPool({...db,database:{...db.database,options:`-c search_path=${schema} -c timezone=Pacific/Honolulu`}});
  const c=await adminCredentials(),headers=c.headers(await c.token({roles:['inventory_admin','profitability_write']}));
  const finance=createProfitabilityApi(pool,c.config,{enabled:true,demoWrites:false},c.resolver)!;
  const orders=new PgOrderRepository(pool),app=buildApp({products:new PgProductRepository(pool),orders,tracking:orders,frontendOrigin:c.config.frontendOrigin,profitability:finance});
  let created=false;
  t.after(async()=>{try{await app.close();await pool.end();if(created)await database.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await database.end();}});
  await database.query(`CREATE SCHEMA "${schema}"`);created=true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
  assert.equal(await migrate(pool),4);assert.equal(await migrate(pool),0);
  for(const id of ['product_a','product_b','empty_product']) {
    await pool.query("INSERT INTO products(id,name,description,category,price,image_url) VALUES ($1,$1,'Isolated test','electronics',1999,'/images/test.jpg')",[id]);
    await pool.query("INSERT INTO inventory(product_id,city,quantity) VALUES ($1,'pune',10),($1,'delhi',8)",[id]);
  }
  const costs:CostInputs={procurementPaisePerUnit:'10000',retailerShippingPaisePerUnit:'2000',packagingPaisePerUnit:'300',labourPaisePerUnit:'500',paymentProcessing:{method:'per_unit',paisePerUnit:'400'},nonRecoverableTaxesPaisePerUnit:'100',overheadPaisePerUnit:'200'};
  const costPath=(id='product_a',city?:string)=>`/api/admin/products/${id}/costs${city?'?city='+city:''}`;
  const get=(url:string)=>app.inject({url,headers});
  const put=(url:string,etag:string,payload:object={currency:'INR',effectiveAt:null,costs})=>app.inject({method:'PUT',url,headers:{...headers,'if-match':etag},payload});
  const order=async(id:string,city:string,status:string,at:string,products=['product_a'])=>{
    await pool.query('INSERT INTO orders(id,city,status,total,created_at) VALUES ($1,$2,$3,$4,$5)',[id,city,status,(1999*products.length).toString(),at]);
    for(const productId of products)await pool.query('INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES ($1,$2,1,1999)',[id,productId]);
  };
  const observation=async()=>(await pool.query(`SELECT (SELECT sum(quantity)::text FROM inventory) AS stock,(SELECT sum(version)::text FROM inventory) AS version,
    (SELECT count(*)::int FROM outbox_events) AS events,(SELECT count(*)::int FROM cart_reservations) AS reservations`)).rows[0];
  const before=await observation();

  await t.test('unknown profiles, global estimates and immutable conditional versions are exact',async()=>{
    const empty=await get(costPath());assert.equal(empty.statusCode,200,empty.body);assert.match(String(empty.headers.etag),/^"pc-/);
    assert.deepEqual(empty.json(),{productId:'product_a',city:null,currency:'INR',latest:null,effective:null,inheritedEffective:null});
    const first=await put(costPath(),String(empty.headers.etag));assert.equal(first.statusCode,200,first.body);
    assert.equal(first.json().latest.version,1);assert.deepEqual(first.json().effective.costs,costs);assert.notEqual(first.headers.etag,empty.headers.etag);
    assert.equal((await put(costPath(),String(empty.headers.etag))).statusCode,412);
    assert.equal((await put(costPath(),String(first.headers.etag),{currency:'INR',effectiveAt:'2020-01-01T00:00:00Z',costs})).statusCode,409);
    const row=(await pool.query('SELECT * FROM product_cost_versions')).rows[0];assert.match(row.actor_ref,/^jwt:[a-f0-9]{64}$/);assert.equal(row.procurement_paise,'10000');
    await assert.rejects(pool.query('UPDATE product_cost_versions SET procurement_paise=1 WHERE id=$1',[row.id]),{code:'23514'});
    await assert.rejects(pool.query('DELETE FROM product_cost_versions WHERE id=$1',[row.id]),{code:'23514'});
  });
  await t.test('city override is whole-profile, fallback is explicit, and a different-scope ETag fails',async()=>{
    const global=await get(costPath()),city=await get(costPath('product_a','pune'));
    assert.equal(city.json().effective,null);assert.equal(city.json().inheritedEffective.version,1);
    assert.equal((await put(costPath('product_a','pune'),String(global.headers.etag))).statusCode,412);
    const sparse={...costs,procurementPaisePerUnit:null,packagingPaisePerUnit:'0'};
    const saved=await put(costPath('product_a','pune'),String(city.headers.etag),{currency:'INR',effectiveAt:null,costs:sparse});
    assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().inheritedEffective,null);assert.equal(saved.json().effective.costs.procurementPaisePerUnit,null);assert.equal(saved.json().effective.costs.packagingPaisePerUnit,'0');
    const delhi=await get(costPath('product_a','delhi'));assert.equal(delhi.json().effective,null);assert.equal(delhi.json().inheritedEffective.version,1);
  });
  await t.test('first-write races have one winner and future effective versions cannot silently reorder',async()=>{
    const initial=await get(costPath('product_b'));
    const results=await Promise.all([put(costPath('product_b'),String(initial.headers.etag)),put(costPath('product_b'),String(initial.headers.etag))]);
    assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,412]);
    const current=await get(costPath('product_b'));
    const future=(await pool.query("SELECT (clock_timestamp()+interval '1 day') AS time")).rows[0].time.toISOString();
    const scheduled=await put(costPath('product_b'),String(current.headers.etag),{currency:'INR',effectiveAt:future,costs:{...costs,procurementPaisePerUnit:'12345'}});
    assert.equal(scheduled.statusCode,200,scheduled.body);assert.equal(scheduled.json().latest.version,2);assert.equal(scheduled.json().effective.version,1);
    assert.equal((await put(costPath('product_b'),String(scheduled.headers.etag))).statusCode,409);
  });
  await t.test('cost validation and required conditional headers are enforced before persistence',async()=>{
    const initial=await get(costPath('empty_product'));
    const missing=await app.inject({method:'PUT',url:costPath('empty_product'),headers,payload:{currency:'INR',effectiveAt:null,costs}});assert.equal(missing.statusCode,428);
    for(const bad of [1,'01','-1','1.5','1000000000000'])assert.equal((await put(costPath('empty_product'),String(initial.headers.etag),{currency:'INR',effectiveAt:null,costs:{...costs,labourPaisePerUnit:bad}})).statusCode,400);
    assert.equal((await get(costPath('missing'))).statusCode,404);
    const preflight=await app.inject({method:'OPTIONS',url:costPath(),headers:{origin:c.config.frontendOrigin,'access-control-request-method':'PUT','access-control-request-headers':'if-match,content-type,authorization'}});
    assert.match(String(preflight.headers['access-control-allow-methods']),/PUT/);assert.match(String(preflight.headers['access-control-allow-headers']),/If-Match/i);
    assert.match(String(initial.headers['access-control-expose-headers']),/ETag/);
  });

  await order('before_ist','pune','confirmed','2026-01-10T18:29:59.999999Z');
  await order('inside_ist','pune','confirmed','2026-01-10T18:30:00Z',['product_a','product_b']);
  await order('next_ist','delhi','confirmed','2026-01-11T18:30:00Z');
  await order('pending','pune','pending','2026-01-11T01:00:00Z');
  await order('cancelled_only','pune','cancelled','2026-01-11T01:00:00Z');
  await order('confirmed_cancelled','delhi','cancelled','2026-01-11T01:00:00Z');
  await pool.query("INSERT INTO order_status_history(order_id,status,occurred_at,source) VALUES ('confirmed_cancelled','confirmed',NULL,'legacy_snapshot')");
  await t.test('actual legacy cohorts respect IST boundaries and confirmation evidence without inventing financial amounts',async()=>{
    const response=await get('/api/admin/profitability/overview?from=2026-01-11&to=2026-01-12');assert.equal(response.statusCode,200,response.body);
    const body=response.json();assert.equal(body.report.timeZone,'Asia/Kolkata');assert.equal(body.summary.coverage.orderCount,2);assert.equal(body.summary.coverage.lineCount,3);assert.equal(body.summary.coverage.legacyLineCount,3);
    assert.equal(body.summary.coverage.unknownProfitLineCount,3);assert.equal(body.summary.metrics.grossSales.paise,null);assert.equal(body.summary.metrics.totalCost.paise,null);assert.equal(body.summary.metrics.refunds.paise,null);
    assert.equal(body.trend.length,1);assert.equal(body.trend[0].date,'2026-01-11');assert.equal(body.trend[0].orderCount,2);
    const city=await get('/api/admin/profitability/overview?from=2026-01-11&to=2026-01-12&city=pune');assert.equal(city.json().summary.coverage.lineCount,2);assert.equal(city.json().summary.coverage.orderCount,1);
  });
  await t.test('product keysets, scope-bound cursors, zero-sales details and daily gaps match C8',async()=>{
    const prefix='/api/admin/profitability/products?from=2026-01-01&to=2026-02-01&limit=1';
    const first=await get(prefix);assert.equal(first.statusCode,200,first.body);assert.equal(first.json().products[0].productId,'product_a');assert.equal(first.json().products[0].outcome,'unknown');
    const cursor=first.json().page.nextCursor;assert.ok(cursor);const second=await get(prefix+'&cursor='+cursor);assert.equal(second.json().products[0].productId,'product_b');assert.equal(second.json().page.nextCursor,null);
    assert.equal((await get(prefix+'&city=delhi&cursor='+cursor)).statusCode,400);
    const changedIdentity=await app.inject({url:prefix+'&cursor='+cursor,headers:c.headers(await c.token({sub:'other-admin'}))});assert.equal(changedIdentity.statusCode,400);
    const empty=await get('/api/admin/profitability/products/empty_product?from=2026-01-11&to=2026-01-14');assert.equal(empty.statusCode,200,empty.body);assert.equal(empty.json().product.outcome,'no_sales');
    assert.deepEqual(empty.json().product.metrics.netRevenue,{paise:'0',quality:'actual'});assert.equal(empty.json().trend.length,3);assert.deepEqual(empty.json().byCity.map((r:{city:string})=>r.city),['pune','delhi','bengaluru']);
    assert.equal((await get('/api/admin/profitability/products/missing?from=2026-01-11&to=2026-01-14')).statusCode,404);
    const unknown=await get('/api/admin/profitability/overview?from=2026-01-11&to=2026-01-12&productId=missing');assert.equal(unknown.json().summary.coverage.lineCount,0);
  });
  await t.test('isolated snapshot module freezes exact charged prices and selected whole-profile estimates without classifying unresolved revenue',async()=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO orders(id,city,status,total) VALUES ('snapshot_order','pune','confirmed',3998)");
      await client.query("INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES ('snapshot_order','product_a',2,1999)");
      assert.equal(await captureOrderFinancials(client,'snapshot_order'),true);assert.equal(await captureOrderFinancials(client,'snapshot_order'),false);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    const frozen=(await pool.query("SELECT * FROM order_item_financial_snapshots WHERE order_id='snapshot_order'")).rows[0];
    assert.equal(frozen.charged_unit_price_paise,'199900');assert.equal(frozen.quantity,2);assert.deepEqual(frozen.amounts.procurement,{paise:null,quality:'unknown'});assert.deepEqual(frozen.amounts.packaging,{paise:'0',quality:'estimated'});
    assert.equal(frozen.amounts.grossSales.paise,null);assert.equal(frozen.returned_units,null);
    const current=await get(costPath('product_a','pune'));assert.equal((await put(costPath('product_a','pune'),String(current.headers.etag))).statusCode,200);
    await pool.query("UPDATE products SET price=5555 WHERE id='product_a'");
    assert.deepEqual((await pool.query("SELECT * FROM order_item_financial_snapshots WHERE order_id='snapshot_order'")).rows[0],frozen);
    for(const sql of ["UPDATE order_item_financial_snapshots SET quantity=3 WHERE order_id='snapshot_order'","DELETE FROM order_financial_snapshots WHERE order_id='snapshot_order'"])await assert.rejects(pool.query(sql),{code:'23514'});
    const today=(await pool.query("SELECT business_date::text AS date,(business_date+1)::text AS next FROM order_financial_snapshots WHERE order_id='snapshot_order'")).rows[0];
    const report=await get(`/api/admin/profitability/overview?from=${today.date}&to=${today.next}`);assert.equal(report.statusCode,200,report.body);assert.equal(report.json().summary.coverage.legacyLineCount,0);assert.equal(report.json().summary.costs.packaging.paise,'0');assert.equal(report.json().summary.costs.packaging.quality,'estimated');
  });
  await t.test('capture cannot backfill legacy sales and structural failure leaves no partial order or financial history',async()=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN');await assert.rejects(captureOrderFinancials(client,'inside_ist'),/new confirmed order/);await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("INSERT INTO orders(id,city,status,total) VALUES ('failed_finance','pune','confirmed',1999)");
      await client.query("INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES ('failed_finance','product_b',1,1999)");
      await client.query("CREATE FUNCTION fail_financial_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated snapshot failure'; END $$");
      await client.query('CREATE TRIGGER fail_financial_fixture BEFORE INSERT ON order_item_financial_snapshots FOR EACH ROW EXECUTE FUNCTION fail_financial_fixture()');
      await assert.rejects(captureOrderFinancials(client,'failed_finance'));await client.query('ROLLBACK');
    }finally{client.release();}
    assert.equal((await pool.query("SELECT 1 FROM orders WHERE id='failed_finance'")).rowCount,0);assert.equal((await pool.query("SELECT 1 FROM order_financial_snapshots WHERE order_id='failed_finance'")).rowCount,0);
  });
  await t.test('authorization, database failures and private-cost isolation preserve all commerce state',async()=>{
    const publicProduct=await app.inject('/api/products/product_a?city=pune');assert.equal(publicProduct.statusCode,200);assert.ok(!publicProduct.body.includes('procurement'));
    assert.deepEqual(await observation(),before);
    const closed=createPool(db);await closed.end();
    const failed=buildApp({products:new PgProductRepository(pool),orders,frontendOrigin:c.config.frontendOrigin,profitability:createProfitabilityApi(closed,c.config,{enabled:true,demoWrites:false},c.resolver)!});
    try{const r=await failed.inject({url:'/api/admin/profitability/overview?from=2026-01-01&to=2026-02-01',headers});assert.equal(r.statusCode,503);assert.equal(r.json().error.code,'DATABASE_UNAVAILABLE');}finally{await failed.close();}
    const actualCheckout=await app.inject({method:'POST',url:'/api/orders',payload:{city:'pune',items:[{productId:'product_b',quantity:1}]}});assert.equal(actualCheckout.statusCode,201,actualCheckout.body);
    assert.equal((await pool.query('SELECT 1 FROM order_financial_snapshots WHERE order_id=$1',[actualCheckout.json().orderId])).rowCount,0);
    const events=(await pool.query('SELECT payload FROM outbox_events')).rows;assert.equal(events.length,1);assert.ok(!JSON.stringify(events).includes('procurement'));assert.equal(events[0].payload.schemaVersion,2);
  });
});
