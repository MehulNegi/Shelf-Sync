import type { Pool } from 'pg';
import type { JWTVerifyGetKey } from 'jose';
import type { AdminConfig } from '../config/admin.js';
import { PgAdminRepository } from '../repositories/admin.js';
import type { AdminEndpoint, AdminFilters, AdminQuery, AdminRepository } from '../types/admin.js';
import { cities } from '../types/product.js';
import { createAdminAuthorizer, type AdminAuthorizer } from './admin-auth.js';
import { AdminCursor, invalidCursor } from './admin-cursor.js';
import { ApiError } from './products.js';

export function utcMicros(value: string): bigint | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match || Number(value.slice(0, 4)) < 1) return undefined;
  const seconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(seconds) || new Date(seconds).toISOString().slice(0, 19) !== match[1]) return undefined;
  return BigInt(seconds) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}

export class AdminService {
  constructor(private readonly repository: AdminRepository, private readonly cursors: AdminCursor) {}
  overview() { return this.repository.overview(); }

  async list(endpoint: AdminEndpoint, query: AdminQuery, scope: string) {
    const { limit: rawLimit, cursor, ...filters } = query;
    const limit = Number(rawLimit ?? '50');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request parameters');
    for (const value of [filters.createdFrom, filters.createdTo]) {
      if (value !== undefined && utcMicros(value) === undefined) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request parameters');
    }
    if (filters.createdFrom && filters.createdTo && utcMicros(filters.createdFrom)! >= utcMicros(filters.createdTo)!) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request parameters');
    const after = cursor !== undefined ? this.cursors.decode(cursor, endpoint, filters, limit, scope) : undefined;
    if (after && (endpoint === 'inventory'
      ? !cities.some(city => city === after[0])
      : utcMicros(after[0]!) === undefined || (endpoint === 'events' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after[1]!)))) throw invalidCursor();
    const result = await this.repository[endpoint](filters as AdminFilters, limit, after);
    return { asOf: result.asOf, [endpoint]: result.items,
      page: { limit, nextCursor: result.next ? this.cursors.encode(endpoint, filters, limit, scope, result.next) : null } };
  }
}
export interface AdminApi { authorize: AdminAuthorizer; service: AdminService }
export function createAdminApi(pool: Pool, config: AdminConfig, keyResolver?: JWTVerifyGetKey): AdminApi | undefined {
  if (config.mode === 'disabled') return undefined;
  return { authorize: createAdminAuthorizer(config, keyResolver), service: new AdminService(new PgAdminRepository(pool), new AdminCursor(config.cursorSecret)) };
}
