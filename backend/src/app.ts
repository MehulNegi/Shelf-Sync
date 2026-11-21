import Fastify, { LogController, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import type { ProductRepository } from './types/product.js';
import { ApiError, ProductService } from './services/products.js';
import { registerProductRoutes } from './routes/products.js';
import { registerOrderRoutes, registerOrderTrackingRoutes } from './routes/orders.js';
import { OrderService, OrderTrackingService } from './services/orders.js';
import type { OrderRepository, OrderTrackingRepository } from './types/order.js';
import { registerAdminRoutes } from './routes/admin.js';
import type { AdminApi } from './services/admin.js';

export interface AppOptions {
  products: ProductRepository;
  orders: OrderRepository;
  tracking?: OrderTrackingRepository;
  admin?: AdminApi;
  frontendOrigin: string;
  logger?: boolean;
}

export function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024,
    routerOptions: {
      onMaxParamLength: (_path, _request, response) => {
        response.writeHead(414, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Request path parameter is too long' } }));
      }
    },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true, strictNumbers: true } }
  });
  app.register(cors, { origin: options.frontendOrigin, methods: ['GET', 'POST', 'OPTIONS'] });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message } });
    }
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    const code = error.validation ? 'VALIDATION_ERROR' : statusCode < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
    const message = error.validation ? 'Invalid request parameters' : statusCode < 500 ? 'Invalid request' : 'An internal server error occurred';
    if (statusCode >= 500) request.log.error({ requestId: request.id }, 'API request failed');
    return reply.code(statusCode).send({ success: false, error: { code, message } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.get('/api/health', {
    schema: { response: { 200: { type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'ok' } } } } }
  }, async () => ({ status: 'ok' }));
  registerProductRoutes(app, new ProductService(options.products));
  registerOrderRoutes(app, new OrderService(options.orders));
  if (options.tracking) registerOrderTrackingRoutes(app, new OrderTrackingService(options.tracking));
  registerAdminRoutes(app, options.admin);
  return app;
}
