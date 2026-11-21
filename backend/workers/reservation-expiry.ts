import { loadConfig, SetupError } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { runReservationExpiry } from '../src/services/reservation-expiry.js';
import { validateRenderEnvironment } from '../src/config/deployment.js';
import { installShutdown } from '../src/services/shutdown.js';

async function main() {
  const config=loadConfig();
  validateRenderEnvironment('worker');
  const pool=createPool(config);
  const controller=new AbortController();
  const shutdown=installShutdown(()=>controller.abort(),{log:event=>console.info(JSON.stringify({event}))});
  try { await runReservationExpiry(pool,controller.signal,entry=>console.log(JSON.stringify(entry))); }
  finally {shutdown.dispose();}
}
main().catch(error=>{
  console.error(error instanceof SetupError?error.message:'Reservation expiry worker failed. Check verified PostgreSQL access and migrations.');process.exitCode=1;
});
