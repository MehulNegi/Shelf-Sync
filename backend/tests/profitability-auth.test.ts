import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { createProfitabilityApi } from '../src/services/profitability.js';
import { adminCredentials } from './helpers/admin.js';

const base={frontendOrigin:'http://localhost:5173',products:{async list(){return[];},async findById(){return undefined;}},orders:{async checkout(){assert.fail();},async findById(){return undefined;}}};
const noData={async connect(){assert.fail('Unauthorized/invalid request reached financial data');}} as unknown as Pool;
const readPaths=['/api/admin/profitability/overview','/api/admin/profitability/products','/api/admin/profitability/products/test','/api/admin/products/test/costs'];
test('profitability is default-off and overlong financial IDs retain the contract 400 error',async t=>{
  const app=buildApp(base);t.after(()=>app.close());
  for(const path of readPaths)assert.equal((await app.inject(path)).statusCode,503);
  assert.equal((await app.inject({method:'PUT',url:'/api/admin/products/test/costs'})).statusCode,503);
  assert.equal((await app.inject('/api/admin/products/'+'x'.repeat(101)+'/costs')).statusCode,400);
  assert.equal((await app.inject('/api/orders/'+'x'.repeat(101)+'/tracking')).statusCode,414);
});
test('signed admin identity, extra write role, stable subject, TLS and exact Origin gate every cost write',async t=>{
  const c=await adminCredentials();const config={enabled:true,demoWrites:false};
  const app=buildApp({...base,profitability:createProfitabilityApi(noData,c.config,config,c.resolver)!});t.after(()=>app.close());
  for(const path of readPaths) {
    const r=await app.inject(path);assert.equal(r.statusCode,401);assert.equal(r.headers['www-authenticate'],'Bearer');assert.equal(r.headers['cache-control'],'no-store');
  }
  for(const token of [await c.token(),await c.token({roles:['inventory_admin','profitability_write']},['sub']),await c.token({roles:['profitability_write']})]) {
    const r=await app.inject({method:'PUT',url:'/api/admin/products/test/costs',headers:c.headers(token),payload:{}});assert.equal(r.statusCode,403);
  }
  const token=await c.token({roles:['inventory_admin','profitability_write']});
  for(const extra of [{origin:'https://evil.test'},{origin:'null'},{'x-forwarded-proto':'http'}])assert.equal((await app.inject({method:'PUT',url:'/api/admin/products/test/costs',headers:{...c.headers(token),...extra},payload:{}})).statusCode,403);
  const nonJson=await app.inject({method:'PUT',url:'/api/admin/products/test/costs',headers:{...c.headers(token),'content-type':'text/plain'},payload:'secret input'});assert.equal(nonJson.statusCode,415);assert.ok(!nonJson.body.includes('secret input'));
  assert.equal((await app.inject({method:'PUT',url:'/api/admin/products/test/costs',headers:c.headers(token),payload:{}})).statusCode,428);
});
test('local financial reads retain loopback restrictions and demo writes require a separate explicit opt-in',async t=>{
  const admin={mode:'local-demo' as const,cursorSecret:randomBytes(32),frontendOrigin:base.frontendOrigin};
  const apps=[false,true].map(demoWrites=>buildApp({...base,profitability:createProfitabilityApi(noData,admin,{enabled:true,demoWrites})!}));t.after(async()=>{for(const app of apps)await app.close();});
  const headers={host:'localhost:3000',origin:base.frontendOrigin};
  assert.equal((await apps[0]!.inject({method:'PUT',url:'/api/admin/products/test/costs',headers,payload:{}})).statusCode,403);
  assert.equal((await apps[1]!.inject({method:'PUT',url:'/api/admin/products/test/costs',headers:{host:headers.host},payload:{}})).statusCode,403);
  assert.equal((await apps[1]!.inject({method:'PUT',url:'/api/admin/products/test/costs',headers,payload:{}})).statusCode,428);
  for(const extra of [{host:'retailer.example'},{origin:'null'},{'x-forwarded-for':'127.0.0.1'}])assert.equal((await apps[1]!.inject({url:readPaths[0]!,headers:{...headers,...extra}})).statusCode,403);
  assert.equal((await apps[1]!.inject({url:readPaths[0]!,headers,remoteAddress:'192.0.2.1'})).statusCode,403);
});
test('report validation and cursor scope fail before database access',async t=>{
  const c=await adminCredentials();const app=buildApp({...base,profitability:createProfitabilityApi(noData,c.config,{enabled:true,demoWrites:false},c.resolver)!});t.after(()=>app.close());
  const headers=c.headers(await c.token());
  assert.equal((await app.inject({method:'GET',url:'/api/admin/products/test/costs',headers,payload:{unexpected:true}})).statusCode,400);
  for(const url of ['/api/admin/profitability/overview?from=2026-02-30&to=2026-03-01','/api/admin/profitability/products?from=2026-01-01&to=2026-02-01&limit=0','/api/admin/profitability/overview?from=2026-01-01&from=2026-01-02&to=2026-02-01','/api/admin/products/test/costs?unexpected=1'])assert.equal((await app.inject({url,headers})).statusCode,400);
  const cursor=await app.inject({url:'/api/admin/profitability/products?from=2026-01-01&to=2026-02-01&cursor=invalid',headers});assert.equal(cursor.statusCode,400);assert.equal(cursor.json().error.code,'INVALID_CURSOR');
});
