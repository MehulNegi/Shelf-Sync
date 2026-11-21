import type { PoolClient } from 'pg';
import { costInputs,type CostRow } from '../repositories/profitability.js';
import { profileEstimates } from './profitability-calculation.js';

// Prepared, deliberately NOT connected to checkout until the C8.1 policy gate is resolved.
// The caller must own the confirmation transaction and propagate structural errors.
export async function captureOrderFinancials(client:PoolClient,orderId:string):Promise<boolean> {
  await client.query('SAVEPOINT profitability_capture'); // Reject autocommit callers.
  try {
    if((await client.query('SELECT 1 FROM order_financial_snapshots WHERE order_id=$1',[orderId])).rowCount) {await client.query('RELEASE SAVEPOINT profitability_capture');return false;}
    type Row=CostRow & {order_id:string;item_id:string;product_id:string;city:string;quantity:number;unit_price:string;order_created:string;business_date:string;confirmed_at:string|null;snapshot_time:string;profile_version_id:string|null};
    const {rows}=await client.query<Row>(`WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS time)
      SELECT v.*,o.id AS order_id,i.id::text AS item_id,i.product_id,o.city,i.quantity,i.unit_price::text,
        o.created_at::text AS order_created,(o.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS business_date,
        (SELECT min(occurred_at)::text FROM order_status_history WHERE order_id=o.id AND status='confirmed') AS confirmed_at,
        decision.time::text AS snapshot_time,v.id::text AS profile_version_id
      FROM orders o JOIN order_items i ON i.order_id=o.id CROSS JOIN decision
      LEFT JOIN LATERAL (SELECT * FROM product_cost_versions c WHERE c.product_id=i.product_id AND c.scope_key IN ('global',o.city)
        AND c.effective_at<=decision.time ORDER BY (c.scope_key=o.city) DESC,c.effective_at DESC,c.version DESC LIMIT 1) v ON true
      WHERE o.id=$1 AND o.xmin::text::bigint=(txid_current()%4294967296)
        AND (o.status='confirmed' OR EXISTS(SELECT 1 FROM order_status_history h WHERE h.order_id=o.id AND h.status='confirmed'))
      ORDER BY i.id`,[orderId]);
    const first=rows[0];if(!first) throw new Error('Snapshot capture requires a new confirmed order in the current transaction');
    await client.query(`INSERT INTO order_financial_snapshots(order_id,currency,city,business_date,order_created_at,confirmed_at,snapshot_at,calculation_version,pricing_policy,source)
      VALUES ($1,'INR',$2,$3,$4,$5,$6,'c8-v1','unresolved','recorded_order')`,[orderId,first.city,first.business_date,first.order_created,first.confirmed_at,first.snapshot_time]);
    for(const row of rows) {
      const match=/^(\d+)\.(\d{2})$/.exec(row.unit_price);if(!match) throw new Error('Invalid recorded unit price');
      const charged=BigInt(match[1]!)*100n+BigInt(match[2]!);
      const costs=row.profile_version_id?costInputs(row):null;
      const inputs=profileEstimates(costs,row.quantity);
      await client.query(`INSERT INTO order_item_financial_snapshots(order_item_id,order_id,product_id,profile_version_id,quantity,charged_unit_price_paise,returned_units,amounts,profile_payment)
        VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)`,[row.item_id,orderId,row.product_id,row.profile_version_id,row.quantity,charged.toString(),inputs,costs?.paymentProcessing??null]);
    }
    await client.query('RELEASE SAVEPOINT profitability_capture');return true;
  } catch(error) {await client.query('ROLLBACK TO SAVEPOINT profitability_capture');await client.query('RELEASE SAVEPOINT profitability_capture');throw error;}
}
