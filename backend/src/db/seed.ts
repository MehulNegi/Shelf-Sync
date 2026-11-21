import { runDatabaseTask } from './cli.js';
import { seed } from './seeds.js';

await runDatabaseTask('Database seed', seed);
