import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { JWTVerifyGetKey } from 'jose';
import type { AdminConfig } from '../config/admin.js';
import type { ProfitabilityConfig } from '../config/profitability.js';
import { PgProfitabilityRepository } from '../repositories/profitability.js';
import { AdminCursor,invalidCursor } from './admin-cursor.js';
import { createAdminAuthorizer,type AdminAuthorizer,type AdminPrincipal } from './admin-auth.js';
import { summarize } from './profitability-calculation.js';
import { reportFilters,validProductId } from './profitability-validation.js';
import { ApiError } from './products.js';
import type { FinancialLine,ProfitFilters,ProfitQuery,ProductProfitability } from '../types/profitability.js';
import { cities } from '../types/product.js';

function product(lines:FinancialLine[],meta:{id:string;name:string;category:string}):ProductProfitability {
  const summary=summarize(lines),profit=summary.metrics.profitAfterOverhead.paise;
  const outcome=!lines.length?'no_sales':profit===null?'unknown':BigInt(profit)<0n?'loss':BigInt(profit)>0n?'profitable':'break_even';
  return {...summary,productId:meta.id,name:meta.name,category:meta.category,outcome};
}
function trend(lines:FinancialLine[],filters:ProfitFilters) {
  const groups=new Map<string,FinancialLine[]>();for(const line of lines) {const group=groups.get(line.date)??[];group.push(line);groups.set(line.date,group);}
  const result=[];
  for(let time=Date.parse(filters.from+'T00:00:00Z');time<Date.parse(filters.to+'T00:00:00Z');time+=86400000) {
    const date=new Date(time).toISOString().slice(0,10),summary=summarize(groups.get(date)??[]);
    result.push({date,netRevenue:summary.metrics.netRevenue,totalCost:summary.metrics.totalCost,profitAfterOverhead:summary.metrics.profitAfterOverhead,orderCount:summary.coverage.orderCount});
  }
  return result;
}
export class ProfitabilityService {
  constructor(readonly repository:PgProfitabilityRepository,private readonly cursors:AdminCursor) {}
  async report(mode:'overview'|'products'|'detail',query:ProfitQuery,scope:string,pathProduct?:string) {
    const filters=reportFilters(query);if(pathProduct) filters.productId=pathProduct;
    const limit=Number(query.limit??'50');
    const after=query.cursor!==undefined?this.cursors.decode(query.cursor,'profitability/products',filters,limit,scope):undefined;
    if(after&&(!validProductId(after[0])||after[1]!=='profitability-products')) throw invalidCursor();
    return this.repository.transaction(true,async(client,time)=>{
      const report={asOf:new Date(time).toISOString(),currency:'INR',from:filters.from,to:filters.to,timeZone:'Asia/Kolkata',city:filters.city??null,productId:filters.productId??null};
      const meta=pathProduct?await this.repository.product(client,pathProduct):undefined;
      const page=mode==='products'?await this.repository.productPage(client,filters,limit,after?.[0]):undefined;
      const selected=page?.slice(0,limit);
      const lines=await this.repository.lines(client,filters,selected);
      if(mode==='overview') return {report,summary:summarize(lines),trend:trend(lines,filters)};
      if(mode==='detail') return {report,product:product(lines,meta!),byCity:(filters.city?[filters.city]:cities).map(city=>({city,summary:summarize(lines.filter(l=>l.city===city))})),trend:trend(lines,filters)};
      const groups=new Map<string,FinancialLine[]>();for(const line of lines) {const group=groups.get(line.productId)??[];group.push(line);groups.set(line.productId,group);}
      return {report,products:(selected??[]).map(id=>{const group=groups.get(id)!;return product(group,{id,name:group[0]!.name,category:group[0]!.category});}),
        page:{limit,nextCursor:page&&page.length>limit?this.cursors.encode('profitability/products',filters,limit,scope,[selected!.at(-1)!,'profitability-products']):null}};
    });
  }
}
export interface ProfitabilityApi { authorize:AdminAuthorizer;config:ProfitabilityConfig;origin:string;service:ProfitabilityService }
export function createProfitabilityApi(pool:Pool,admin:AdminConfig,config:ProfitabilityConfig,keys?:JWTVerifyGetKey):ProfitabilityApi|undefined {
  if(!config.enabled||admin.mode==='disabled') return undefined;
  return {authorize:createAdminAuthorizer(admin,keys),config,origin:admin.frontendOrigin,
    service:new ProfitabilityService(new PgProfitabilityRepository(pool,admin.cursorSecret),new AdminCursor(admin.cursorSecret))};
}
export function profitabilityActor(principal:AdminPrincipal,config:ProfitabilityConfig):string {
  const identity=principal.identity;
  if(identity?.kind==='local-demo'&&config.demoWrites) return 'local-demo';
  if(identity?.kind==='jwt'&&identity.subject&&identity.roles.includes('profitability_write')) return 'jwt:'+createHash('sha256').update(JSON.stringify([identity.issuer,identity.subject])).digest('hex');
  throw new ApiError(403,'FORBIDDEN','Profitability write access required');
}
