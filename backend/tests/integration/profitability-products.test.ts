import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { databaseDirectory,migrate } from '../../src/db/migrations.js';
import { PgOrderRepository } from '../../src/repositories/orders.js';
import { PgProductRepository } from '../../src/repositories/products.js';
import { createProfitabilityApi } from '../../src/services/profitability.js';
import { captureOrderFinancials } from '../../src/services/profitability-snapshot.js';
import type { CostInputs,ProductProfitability } from '../../src/types/profitability.js';
import type { City } from '../../src/types/product.js';
import { adminCredentials } from '../helpers/admin.js';

test('F15 readiness: catalog product/city isolation and populated pre-004 upgrade',{
  skip:process.env.RUN_DB_TESTS!=='1'?'Set RUN_DB_TESTS=1 for isolated PostgreSQL tests':false,timeout:120000
},async t=>{
  const runtime=loadConfig(),schema=`shelfsync_f15_${randomUUID().replaceAll('-','')}`;
  const database=createPool({...runtime,database:{...runtime.database,max:1}});
  const pool=createPool({...runtime,database:{...runtime.database,max:2,options:`-c search_path=${schema} -c timezone=Pacific/Honolulu`}});
  const credentials=await adminCredentials();
  const headers=credentials.headers(await credentials.token({roles:['inventory_admin','profitability_write']}));
  const orders=new PgOrderRepository(pool);
  // Test-only factory injection, never a process environment or deployment change.
  const app=buildApp({products:new PgProductRepository(pool),orders,frontendOrigin:credentials.config.frontendOrigin,
    profitability:createProfitabilityApi(pool,credentials.config,{enabled:true,demoWrites:false},credentials.resolver)!});
  let created=false;
  t.after(async()=>{try{await app.close();await pool.end();if(created)await database.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await database.end();}});
  await database.query(`CREATE SCHEMA "${schema}"`);created=true;
  assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
  // Simulate the existing pre-finance deployment, including its genuine migration
  // checksums. Only the normal runner below applies 004 to this populated schema.
  const setup=await pool.connect();
  try{
    await setup.query('BEGIN');
    await setup.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of ['001_foundation.sql','002_order_tracking.sql','003_cart_reservations.sql']){
      const sql=await readFile(new URL('migrations/'+name,databaseDirectory),'utf8');await setup.query(sql);
      await setup.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    await setup.query('COMMIT');
  }catch(error){await setup.query('ROLLBACK');throw error;}finally{setup.release();}
  const catalog=JSON.parse(await readFile(new URL('seed/products.json',databaseDirectory),'utf8')) as {id:string;name:string;description:string;category:string;price:number;imageUrl:string}[];
  for(const id of ['prod_001','prod_007']){
    const p=catalog.find(p=>p.id===id)!;
    // Catalog metadata only, copied into this private test schema; no seed command.
    await pool.query('INSERT INTO products(id,name,description,category,price,image_url) VALUES ($1,$2,$3,$4,$5,$6)',[p.id,p.name,p.description,p.category,String(p.price),p.imageUrl]);
    await pool.query("INSERT INTO inventory(product_id,city,quantity) VALUES ($1,'pune',10),($1,'delhi',10),($1,'bengaluru',10)",[id]);
  }
  await pool.query("INSERT INTO orders(id,city,status,total,created_at) VALUES ('legacy_earbuds','bengaluru','confirmed',3996,'2026-01-02T12:00:00Z')");
  await pool.query("INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES ('legacy_earbuds','prod_001',4,999)");
  const sessionId=randomUUID(),holdId=randomUUID(),eventId=randomUUID();
  await pool.query("INSERT INTO cart_sessions(id,token_hash,created_at,expires_at) VALUES ($1,$2,clock_timestamp(),clock_timestamp()+interval '1 day')",[sessionId,randomBytes(32)]);
  await pool.query("INSERT INTO cart_reservations(id,session_id,product_id,city,quantity,state,created_at,expires_at,updated_at) VALUES ($1,$2,'prod_001','pune',1,'active',clock_timestamp(),clock_timestamp()+interval '30 seconds',clock_timestamp())",[holdId,sessionId]);
  await pool.query("INSERT INTO outbox_events(id,event_type,payload) VALUES ($1,'inventory.changed',$2)",[eventId,{eventId,type:'inventory.changed',schemaVersion:2,productId:'prod_001',city:'pune',quantity:10,reservedQuantity:1,availableQuantity:9,inventoryVersion:1,occurredAt:new Date().toISOString(),nextExpirationAt:new Date(Date.now()+30000).toISOString(),causes:['reservation.created']}]);
  const commerce=async()=>{
    const data:Record<string,unknown>={};
    for(const [table,sort] of [['products','id'],['inventory','product_id,city'],['orders','id'],['order_items','id'],['order_status_history','id'],['cart_sessions','id'],['cart_reservations','id'],['outbox_events','id']])data[table!]=(await pool.query(`SELECT * FROM ${table} ORDER BY ${sort}`)).rows;
    return data;
  };
  const beforeUpgrade=await commerce();
  const costPath=(id:string,city?:City)=>`/api/admin/products/${id}/costs${city?'?city='+city:''}`;
  const get=(url:string)=>app.inject({url,headers});
  const save=async(id:string,costs:CostInputs,city?:City,effectiveAt:string|null=null)=>{
    const current=await get(costPath(id,city));assert.equal(current.statusCode,200,current.body);
    const r=await app.inject({method:'PUT',url:costPath(id,city),headers:{...headers,'if-match':String(current.headers.etag)},payload:{currency:'INR',effectiveAt,costs}});
    assert.equal(r.statusCode,200,r.body);return r;
  };
  const earbuds:CostInputs={procurementPaisePerUnit:'100000',retailerShippingPaisePerUnit:'18000',packagingPaisePerUnit:'3000',labourPaisePerUnit:'2000',paymentProcessing:{method:'per_unit',paisePerUnit:'4000'},nonRecoverableTaxesPaisePerUnit:'0',overheadPaisePerUnit:'5000'};
  const jacket:CostInputs={procurementPaisePerUnit:'80000',retailerShippingPaisePerUnit:'8000',packagingPaisePerUnit:'2500',labourPaisePerUnit:'1500',paymentProcessing:{method:'rate',basisPoints:200},nonRecoverableTaxesPaisePerUnit:'1000',overheadPaisePerUnit:'4000'};
  await t.test('004 preserves populated catalog, inventory, orders, tracking, reservations and outbox; second runner call is a no-op',async()=>{
    assert.equal(await migrate(pool),1);assert.deepEqual(await commerce(),beforeUpgrade);
    assert.equal(await migrate(pool),0);assert.deepEqual(await commerce(),beforeUpgrade);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM product_cost_versions')).rows[0].count,0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM order_financial_snapshots')).rows[0].count,0);
  });
  await t.test('earbuds and jackets use catalog IDs but independent complete cost profiles and product-bound ETags',async()=>{
    await save('prod_001',earbuds);await save('prod_007',jacket);
    const ear=await get(costPath('prod_001')),coat=await get(costPath('prod_007'));
    assert.equal(ear.json().effective.costs.procurementPaisePerUnit,'100000');assert.equal(coat.json().effective.costs.procurementPaisePerUnit,'80000');assert.notEqual(ear.headers.etag,coat.headers.etag);
    const wrong=await app.inject({method:'PUT',url:costPath('prod_007'),headers:{...headers,'if-match':String(ear.headers.etag)},payload:{currency:'INR',effectiveAt:null,costs:earbuds}});
    assert.equal(wrong.statusCode,412);assert.equal((await get(costPath('prod_007'))).json().latest.version,1);
    assert.equal((await get(costPath('PROD_001'))).statusCode,404);assert.equal((await get('/api/admin/products/%20/costs')).statusCode,400);
    for(const id of ['prod_001','prod_007']){
      const product=await app.inject(`/api/products/${id}?city=delhi`);assert.equal(product.statusCode,200);assert.equal(product.json().id,id);assert.equal(product.json().city,'delhi');assert.ok(!Object.hasOwn(product.json(),'costs'));
    }
  });
  await t.test('whole-city overrides preserve explicit unknown/zero, missing overrides inherit, and future overrides do not apply early',async()=>{
    await save('prod_001',{...earbuds,procurementPaisePerUnit:'105000',retailerShippingPaisePerUnit:'15000'},'pune');
    await save('prod_007',{...jacket,procurementPaisePerUnit:null,packagingPaisePerUnit:'0'},'pune');
    await save('prod_007',{...jacket,procurementPaisePerUnit:'75000',paymentProcessing:{method:'per_unit',paisePerUnit:'2500'}},'delhi');
    const unknown=await get(costPath('prod_007','pune'));assert.equal(unknown.json().effective.costs.procurementPaisePerUnit,null);assert.equal(unknown.json().effective.costs.packagingPaisePerUnit,'0');assert.equal(unknown.json().inheritedEffective,null);
    const fallback=await get(costPath('prod_001','delhi'));assert.equal(fallback.json().effective,null);assert.equal(fallback.json().inheritedEffective.productId,'prod_001');assert.equal(fallback.json().inheritedEffective.costs.procurementPaisePerUnit,'100000');
    const future=(await pool.query("SELECT clock_timestamp()+interval '1 day' AS time")).rows[0].time.toISOString();
    await save('prod_001',{...earbuds,procurementPaisePerUnit:'95000'},'bengaluru',future);
    const scheduled=await get(costPath('prod_001','bengaluru'));assert.equal(scheduled.json().latest.costs.procurementPaisePerUnit,'95000');assert.equal(scheduled.json().effective,null);assert.equal(scheduled.json().inheritedEffective.costs.procurementPaisePerUnit,'100000');
    assert.deepEqual(await commerce(),beforeUpgrade);
  });
  // Capture is invoked only on explicit isolated fixtures in their creation tx.
  // This does not connect capture to normal checkout or classify revenue as known.
  for(const city of ['pune','delhi'] as const){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const total=city==='pune'?'9395.00':'3798.00'; // 2x1999+3x1799, or one of each.
      await client.query("INSERT INTO orders(id,city,status,total,created_at) VALUES ($1,$2,'confirmed',$3,'2026-01-03T12:00:00Z')",['sale_'+city,city,total]);
      await client.query("INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES ($1,'prod_001',$2,1999),($1,'prod_007',$3,1799)",['sale_'+city,city==='pune'?2:1,city==='pune'?3:1]);
      await captureOrderFinancials(client,'sale_'+city);await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  const window='from=2026-01-03&to=2026-01-04';
  await t.test('product detail, overview filter, keysets and byCity never combine unrelated products or cities',async()=>{
    const ear=await get(`/api/admin/profitability/products/prod_001?${window}`);assert.equal(ear.statusCode,200,ear.body);
    assert.equal(ear.json().report.productId,'prod_001');assert.equal(ear.json().product.coverage.unitsSold,3);assert.equal(ear.json().product.costs.procurement.paise,'310000');assert.equal(ear.json().product.metrics.totalCost.paise,'400000');
    assert.deepEqual(ear.json().byCity.map((r:{city:string;summary:{costs:{procurement:{paise:string|null}}}})=>[r.city,r.summary.costs.procurement.paise]),[['pune','210000'],['delhi','100000'],['bengaluru','0']]);
    const selected=await get(`/api/admin/profitability/products/prod_007?${window}&city=delhi`);assert.equal(selected.json().product.coverage.unitsSold,1);assert.equal(selected.json().product.costs.procurement.paise,'75000');assert.equal(selected.json().product.metrics.totalCost.paise,'94500');assert.deepEqual(selected.json().byCity.map((r:{city:string})=>r.city),['delhi']);
    const partial=await get(`/api/admin/profitability/products/prod_007?${window}`);assert.equal(partial.json().product.coverage.unitsSold,4);assert.equal(partial.json().product.costs.procurement.paise,null);assert.equal(partial.json().product.metrics.totalCost.paise,null);
    const filtered=await get(`/api/admin/profitability/overview?${window}&productId=prod_001&city=pune`);assert.equal(filtered.json().summary.coverage.unitsSold,2);assert.equal(filtered.json().summary.costs.procurement.paise,'210000');
    const first=await get(`/api/admin/profitability/products?${window}&limit=1`);assert.equal(first.json().products[0].productId,'prod_001');
    const second=await get(`/api/admin/profitability/products?${window}&limit=1&cursor=${first.json().page.nextCursor}`);assert.equal(second.json().products[0].productId,'prod_007');assert.equal(second.json().page.nextCursor,null);
    const one=await get(`/api/admin/profitability/products?${window}&productId=prod_007`);assert.deepEqual(one.json().products.map((p:ProductProfitability)=>p.productId),['prod_007']);
    assert.equal((await get(`/api/admin/profitability/products?${window}&productId=PROD_001`)).json().products.length,0);
    assert.equal(ear.json().product.outcome,'unknown');assert.equal(ear.json().product.metrics.contributionProfit.paise,null);assert.equal(ear.json().product.metrics.profitMargin.basisPoints,null);
  });
  await t.test('later versions remain product/city scoped and cannot rewrite captured or legacy financial costs',async()=>{
    const before=await commerce(),old=await get(costPath('prod_001','pune'));
    const payload={currency:'INR',effectiveAt:null,costs:{...earbuds,procurementPaisePerUnit:'120000',packagingPaisePerUnit:'9999'}};
    const request=()=>app.inject({method:'PUT',url:costPath('prod_001','pune'),headers:{...headers,'if-match':String(old.headers.etag)},payload});
    const raced=await Promise.all([request(),request()]);assert.deepEqual(raced.map(r=>r.statusCode).sort(),[200,412]);
    assert.equal((await get(costPath('prod_001','pune'))).json().latest.version,2);
    assert.equal((await get(costPath('prod_007','pune'))).json().latest.version,1);assert.equal((await get(costPath('prod_001','delhi'))).json().inheritedEffective.costs.procurementPaisePerUnit,'100000');
    const frozen=await get(`/api/admin/profitability/products/prod_001?${window}&city=pune`);assert.equal(frozen.json().product.costs.procurement.paise,'210000');assert.equal(frozen.json().product.costs.packaging.paise,'6000');
    const legacy=await get('/api/admin/profitability/products/prod_001?from=2026-01-02&to=2026-01-03&city=bengaluru');assert.equal(legacy.json().product.coverage.legacyLineCount,1);assert.equal(legacy.json().product.coverage.unitsSold,4);assert.equal(legacy.json().product.metrics.totalCost.paise,null);assert.equal(legacy.json().product.metrics.grossSales.paise,null);
    assert.deepEqual(await commerce(),before);
  });
});
