import { Kafka } from 'kafkajs';
import { SetupError } from '../src/config/env.js';
import { loadKafkaConfig } from '../src/config/kafka.js';
import { createOpenSearchClient, loadOpenSearchConfig } from '../src/config/opensearch.js';
import { SearchProjection } from '../src/services/search-projection.js';
import { runInventoryConsumer } from '../src/services/inventory-consumer.js';
import { validateRenderEnvironment } from '../src/config/deployment.js';
import { installShutdown } from '../src/services/shutdown.js';

async function main() {
  const kafka = loadKafkaConfig();
  validateRenderEnvironment('worker');
  const search = loadOpenSearchConfig();
  const groupId = process.env.KAFKA_CONSUMER_GROUP_ID || 'shelfsync-inventory-projection-v1';
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(groupId)) throw new SetupError('KAFKA_CONSUMER_GROUP_ID must contain 1–200 letters, digits, dots, underscores, or hyphens.');
  const client = createOpenSearchClient(search);
  const controller = new AbortController();
  const shutdown = installShutdown(() => controller.abort(), { log: event => console.info(JSON.stringify({ event })) });
  try {
    const projection = new SearchProjection(client, search.index);
    await projection.ensureIndex();
    const consumer = new Kafka(kafka.client).consumer({
      groupId, allowAutoTopicCreation: false, sessionTimeout: 60000, heartbeatInterval: 3000,
      retry: { ...kafka.client.retry, restartOnFailure: async () => false }
    });
    await runInventoryConsumer(consumer, projection, controller.signal,
      entry => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })));
  } finally {
    try { await client.close(); } finally { shutdown.dispose(); }
  }
}
main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Inventory consumer failed. Check Kafka/OpenSearch connectivity, permissions, index mappings, and the logged partition/offset. No failed offset was intentionally acknowledged.');
  process.exitCode = 1;
});
