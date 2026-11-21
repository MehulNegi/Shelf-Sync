import { cities, type City } from '../types/product.js';
import type { OrderInput, OrderRepository } from '../types/order.js';
import { ApiError } from './products.js';

const invalid = () => new ApiError(400, 'VALIDATION_ERROR', 'Provide a supported city and 1–100 cart items with product IDs and positive integer quantities');

// Also used before schema coercion so JSON strings/booleans never become quantities.
export function normalizeOrder(input: unknown): OrderInput {
  if (!input || typeof input !== 'object') throw invalid();
  const { city, items } = input as Record<string, unknown>;
  if (!cities.includes(city as City) || !Array.isArray(items) || items.length === 0 || items.length > 100) throw invalid();
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item || typeof item !== 'object') throw invalid();
    const { productId, quantity } = item as Record<string, unknown>;
    if (typeof productId !== 'string' || productId.trim().length === 0 || productId.length > 100 ||
        typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) throw invalid();
    const combined = (quantities.get(productId) ?? 0) + quantity;
    if (combined > 2147483647) throw invalid();
    quantities.set(productId, combined);
  }
  return {
    city: city as City,
    items: [...quantities].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([productId, quantity]) => ({ productId, quantity }))
  };
}

export class OrderService {
  constructor(private readonly repository: OrderRepository) {}

  create(input: unknown) { return this.repository.checkout(normalizeOrder(input)); }

  async findById(id: string) {
    const order = await this.repository.findById(id);
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
    return order;
  }
}
