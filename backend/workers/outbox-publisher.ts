import { loadConfig, SetupError } from '../src/config/env.js';
import { loadKafkaConfig } from '../src/config/kafka.js';
import { createPool } from '../src/db/pool.js';
import { createKafkaProducer } from '../src/services/kafka-producer.js';
import { runPublisher, type PublisherLog } from '../src/services/publisher.js';

const log: PublisherLog = entry => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

async function main() {
  const database = loadConfig();
  const kafka = loadKafkaConfig();
  const pool = createPool(database);
  const producer = createKafkaProducer(kafka);
  const controller = new AbortController();
  const stop = () => { log({ level: 'info', event: 'publisher_stopping' }); controller.abort(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  log({ level: 'info', event: 'publisher_starting' });
  try { await runPublisher({ pool, producer, settings: kafka.publisher, signal: controller.signal, log }); }
  finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Outbox publisher stopped unexpectedly. Check PostgreSQL/Kafka availability, Quick Connect settings, certificates, and migrations.');
  process.exitCode = 1;
});
