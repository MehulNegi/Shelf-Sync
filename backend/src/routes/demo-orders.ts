import type { FastifyInstance } from 'fastify';
import { cities } from '../types/product.js';
import { demoOrderLimit, type DemoOrderRepository } from '../repositories/demo-orders.js';
import { ApiError } from '../services/products.js';

export interface DemoOrderFeed { enabled: boolean; repository: DemoOrderRepository }

export function registerDemoOrderRoutes(app: FastifyInstance, feed?: DemoOrderFeed) {
  // One bounded, process-wide budget: forwarded headers cannot create more
  // buckets. Supports five-second polling without trusting proxy-supplied IPs.
  let windowStart = performance.now();
  let requests = 0;
  app.get('/api/demo/orders', {
    onRequest: async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!feed?.enabled) throw new ApiError(503, 'DEMO_ORDERS_DISABLED', 'Demo order feed is not enabled');
      const now = performance.now();
      if (now - windowStart >= 60_000) { windowStart = now; requests = 0; }
      if (requests >= 60) {
        reply.header('Retry-After', Math.max(1, Math.ceil((60_000 - (now - windowStart)) / 1000)));
        throw new ApiError(429, 'RATE_LIMITED', 'Too many demo order requests');
      }
      requests++;
    },
    schema: {
      querystring: { type: 'object', additionalProperties: false, properties: {} },
      response: { 200: {
        type: 'object', additionalProperties: false, required: ['orders'], properties: {
          orders: { type: 'array', maxItems: demoOrderLimit, items: {
            type: 'object', additionalProperties: false, required: ['id', 'city', 'status', 'total', 'created_at'],
            properties: {
              id: { type: 'string' }, city: { type: 'string', enum: cities },
              status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled'] },
              total: { type: 'number', minimum: 0 }, created_at: { type: 'string', format: 'date-time' }
            }
          } }
        }
      } }
    }
  }, async () => ({ orders: (await feed!.repository.listLatest()).slice(0, demoOrderLimit) }));
}
