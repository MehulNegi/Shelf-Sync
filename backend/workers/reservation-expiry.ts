import { loadConfig, SetupError } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { runReservationExpiry } from '../src/services/reservation-expiry.js';

async function main() {
  const config=loadConfig();
  const pool=createPool(config);
  const controller=new AbortController();
  for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>controller.abort());
  await runReservationExpiry(pool,controller.signal,entry=>console.log(JSON.stringify(entry)));
}
main().catch(error=>{
  console.error(error instanceof SetupError?error.message:'Reservation expiry worker failed. Check verified PostgreSQL access and migrations.');process.exitCode=1;
});
