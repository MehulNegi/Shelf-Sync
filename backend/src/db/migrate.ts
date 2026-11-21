import { runDatabaseTask } from './cli.js';
import { migrate } from './migrations.js';

await runDatabaseTask('Database migration', async pool => {
  console.log(`Applied ${await migrate(pool)} migration(s).`);
});
