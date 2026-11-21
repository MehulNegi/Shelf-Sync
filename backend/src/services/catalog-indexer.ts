import type { Pool } from 'pg';
import { cities } from '../types/product.js';
import { InventoryTransaction } from '../db/inventory.js';
import { transaction } from '../db/transaction.js';
import type { ProductDocument } from './search-projection.js';

export async function indexCatalog(pool: Pool, projection: { ensureIndex(): Promise<void>; upsertProduct(doc: ProductDocument): Promise<void> }) {
  await projection.ensureIndex();
  let lastId: string | null = null;
  let count=0;
  while (true) {
    const page:ProductDocument[]=await transaction(pool,async client=>{
      const {rows}=await client.query<{id:string;name:string;description:string;category:string;price:string;image_url:string}>('SELECT * FROM products WHERE ($1::text IS NULL OR id COLLATE "C">$1 COLLATE "C") ORDER BY id COLLATE "C" LIMIT 10',[lastId]);
      const inventory=await InventoryTransaction.lock(client,rows.flatMap(p=>cities.map(city=>({productId:p.id,city}))));
      await inventory.reconcile();
      await inventory.flush();
      const docs:ProductDocument[]=[];
      for (const p of rows) for (const city of cities) {
        const stock=await inventory.snapshot({productId:p.id,city});
        if (stock && !Number.isSafeInteger(stock.version)) throw new Error('Inventory version exceeds JSON safe range');
        docs.push({id:p.id,name:p.name,description:p.description,category:p.category,price:Number(p.price),imageUrl:p.image_url,
          city,stock:stock?.available??0,available:(stock?.available??0)>0,inventoryVersion:stock?.version??0,catalogReady:true,
          physicalQuantity:stock?.quantity??0,reservedQuantity:stock?.reserved??0,nextExpirationAt:stock?.next?new Date(stock.next).toISOString():null});
      }
      return docs;
    });
    if (!page.length) break;
    // No PostgreSQL lock/transaction survives OpenSearch I/O.
    for (const doc of page) {await projection.upsertProduct(doc);count++;}
    lastId=page.at(-1)!.id;
  }
  return count;
}
