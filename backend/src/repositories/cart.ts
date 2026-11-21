import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ReservationConfig } from '../config/reservations.js';
import { transaction } from '../db/transaction.js';
import { InventoryTransaction, type InventoryKey } from '../db/inventory.js';
import type { CartResult, CartRow, CreateHolds, PatchHolds } from '../types/cart.js';
import type { City } from '../types/product.js';
import type { OrderInput } from '../types/order.js';
import { ApiError } from '../services/products.js';
import { cartSessionRequired } from '../services/cart-security.js';
import { placeOrder } from './orders.js';

const errorResult = (error: ApiError, retryAfter?: number): CartResult => ({ status: error.statusCode,
  body: { success: false, error: { code: error.code, message: error.message } }, ...(retryAfter ? { retryAfter } : {}) });
const fail = (code: string, message: string, status = 409): never => { throw new ApiError(status, code, message); };
interface Session { id: string; expires_at: Date }
const iso = (time: string | Date) => new Date(time).toISOString();
function envelope(rows: CartRow[], now: string) {
  return { serverTime: iso(now), reservations: [...rows].sort((a,b) => {
    const x = [a.city,a.product_id,a.id].join('\0'), y = [b.city,b.product_id,b.id].join('\0'); return x < y ? -1 : x > y ? 1 : 0;
  }).map(row => {
    const status = row.state;
    return { reservationId: row.id, productId: row.product_id, city: row.city, quantity: row.quantity, status,
      createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), updatedAt: iso(row.updated_at),
      requiresReservation: status === 'expired' || status === 'released', orderId: row.order_id };
  }) };
}

export class PgCartRepository {
  constructor(readonly pool: Pool, readonly config: ReservationConfig) {}
  async admit(client: Pick<PoolClient, 'query'>, scope: string, digest: Buffer, seconds: number, limit: number) {
    const { rows } = await client.query<{ count: number; retry: number }>(`WITH t AS (SELECT clock_timestamp() AS now), w AS (
      SELECT to_timestamp(floor(extract(epoch FROM now)/$3)*$3) AS start FROM t
    ) INSERT INTO reservation_rate_limits(scope,key_digest,window_start,count,expires_at)
      SELECT $1,$2,start,1,start+make_interval(secs=>$3) FROM w
      ON CONFLICT(scope,key_digest,window_start) DO UPDATE SET count=LEAST(reservation_rate_limits.count+1,$4+1)
      RETURNING count, GREATEST(1,ceil(extract(epoch FROM expires_at-clock_timestamp())))::int AS retry`, [scope,digest,seconds,limit]);
    const row = rows[0]!;
    return row.count > limit ? row.retry : undefined;
  }
  async consumeGatewayNonce(digest: Buffer) {
    const result = await this.pool.query(`INSERT INTO reservation_rate_limits(scope,key_digest,window_start,count,expires_at)
      VALUES ('gateway_nonce',$1,to_timestamp(0),1,clock_timestamp()+interval '1 minute')
      ON CONFLICT DO NOTHING`, [digest]);
    return result.rowCount === 1;
  }
  async httpAdmission(ip: Buffer) {
    const retry = await this.admit(this.pool, 'http', ip, 60, 1200);
    return retry ? errorResult(new ApiError(429, 'RESERVATION_RATE_LIMITED', 'Too many reservation requests'), retry) : undefined;
  }
  async session(hash: Buffer | undefined, ip: Buffer): Promise<CartResult & { token?: string; expires?: Date }> {
    if (hash) {
      const { rows } = await this.pool.query<Session & { time: string }>('SELECT id, expires_at, clock_timestamp()::text AS time FROM cart_sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()', [hash]);
      if (rows[0]) return { status: 200, body: { serverTime: iso(rows[0].time), sessionExpiresAt: iso(rows[0].expires_at) } };
    }
    const retry = await this.admit(this.pool,'session_issue',ip,3600,20);
    if (retry) return errorResult(new ApiError(429,'RESERVATION_RATE_LIMITED','Too many reservation requests'),retry);
    const token = randomBytes(32).toString('base64url');
    const digest = createHash('sha256').update(token).digest();
    const { rows } = await this.pool.query<{ created_at: Date; expires_at: Date }>(`WITH t AS (SELECT clock_timestamp() AS time)
      INSERT INTO cart_sessions(id,token_hash,created_at,expires_at) SELECT $1,$2,time,time+interval '24 hours' FROM t RETURNING created_at,expires_at`, [randomUUID(),digest]);
    const row = rows[0]!;
    return { status: 201, body: { serverTime: iso(row.created_at), sessionExpiresAt: iso(row.expires_at) }, token, expires: row.expires_at };
  }
  private async owner(client: PoolClient, hash: Buffer, lock = false) {
    const { rows } = await client.query<Session>(`SELECT id,expires_at FROM cart_sessions WHERE token_hash=$1 AND expires_at>clock_timestamp() ${lock ? 'FOR UPDATE' : ''}`, [hash]);
    if (!rows[0]) throw cartSessionRequired();
    // Also recheck time after a session lock wait.
    if (!(await client.query('SELECT 1 FROM cart_sessions WHERE id=$1 AND expires_at>clock_timestamp()', [rows[0].id])).rowCount) throw cartSessionRequired();
    return rows[0];
  }
  async read(hash: Buffer, city?: City) {
    const client = await this.pool.connect();
    let discard=false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const now = (await client.query<{ time: string }>('SELECT statement_timestamp()::text AS time')).rows[0]!.time;
      const owner = await this.owner(client,hash);
      const { rows } = await client.query<CartRow>(`SELECT DISTINCT ON (product_id,city) *, CASE WHEN state='active' AND expires_at<=$3 THEN 'expired' ELSE state END AS state FROM cart_reservations WHERE session_id=$1 AND ($2::text IS NULL OR city=$2)
        ORDER BY product_id,city,created_at DESC,id DESC`, [owner.id,city ?? null,now]);
      await client.query('COMMIT'); return { status: 200, body: envelope(rows,now) };
    } catch (error) { try { await client.query('ROLLBACK'); } catch { discard=true; } throw error; }
    finally { client.release(discard); }
  }
  async mutate(hash: Buffer, ip: Buffer, key: string, method: string, path: string, input: CreateHolds | PatchHolds | { reservationIds: string[] } | (OrderInput & { reservationIds: string[] })): Promise<CartResult> {
    const fingerprint = createHash('sha256').update(JSON.stringify([method,path,input])).digest();
    return transaction(this.pool, async client => {
      const owner = await this.owner(client,hash,true);
      const previous = (await client.query<{ request_hash: Buffer; http_status: number; response: unknown }>('SELECT * FROM cart_idempotency WHERE session_id=$1 AND key=$2',[owner.id,key])).rows[0];
      if (previous) {
        if (!previous.request_hash.equals(fingerprint)) return errorResult(new ApiError(409,'IDEMPOTENCY_CONFLICT','Idempotency key was used for a different request'));
        return { status: previous.http_status, body: previous.response };
      }
      const create = path === '/api/cart/reservations' && method === 'POST';
      const patch = method === 'PATCH';
      const retry = create ? (await this.admit(client,'session',hash,60,20) ?? await this.admit(client,'ip',ip,60,60))
        : patch ? await this.admit(client,'patch',hash,60,60) : undefined;
      if (retry) return errorResult(new ApiError(429,'RESERVATION_RATE_LIMITED','Too many reservation requests'),retry);
      await client.query('SAVEPOINT operation');
      let result: CartResult;
      try { result = await this.apply(client,owner,method,path,input); }
      catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT operation');
        result = errorResult(error, error instanceof Cooldown ? error.retry : undefined);
      }
      if ((result.status >= 200 && result.status < 300) || result.status === 409) await client.query('INSERT INTO cart_idempotency(session_id,key,request_hash,http_status,response) VALUES ($1,$2,$3,$4,$5)', [owner.id,key,fingerprint,result.status,result.body]);
      return result;
    });
  }
  private async apply(client: PoolClient, owner: Session, method: string, path: string, input: CreateHolds | PatchHolds | { reservationIds: string[] } | (OrderInput & { reservationIds: string[] })): Promise<CartResult> {
    const create = path === '/api/cart/reservations' && method === 'POST';
    const checkout = path === '/api/orders';
    const ids = 'reservationIds' in input ? input.reservationIds : 'items' in input && !create ? (input as PatchHolds).items.map(i => i.reservationId) : [];
    let owned: CartRow[] = [];
    if (!create) {
      owned = (await client.query<CartRow>('SELECT * FROM cart_reservations WHERE session_id=$1 AND id=ANY($2::uuid[])',[owner.id,ids])).rows;
      if (owned.length !== ids.length) fail('RESERVATION_NOT_FOUND','Reservation not found',404);
    }
    const keys: InventoryKey[] = create ? (input as CreateHolds).items.map(i => ({ productId:i.productId,city:(input as CreateHolds).city })) : owned.map(r => ({ productId:r.product_id,city:r.city }));
    const inventory = await InventoryTransaction.lock(client,keys);
    if (!(await client.query('SELECT 1 FROM cart_sessions WHERE id=$1 AND expires_at>$2',[owner.id,inventory.now])).rowCount) throw cartSessionRequired();
    await inventory.reconcile();
    if (!create) owned = (await client.query<CartRow>('SELECT * FROM cart_reservations WHERE session_id=$1 AND id=ANY($2::uuid[])',[owner.id,ids])).rows;
    if (checkout || method === 'PATCH') {
      for (const [state,code,message] of [
        ['consumed','RESERVATION_CONSUMED','Reservation has already been consumed'],
        ['expired','RESERVATION_EXPIRED','Reservation has expired; reserve the item again'],
        ['released','RESERVATION_NOT_ACTIVE','Reservation is not active']
      ]) if (owned.some(r => r.state === state)) fail(code!,message!);
      if (owned.some(r => r.city !== (input as PatchHolds).city)) fail('RESERVATION_MISMATCH','Reservations do not match the requested order');
    }
    const held = (await client.query<CartRow>('SELECT * FROM cart_reservations WHERE session_id=$1 AND state=\'active\' AND expires_at>$2',[owner.id,inventory.now])).rows;
    if ((create || method === 'PATCH') && held.some(r => r.city !== (input as CreateHolds).city)) fail('RESERVATION_CITY_CONFLICT','Release active reservations before changing city');
    if (checkout) {
      const order = input as OrderInput & { reservationIds: string[] };
      if (owned.length !== order.items.length || order.items.some(i => !owned.some(r => r.product_id === i.productId && r.quantity === i.quantity))) fail('RESERVATION_MISMATCH','Reservations do not match the requested order');
      const result = await placeOrder(client,order,inventory,true);
      await client.query("UPDATE cart_reservations SET state='consumed',order_id=$2,updated_at=$3 WHERE id=ANY($1::uuid[])",[ids,result.orderId,inventory.now]);
      await inventory.flush(); return { status: 201, body: result };
    }
    if (create) {
      const request = input as CreateHolds;
      const latest = (await client.query<CartRow>('SELECT DISTINCT ON(product_id,city) * FROM cart_reservations WHERE session_id=$1 ORDER BY product_id,city,created_at DESC,id DESC',[owner.id])).rows;
      if (request.items.some(i => held.some(r => r.product_id===i.productId && r.city===request.city))) fail('RESERVATION_EXISTS','An active reservation already exists');
      const newPairs = request.items.filter(i => !latest.some(r => r.product_id===i.productId && r.city===request.city)).length;
      if (held.length+request.items.length>20 || held.reduce((s,r)=>s+r.quantity,0)+request.items.reduce((s,i)=>s+i.quantity,0)>100 || latest.length+newPairs>100) fail('RESERVATION_LIMIT','Cart reservation limit reached');
      for (const item of request.items) {
        const previous = latest.find(r => r.product_id===item.productId && r.city===request.city);
        if (previous) {
          const wait = (await client.query<{ retry: number }>('SELECT ceil(extract(epoch FROM expires_at+interval \'5 seconds\'-$2::timestamptz))::int AS retry FROM cart_reservations WHERE id=$1',[previous.id,inventory.now])).rows[0]!.retry;
          if (wait>0) throw new Cooldown(wait);
        }
      }
      for (const item of request.items) {
        const k = { productId:item.productId,city:request.city };
        const stock=await inventory.snapshot(k);
        if (!stock || stock.available<item.quantity) fail('INSUFFICIENT_STOCK','Not enough stock available');
      }
      const createdIds: string[] = [];
      for (const item of request.items) {
        const id = randomUUID(); createdIds.push(id);
        await client.query(`INSERT INTO cart_reservations(id,session_id,product_id,city,quantity,state,created_at,expires_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,'active',$6,LEAST($6::timestamptz+make_interval(secs=>$7),(SELECT expires_at FROM cart_sessions WHERE id=$2)),$6)`, [id,owner.id,item.productId,request.city,item.quantity,inventory.now,this.config.ttlSeconds]);
        inventory.mark({ productId:item.productId,city:request.city },'reservation.created');
      }
      owned = (await client.query<CartRow>('SELECT * FROM cart_reservations WHERE id=ANY($1::uuid[])',[createdIds])).rows;
    } else if (method === 'PATCH') {
      const request = input as PatchHolds;
      const total = held.reduce((s,r)=>s+r.quantity,0) + request.items.reduce((s,i)=>s+i.quantity-owned.find(r=>r.id===i.reservationId)!.quantity,0);
      if (total>100) fail('RESERVATION_LIMIT','Cart reservation limit reached');
      for (const item of request.items) {
        const row = owned.find(r=>r.id===item.reservationId)!;
        const k = { productId:row.product_id,city:row.city };
        if ((await inventory.snapshot(k))!.available+row.quantity<item.quantity) fail('INSUFFICIENT_STOCK','Not enough stock available');
      }
      for (const item of request.items) {
        const row = owned.find(r=>r.id===item.reservationId)!;
        if (row.quantity===item.quantity) continue;
        await client.query('UPDATE cart_reservations SET quantity=$2,updated_at=$3 WHERE id=$1',[row.id,item.quantity,inventory.now]);
        inventory.mark({ productId:row.product_id,city:row.city },'reservation.updated');
      }
      owned = (await client.query<CartRow>('SELECT * FROM cart_reservations WHERE id=ANY($1::uuid[])',[ids])).rows;
    } else {
      for (const row of owned.filter(r=>r.state==='active')) {
        await client.query("UPDATE cart_reservations SET state='released',updated_at=$2 WHERE id=$1",[row.id,inventory.now]);
        inventory.mark({ productId:row.product_id,city:row.city },'reservation.released');
      }
      owned = (await client.query<CartRow>('SELECT * FROM cart_reservations WHERE id=ANY($1::uuid[])',[ids])).rows;
    }
    await inventory.flush();
    return { status: create ? 201 : 200, body: envelope(owned,inventory.now) };
  }
}
class Cooldown extends ApiError {
  constructor(readonly retry: number) { super(429,'RESERVATION_COOLDOWN','Wait before reserving this item again'); }
}
