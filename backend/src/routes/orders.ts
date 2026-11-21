import type { FastifyInstance } from 'fastify';
import { normalizeOrder, type OrderService } from '../services/orders.js';
import { cities } from '../types/product.js';
import type { OrderInput } from '../types/order.js';

export function registerOrderRoutes(app: FastifyInstance, service: OrderService) {
  app.post<{ Body: OrderInput }>('/api/orders', {
    preValidation: async request => { normalizeOrder(request.body); },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['city', 'items'],
        properties: {
          city: { type: 'string', enum: cities },
          items: {
            type: 'array', minItems: 1, maxItems: 100,
            items: {
              type: 'object', additionalProperties: false, required: ['productId', 'quantity'],
              properties: { productId: { type: 'string', minLength: 1, maxLength: 100 }, quantity: { type: 'integer', minimum: 1, maximum: 2147483647 } }
            }
          }
        }
      },
      response: { 201: {
        type: 'object', additionalProperties: false, required: ['success', 'orderId', 'status', 'total'],
        properties: { success: { type: 'boolean', const: true }, orderId: { type: 'string' }, status: { type: 'string', const: 'confirmed' }, total: { type: 'number' } }
      } }
    }
  }, async (request, reply) => reply.code(201).send(await service.create(request.body)));

  app.get<{ Params: { id: string } }>('/api/orders/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 100 } } },
      response: { 200: {
        type: 'object', additionalProperties: false, required: ['id', 'city', 'status', 'total', 'items'],
        properties: {
          id: { type: 'string' }, city: { type: 'string', enum: cities },
          status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled'] }, total: { type: 'number' },
          items: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['productId', 'name', 'quantity', 'unitPrice'],
            properties: { productId: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'integer' }, unitPrice: { type: 'number' } }
          } }
        }
      } }
    }
  }, request => service.findById(request.params.id));
}
