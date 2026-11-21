import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import type { PublisherSettings } from '../config/kafka.js';
import { OutboxError, publishNext, type EventProducer } from './outbox.js';

export type PublisherLog = (entry: { level: 'info' | 'error'; event: string; eventId?: string; count?: number; retryInMs?: number; reason?: string }) => void;

export async function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try { await delay(ms, undefined, { signal }); } catch (error) { if (!signal.aborted) throw error; }
}

export function retryDelay(failures: number, settings: PublisherSettings, random = Math.random) {
  const ceiling = Math.min(settings.retryMaxMs, settings.retryInitialMs * 2 ** Math.min(failures - 1, 20));
  return Math.max(1, Math.floor(ceiling * (0.5 + random() * 0.5)));
}

export async function runPublisher(options: {
  pool: Pool; producer: EventProducer; settings: PublisherSettings; signal: AbortSignal; log: PublisherLog;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const { pool, producer, settings, signal, log } = options;
  const sleep = options.sleep ?? pause;
  let connected = false;
  let failures = 0;
  try {
    while (!signal.aborted) {
      try {
        if (!connected) { await producer.connect(); connected = true; log({ level: 'info', event: 'kafka_connected' }); }
        let count = 0;
        for (; count < settings.batchSize && !signal.aborted; count++) {
          const eventId = await publishNext(pool, producer, signal);
          if (eventId === undefined) break;
          log({ level: 'info', event: 'outbox_published', eventId });
        }
        failures = 0;
        log({ level: 'info', event: 'poll_completed', count });
        await sleep(settings.pollIntervalMs, signal);
      } catch (error) {
        const reason = error instanceof OutboxError ? error.reason : connected ? 'database' : 'kafka_connect';
        connected = false;
        if (signal.aborted) break;
        const retryInMs = retryDelay(++failures, settings);
        log({ level: 'error', event: 'publisher_retry', ...(error instanceof OutboxError && error.eventId ? { eventId: error.eventId } : {}), reason, retryInMs });
        await sleep(retryInMs, signal);
      }
    }
  } finally {
    try { await producer.disconnect(); } finally { await pool.end(); }
    log({ level: 'info', event: 'publisher_stopped' });
  }
}
