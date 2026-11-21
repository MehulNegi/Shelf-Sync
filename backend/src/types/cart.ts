import type { City } from './product.js';
export interface CartRow {
  id: string; session_id: string; product_id: string; city: City; quantity: number;
  state: 'active' | 'expired' | 'released' | 'consumed'; created_at: Date; expires_at: Date; updated_at: Date; order_id: string | null;
}
export interface CartResult { status: number; body: unknown; retryAfter?: number }
export interface CreateHolds { city: City; items: { productId: string; quantity: number }[] }
export interface PatchHolds { city: City; items: { reservationId: string; quantity: number }[] }
