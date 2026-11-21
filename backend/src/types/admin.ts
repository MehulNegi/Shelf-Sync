import type { City } from './product.js';
import type { OrderDetails } from './order.js';

export type AdminEndpoint = 'inventory' | 'orders' | 'events';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type PublicationState = 'pending' | 'published';
export interface AdminFilters {
  city?: City; category?: string; stockStatus?: StockStatus;
  status?: OrderDetails['status']; eventType?: string; publicationState?: PublicationState;
  productId?: string; createdFrom?: string; createdTo?: string;
}
export interface AdminQuery extends AdminFilters { limit?: string; cursor?: string }
export interface AdminInventory {
  productId: string; name: string; category: string; city: City;
  stock: number; price: number; stockStatus: StockStatus;
}
export interface AdminOrder { orderId: string; createdAt: string; city: City; total: number; status: OrderDetails['status'] }
export interface AdminEvent {
  eventId: string; eventType: string; orderId: string | null; productId: string | null; city: City | null;
  createdAt: string; publicationState: PublicationState; publishedAt: string | null;
}
export interface AdminOverview {
  asOf: string; lowStockThreshold: 5; totalStockUnits: number; lowStockRecords: number; outOfStockRecords: number;
  ordersToday: { count: number; date: string; timeZone: 'Asia/Kolkata'; startsAt: string; endsAt: string };
  inventoryByCity: { city: City; stockUnits: number; lowStockRecords: number; outOfStockRecords: number }[];
  outboxBacklog: number;
}
export interface AdminRows<T> { asOf: string; items: T[]; next: string[] | null }
export interface AdminRepository {
  overview(): Promise<AdminOverview>;
  inventory(filters: AdminFilters, limit: number, after?: string[]): Promise<AdminRows<AdminInventory>>;
  orders(filters: AdminFilters, limit: number, after?: string[]): Promise<AdminRows<AdminOrder>>;
  events(filters: AdminFilters, limit: number, after?: string[]): Promise<AdminRows<AdminEvent>>;
}
