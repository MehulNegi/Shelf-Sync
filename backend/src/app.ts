import Fastify, { LogController, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import type { ProductRepository } from './types/product.js';
import { ApiError, ProductService } from './services/products.js';
import { registerProductRoutes } from './routes/products.js';
import { registerOrderRoutes, registerOrderTrackingRoutes } from './routes/orders.js';
import { OrderService, OrderTrackingService } from './services/orders.js';
import type { OrderRepository, OrderTrackingRepository } from './types/order.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerCartRoutes, type CartApi } from './routes/cart.js';
import { registerProfitabilityRoutes } from './routes/profitability.js';
import type { ProfitabilityApi } from './services/profitability.js';
import type { AdminApi } from './services/admin.js';
import { registerDemoOrderRoutes, type DemoOrderFeed } from './routes/demo-orders.js';

export interface AppOptions {
  products: ProductRepository;
  orders: OrderRepository;
  tracking?: OrderTrackingRepository;
  admin?: AdminApi;
  profitability?: ProfitabilityApi;
  cart?: CartApi;
  frontendOrigin: string;
  logger?: boolean;
  readiness?: () => Promise<boolean>;
  demoOrders?: DemoOrderFeed;
}

export function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024,
    forceCloseConnections: 'idle',
    routerOptions: {
      onMaxParamLength: (_path, _request, response) => {
        const finance=_request.url?.startsWith('/api/admin/profitability/') || (_request.url?.startsWith('/api/admin/products/')&&_request.url.includes('/costs'));
        response.writeHead(finance?400:414, { 'content-type': 'application/json; charset=utf-8', ...(finance?{'cache-control':'no-store'}:{}) });
        response.end(JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: finance?'Invalid request parameters':'Request path parameter is too long' } }));
      }
    },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true, strictNumbers: true } }
  });
  app.register(cors, () => async (request: import('fastify').FastifyRequest) => {
    const costPath=Boolean(options.profitability && /^\/api\/admin\/products\/[^/]+\/costs(?:\?|$)/.test(request.url));
    return {origin:request.headers.origin===options.frontendOrigin?options.frontendOrigin:false,methods:['GET','POST','PATCH','OPTIONS',...(costPath?['PUT']:[])],
      allowedHeaders:['Content-Type','Authorization','Idempotency-Key',...(costPath?['If-Match']:[])],
      ...(costPath?{exposedHeaders:['ETag']}:{}),
      credentials:Boolean(options.cart?.config.enabled && (request.url.startsWith('/api/cart/')||request.url.split('?')[0]==='/api/orders'))};
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.code === 'RESERVATION_BUSY') reply.header('Retry-After',1);
      return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message } });
    }
    const cartRequest = request.url.startsWith('/api/cart/') || (request.url.split('?')[0] === '/api/orders' && request.body && typeof request.body === 'object' && 'reservationIds' in request.body);
    if (cartRequest && (/^(08|53|57|58|E)/.test(error.code ?? '') || error.message === 'Cannot use a pool after calling end on the pool')) {
      return reply.code(503).send({ success:false,error:{code:'DATABASE_UNAVAILABLE',message:'Cart data is temporarily unavailable'} });
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
  // Operational probe; the shared /api/health liveness contract stays unchanged.
  if (options.readiness) app.get('/api/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    let ready = false;
    try { ready = await options.readiness!(); } catch { /* never expose driver errors */ }
    if (!ready) return reply.code(503).send({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready' } });
    return { status: 'ready' };
  });
  registerProductRoutes(app, new ProductService(options.products));
  registerOrderRoutes(app, new OrderService(options.orders), options.cart);
  if (options.tracking) registerOrderTrackingRoutes(app, new OrderTrackingService(options.tracking));
  registerAdminRoutes(app, options.admin);
  registerDemoOrderRoutes(app, options.demoOrders);
  registerProfitabilityRoutes(app, options.profitability);
  registerCartRoutes(app, options.cart);
  return app;
}
