import type { Pool } from 'pg';
import type { City } from '../types/product.js';
import { InventoryTransaction } from '../db/inventory.js';
import { transaction } from '../db/transaction.js';
import { pause } from './publisher.js';

export async function reconcileReservations(pool: Pool) {
  return transaction(pool,async client=>{
    const {rows}=await client.query<{product_id:string;city:City}>(`SELECT product_id,city FROM cart_reservations
      WHERE state='active' AND expires_at<=clock_timestamp() GROUP BY product_id,city ORDER BY product_id COLLATE "C",city COLLATE "C" LIMIT 100`);
    const inventory=await InventoryTransaction.lock(client,rows.map(r=>({productId:r.product_id,city:r.city})),true);
    await inventory.reconcile(); await inventory.flush();
    return inventory.changed.size;
  });
}
export async function pruneReservations(pool: Pool) {
  // Retain consumed reservations and their parent sessions while orders exist.
  await pool.query(`DELETE FROM reservation_rate_limits WHERE ctid IN (SELECT ctid FROM reservation_rate_limits WHERE expires_at<clock_timestamp() LIMIT 100)`);
  await pool.query(`DELETE FROM cart_idempotency WHERE ctid IN (SELECT k.ctid FROM cart_idempotency k JOIN cart_sessions s ON s.id=k.session_id WHERE s.expires_at<clock_timestamp()-interval '24 hours' LIMIT 100)`);
  await pool.query(`DELETE FROM cart_reservations WHERE ctid IN (SELECT r.ctid FROM cart_reservations r JOIN cart_sessions s ON s.id=r.session_id WHERE r.state IN ('expired','released') AND s.expires_at<clock_timestamp()-interval '24 hours' LIMIT 100)`);
  await pool.query(`DELETE FROM cart_sessions WHERE id IN (SELECT s.id FROM cart_sessions s WHERE s.expires_at<clock_timestamp()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM cart_reservations r WHERE r.session_id=s.id) AND NOT EXISTS(SELECT 1 FROM cart_idempotency k WHERE k.session_id=s.id) LIMIT 100)`);
}
export async function runReservationExpiry(pool: Pool, signal: AbortSignal, log: (entry: {event:string;count?:number;retryInMs?:number})=>void) {
  let failures=0;
  try {
    while(!signal.aborted) {
      try {
        const count=await reconcileReservations(pool);
        if(signal.aborted) break;
        await pruneReservations(pool); failures=0;
        if(count) log({event:'reservations_expired',count});
        await pause(1000,signal);
      } catch {
        const retryInMs=Math.min(30000,1000*2**Math.min(failures++,5));
        log({event:'reservation_expiry_retry',retryInMs}); await pause(retryInMs,signal);
      }
    }
  } finally {await pool.end();log({event:'reservation_expiry_stopped'});}
}
