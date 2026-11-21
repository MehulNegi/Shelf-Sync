import type { FastifyInstance } from 'fastify';
import type { ProductService } from '../services/products.js';
import { cities, type City, type ProductFilters } from '../types/product.js';

const city = { type: 'string', enum: cities };
const productSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'description', 'category', 'price', 'imageUrl', 'city', 'stock', 'available'],
  properties: {
    id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
    category: { type: 'string' }, price: { type: 'number', exclusiveMinimum: 0 },
    imageUrl: { type: 'string' }, city, stock: { type: 'integer', minimum: 0 }, available: { type: 'boolean' }
  }
};

export function registerProductRoutes(app: FastifyInstance, service: ProductService) {
  const noStore = async (_request: unknown, reply: import('fastify').FastifyReply) => { reply.header('Cache-Control','no-store'); };
  app.get<{ Querystring: ProductFilters }>('/api/products', {
    onRequest: noStore,
    schema: {
      querystring: {
        type: 'object', required: ['city'], additionalProperties: false,
        properties: {
          city, q: { type: 'string', maxLength: 200 },
          category: { type: 'string', minLength: 1, maxLength: 100 },
          minPrice: { type: 'number', minimum: 0, maximum: 9999999999.99 },
          maxPrice: { type: 'number', minimum: 0, maximum: 9999999999.99 }
        }
      },
      response: { 200: {
        type: 'object', additionalProperties: false, required: ['products', 'total'],
        properties: { products: { type: 'array', items: productSchema }, total: { type: 'integer', minimum: 0 } }
      } }
    }
  }, request => service.list(request.query));

  app.get<{ Params: { id: string }; Querystring: { city: City } }>('/api/products/:id', {
    onRequest: noStore,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 100 } } },
      querystring: { type: 'object', required: ['city'], additionalProperties: false, properties: { city } },
      response: { 200: productSchema }
    }
  }, request => service.findById(request.params.id, request.query.city));
}
