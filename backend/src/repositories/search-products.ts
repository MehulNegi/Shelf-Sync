import type { City, ProductFilters, ProductRepository } from '../types/product.js';

export class SearchProductRepository implements ProductRepository {
  constructor(private readonly projection: { search(filters: ProductFilters): ReturnType<ProductRepository['list']> },
    private readonly postgres: ProductRepository, private readonly onFallback: () => void = () => {}) {}

  async list(filters: ProductFilters) {
    try { return await this.projection.search(filters); }
    catch { this.onFallback(); return this.postgres.list(filters); }
  }
  findById(id: string, city: City) { return this.postgres.findById(id, city); }
}
