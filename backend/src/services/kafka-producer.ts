import { Kafka, Partitioners } from 'kafkajs';
import type { KafkaSettings } from '../config/kafka.js';
import type { EventProducer } from './outbox.js';

export function createKafkaProducer(settings: KafkaSettings): EventProducer {
  const producer = new Kafka(settings.client).producer({
    allowAutoTopicCreation: false, maxInFlightRequests: 1,
    retry: { ...settings.client.retry, retries: 2 },
    createPartitioner: Partitioners.DefaultPartitioner
  });
  return {
    connect: () => producer.connect(),
    async publish(message) {
      await producer.send({ topic: message.topic, acks: -1, timeout: settings.requestTimeoutMs, messages: [{ key: message.key, value: message.value }] });
    },
    disconnect: () => producer.disconnect()
  };
}
