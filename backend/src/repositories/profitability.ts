import { createHmac } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { City } from '../types/product.js';
import type { CostInputs,CostProfile,CostsResponse,CostWrite,FinancialLine,FinancialInputs,ProfitFilters } from '../types/profitability.js';
import { ApiError } from '../services/products.js';
import { unknownInputs } from '../services/profitability-calculation.js';

export interface CostRow {
  id:string;product_id:string;scope_key:string;version:number;effective_at:Date;recorded_at:Date;
  procurement_paise:string|null;shipping_paise:string|null;packaging_paise:string|null;labour_paise:string|null;
  taxes_paise:string|null;overhead_paise:string|null;payment_method:'rate'|'per_unit'|null;payment_paise:string|null;payment_bps:number|null;
}
export function costInputs(row:CostRow):CostInputs {
  return {procurementPaisePerUnit:row.procurement_paise,retailerShippingPaisePerUnit:row.shipping_paise,packagingPaisePerUnit:row.packaging_paise,
    labourPaisePerUnit:row.labour_paise,nonRecoverableTaxesPaisePerUnit:row.taxes_paise,overheadPaisePerUnit:row.overhead_paise,
    paymentProcessing:row.payment_method==='rate'?{method:'rate',basisPoints:row.payment_bps!}:row.payment_method==='per_unit'?{method:'per_unit',paisePerUnit:row.payment_paise!}:null};
}
function profile(row:CostRow|undefined):CostProfile|null {
  return row?{productId:row.product_id,city:row.scope_key==='global'?null:row.scope_key as City,currency:'INR',version:row.version,
    effectiveAt:row.effective_at.toISOString(),updatedAt:row.recorded_at.toISOString(),costs:costInputs(row)}:null;
}
export class PgProfitabilityRepository {
  constructor(readonly pool:Pool,private readonly etagSecret:Buffer) {}
  private etag(productId:string,scope:string,version:number) {return '"pc-'+createHmac('sha256',this.etagSecret).update(JSON.stringify([productId,scope,version])).digest('base64url')+'"';}
  async transaction<T>(readOnly:boolean,work:(client:PoolClient,time:string)=>Promise<T>):Promise<T> {
    let client:PoolClient;
    try {client=await this.pool.connect();} catch {throw new ApiError(503,'DATABASE_UNAVAILABLE','Profitability data is temporarily unavailable');}
    let discard=false;
    try {
      await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL statement_timeout='10s'");
      const time=(await client.query<{time:string}>('SELECT statement_timestamp()::text AS time')).rows[0]!.time;
      const result=await work(client,time);await client.query('COMMIT');return result;
    } catch(error) {
      try {await client.query('ROLLBACK');} catch {discard=true;}
      if(error instanceof ApiError) throw error;
      const e=error as {code?:string;message?:string};
      if(/^(08|53|55|57|58|E)/.test(e.code??'')||e.message==='Cannot use a pool after calling end on the pool') throw new ApiError(503,'DATABASE_UNAVAILABLE','Profitability data is temporarily unavailable');
      throw new ApiError(500,'INTERNAL_ERROR','An internal server error occurred');
    } finally {client.release(discard);}
  }
  async product(client:PoolClient,id:string) {
    const row=(await client.query<{id:string;name:string;category:string}>('SELECT id,name,category FROM products WHERE id=$1',[id])).rows[0];
    if(!row) throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');return row;
  }
  private async readCostScope(client:PoolClient,productId:string,city:City|undefined,time:string) {
    const scope=city??'global';
    const head=(await client.query<CostRow>('SELECT * FROM product_cost_versions WHERE product_id=$1 AND scope_key=$2 ORDER BY version DESC LIMIT 1',[productId,scope])).rows[0];
    const effective=(await client.query<CostRow>('SELECT * FROM product_cost_versions WHERE product_id=$1 AND scope_key=$2 AND effective_at<=$3 ORDER BY version DESC LIMIT 1',[productId,scope,time])).rows[0];
    const inherited=city&&!effective?(await client.query<CostRow>("SELECT * FROM product_cost_versions WHERE product_id=$1 AND scope_key='global' AND effective_at<=$2 ORDER BY version DESC LIMIT 1",[productId,time])).rows[0]:undefined;
    const body:CostsResponse={productId,city:city??null,currency:'INR',latest:profile(head),effective:profile(effective),inheritedEffective:profile(inherited)};
    return {body,etag:this.etag(productId,scope,head?.version??0)};
  }
  readCosts(productId:string,city?:City) {
    return this.transaction(true,async(client,time)=>{await this.product(client,productId);return this.readCostScope(client,productId,city,time);});
  }
  writeCosts(productId:string,city:City|undefined,write:CostWrite,ifMatch:string,actor:string) {
    return this.transaction(false,async client=>{
      await this.product(client,productId);
      const scope=city??'global';
      await client.query('INSERT INTO product_cost_scopes(product_id,scope_key) VALUES ($1,$2) ON CONFLICT DO NOTHING',[productId,scope]);
      const {rows}=await client.query<{revision:number}>('SELECT revision FROM product_cost_scopes WHERE product_id=$1 AND scope_key=$2 FOR UPDATE',[productId,scope]);
      const revision=rows[0]!.revision;
      if(ifMatch!==this.etag(productId,scope,revision)) throw new ApiError(412,'COST_VERSION_CONFLICT','Cost profile version changed; reload before saving');
      const time=(await client.query<{time:string}>('SELECT clock_timestamp()::text AS time')).rows[0]!.time;
      const conflict=await client.query(`SELECT 1 WHERE ($1::timestamptz IS NOT NULL AND $1::timestamptz<$2::timestamptz)
        OR EXISTS(SELECT 1 FROM product_cost_versions WHERE product_id=$3 AND scope_key=$4 AND effective_at>=COALESCE($1::timestamptz,$2::timestamptz))`,[write.effectiveAt,time,productId,scope]);
      if(conflict.rowCount) throw new ApiError(409,'COST_EFFECTIVE_CONFLICT','Cost effective time conflicts with an existing version');
      const c=write.costs,p=c.paymentProcessing;
      await client.query(`INSERT INTO product_cost_versions(product_id,scope_key,version,currency,effective_at,recorded_at,actor_ref,
        procurement_paise,shipping_paise,packaging_paise,labour_paise,taxes_paise,overhead_paise,payment_method,payment_paise,payment_bps)
        VALUES ($1,$2,$3,'INR',COALESCE($4::timestamptz,$5::timestamptz),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [productId,scope,revision+1,write.effectiveAt,time,actor,c.procurementPaisePerUnit,c.retailerShippingPaisePerUnit,c.packagingPaisePerUnit,c.labourPaisePerUnit,
        c.nonRecoverableTaxesPaisePerUnit,c.overheadPaisePerUnit,p?.method??null,p?.method==='per_unit'?p.paisePerUnit:null,p?.method==='rate'?p.basisPoints:null]);
      await client.query('UPDATE product_cost_scopes SET revision=$3 WHERE product_id=$1 AND scope_key=$2',[productId,scope,revision+1]);
      return this.readCostScope(client,productId,city,time);
    });
  }
  private conditions(filters:ProfitFilters,extra?:{ids?:string[];after?:string}) {
    const values:unknown[]=[filters.from,filters.to];
    const clauses=["o.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')","o.created_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')",
      "(o.status='confirmed' OR h.order_id IS NOT NULL OR EXISTS(SELECT 1 FROM order_status_history hist WHERE hist.order_id=o.id AND hist.status='confirmed'))"];
    const add=(sql:string,value:unknown)=>{values.push(value);clauses.push(sql.replace('?',`$${values.length}`));};
    if(filters.city) add('o.city=?',filters.city);if(filters.productId) add('i.product_id=?',filters.productId);
    if(extra?.ids) add('i.product_id=ANY(?::text[])',extra.ids);if(extra?.after) add('i.product_id COLLATE "C">?::text COLLATE "C"',extra.after);
    return {values,where:'WHERE '+clauses.join(' AND ')};
  }
  async productPage(client:PoolClient,filters:ProfitFilters,limit:number,after?:string) {
    const q=this.conditions(filters,after?{after}:undefined);q.values.push(limit+1);
    const {rows}=await client.query<{product_id:string}>(`SELECT DISTINCT i.product_id COLLATE "C" AS product_id FROM orders o JOIN order_items i ON i.order_id=o.id
      LEFT JOIN order_financial_snapshots h ON h.order_id=o.id ${q.where} ORDER BY product_id LIMIT $${q.values.length}`,q.values);
    return rows.map(r=>r.product_id);
  }
  async lines(client:PoolClient,filters:ProfitFilters,ids?:string[]):Promise<FinancialLine[]> {
    if(ids?.length===0) return [];
    const q=this.conditions(filters,ids?{ids}:undefined);
    await client.query(`DECLARE profitability_lines NO SCROLL CURSOR FOR SELECT o.id AS order_id,i.id::text AS item_id,i.product_id,p.name,p.category,o.city,
      (o.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS date,i.quantity,s.returned_units,s.amounts,
      s.order_item_id IS NULL AS legacy FROM orders o JOIN order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id
      LEFT JOIN order_financial_snapshots h ON h.order_id=o.id LEFT JOIN order_item_financial_snapshots s ON s.order_item_id=i.id
      ${q.where} ORDER BY o.created_at,o.id,i.id`,q.values);
    const result:FinancialLine[]=[];
    while(true) {
      const {rows}=await client.query<{order_id:string;item_id:string;product_id:string;name:string;category:string;city:City;date:string;quantity:number;returned_units:number|null;amounts:FinancialInputs|null;legacy:boolean}>('FETCH FORWARD 500 FROM profitability_lines');
      if(!rows.length) break;
      for(const r of rows) result.push({orderId:r.order_id,itemId:r.item_id,productId:r.product_id,name:r.name,category:r.category,city:r.city,date:r.date,
        quantity:r.quantity,returnedUnits:r.returned_units,legacy:r.legacy,inputs:r.amounts??unknownInputs()});
    }
    await client.query('CLOSE profitability_lines');return result;
  }
}
