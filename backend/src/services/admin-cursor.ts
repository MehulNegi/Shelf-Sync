import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AdminEndpoint, AdminFilters } from '../types/admin.js';
import { ApiError } from './products.js';

export const invalidCursor = () => new ApiError(400, 'INVALID_CURSOR', 'Invalid or expired cursor');
export class AdminCursor {
  constructor(private readonly secret: Buffer, private readonly now: () => number = Date.now) {
    if (secret.length < 32) throw new Error('Admin cursor secret must contain at least 32 bytes');
  }
  private binding(endpoint: AdminEndpoint, filters: AdminFilters, limit: number, scope: string) {
    const ordered = Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    return createHash('sha256').update(JSON.stringify([endpoint, ordered, limit, scope])).digest('base64url');
  }
  encode(endpoint: AdminEndpoint, filters: AdminFilters, limit: number, scope: string, after: string[]) {
    const body = Buffer.from(JSON.stringify({ v: 1, binding: this.binding(endpoint, filters, limit, scope), expires: this.now() + 900000, after })).toString('base64url');
    const token = `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
    if (token.length > 2048) throw new ApiError(500, 'INTERNAL_ERROR', 'An internal server error occurred');
    return token;
  }
  decode(token: string, endpoint: AdminEndpoint, filters: AdminFilters, limit: number, scope: string): string[] {
    try {
      if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw invalidCursor();
      const [body, signature] = token.split('.') as [string, string];
      const supplied = Buffer.from(signature, 'base64url');
      const expected = createHmac('sha256', this.secret).update(body).digest();
      if (supplied.length !== expected.length || supplied.toString('base64url') !== signature || !timingSafeEqual(supplied, expected)) throw invalidCursor();
      const bytes = Buffer.from(body, 'base64url');
      if (bytes.toString('base64url') !== body) throw invalidCursor();
      const data = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      if (data.v !== 1 || data.binding !== this.binding(endpoint, filters, limit, scope) ||
          typeof data.expires !== 'number' || !Number.isSafeInteger(data.expires) || data.expires <= this.now() || data.expires > this.now() + 900000 ||
          !Array.isArray(data.after) || data.after.length !== 2 || data.after.some(value => typeof value !== 'string' || value.length === 0)) throw invalidCursor();
      return data.after as string[];
    } catch { throw invalidCursor(); }
  }
}
