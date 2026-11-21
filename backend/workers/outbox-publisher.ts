import { loadConfig, SetupError } from '../src/config/env.js';
import { loadKafkaConfig } from '../src/config/kafka.js';
import { createPool } from '../src/db/pool.js';
import { createKafkaProducer } from '../src/services/kafka-producer.js';
import { runPublisher, type PublisherLog } from '../src/services/publisher.js';
import { validateRenderEnvironment } from '../src/config/deployment.js';
import { installShutdown } from '../src/services/shutdown.js';

const log: PublisherLog = entry => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

async function main() {
  const database = loadConfig();
  validateRenderEnvironment('worker');
  const kafka = loadKafkaConfig();
  const pool = createPool(database);
  const producer = createKafkaProducer(kafka);
  const controller = new AbortController();
  const shutdown = installShutdown(() => controller.abort(), { log: event => log({ level: 'info', event }) });
  log({ level: 'info', event: 'publisher_starting' });
  try { await runPublisher({ pool, producer, settings: kafka.publisher, signal: controller.signal, log }); }
  finally {
    shutdown.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Outbox publisher stopped unexpectedly. Check PostgreSQL/Kafka availability, Quick Connect settings, certificates, and migrations.');
  process.exitCode = 1;
});
