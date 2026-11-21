import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { cities } from '../types/product.js';
import type { AdminQuery, AdminEndpoint } from '../types/admin.js';
import type { AdminApi } from '../services/admin.js';
import { adminDisabled, type AdminPrincipal } from '../services/admin-auth.js';
import { ApiError } from '../services/products.js';

const text = { type: 'string' };
const dateTime = { type: 'string', format: 'date-time' };
const count = { type: 'integer', minimum: 0 };
const city = { type: 'string', enum: cities };
const status = { type: 'string', enum: ['pending', 'confirmed', 'cancelled'] };
const shortText = { type: 'string', minLength: 1, maxLength: 100 };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const pagingQuery = { limit: { type: 'string', pattern: '^(?:[1-9][0-9]?|100)$' }, cursor: text };
const dateQuery = { createdFrom: { type: 'string', maxLength: 32 }, createdTo: { type: 'string', maxLength: 32 } };
const inventory = object({ productId: text, name: text, category: text, city, stock: count,
  price: { type: 'number', exclusiveMinimum: 0 }, stockStatus: { type: 'string', enum: ['in_stock', 'low_stock', 'out_of_stock'] } });
const order = object({ orderId: text, createdAt: dateTime, city, total: { type: 'number', minimum: 0 }, status });
const event = object({ eventId: text, eventType: text, orderId: nullable(text), productId: nullable(text), city: nullable(city),
  createdAt: dateTime, publicationState: { type: 'string', enum: ['pending', 'published'] }, publishedAt: nullable(dateTime) });
const page = object({ limit: { type: 'integer', minimum: 1, maximum: 100 }, nextCursor: nullable(text) });
const overview = object({ asOf: dateTime, lowStockThreshold: { type: 'integer', const: 5 }, totalStockUnits: count,
  lowStockRecords: count, outOfStockRecords: count,
  ordersToday: object({ count, date: { type: 'string', format: 'date' }, timeZone: { type: 'string', const: 'Asia/Kolkata' }, startsAt: dateTime, endsAt: dateTime }),
  inventoryByCity: { type: 'array', minItems: 3, maxItems: 3, items: object({ city, stockUnits: count, lowStockRecords: count, outOfStockRecords: count }) },
  outboxBacklog: count });

export function registerAdminRoutes(app: FastifyInstance, api?: AdminApi) {
  const principals = new WeakMap<FastifyRequest, AdminPrincipal>();
  const onRequest: onRequestAsyncHookHandler = async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!api) throw adminDisabled();
    try { principals.set(request, await api.authorize(request)); }
    catch (error) { if (error instanceof ApiError && error.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer'); throw error; }
  };
  app.get('/api/admin/overview', { onRequest, schema: {
    querystring: { type: 'object', additionalProperties: false, properties: {} }, response: { 200: overview }
  } }, async () => {
    if (!api) throw adminDisabled();
    return api.service.overview();
  });
  const definitions = [
    { endpoint: 'inventory', properties: { ...pagingQuery, city, category: shortText, stockStatus: { type: 'string', enum: ['in_stock', 'low_stock', 'out_of_stock'] } }, item: inventory },
    { endpoint: 'orders', properties: { ...pagingQuery, ...dateQuery, city, status }, item: order },
    { endpoint: 'events', properties: { ...pagingQuery, ...dateQuery, city, eventType: shortText, productId: shortText, publicationState: { type: 'string', enum: ['pending', 'published'] } }, item: event }
  ] as const;
  for (const definition of definitions) {
    const endpoint: AdminEndpoint = definition.endpoint;
    app.get<{ Querystring: AdminQuery }>(`/api/admin/${endpoint}`, { onRequest, schema: {
      querystring: { type: 'object', additionalProperties: false, properties: definition.properties },
      response: { 200: object({ asOf: dateTime, [endpoint]: { type: 'array', maxItems: 100, items: definition.item }, page }) }
    } }, request => {
      const principal = principals.get(request);
      if (!api || !principal) throw adminDisabled();
      return api.service.list(endpoint, request.query, principal.scope);
    });
  }
}
