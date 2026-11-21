import type { City } from './product.js';

export interface OrderItemInput { productId: string; quantity: number }
export interface OrderInput { city: City; items: OrderItemInput[] }
export interface OrderCreated {
  success: true;
  orderId: string;
  status: 'confirmed';
  total: number;
}
export interface OrderDetails {
  id: string;
  city: City;
  status: 'pending' | 'confirmed' | 'cancelled';
  total: number;
  items: { productId: string; name: string; quantity: number; unitPrice: number }[];
}
export interface OrderRepository {
  checkout(input: OrderInput): Promise<OrderCreated>;
  findById(id: string): Promise<OrderDetails | undefined>;
}
