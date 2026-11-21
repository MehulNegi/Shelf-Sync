import type { City, ProductFilters, ProductRepository } from '../types/product.js';

export class SearchProductRepository implements ProductRepository {
  constructor(private readonly projection: { search(filters: ProductFilters): ReturnType<ProductRepository['list']> },
    private readonly postgres: ProductRepository, private readonly onFallback: () => void = () => {}) {}

  async list(filters: ProductFilters) {
    let found;
    try { found = await this.projection.search(filters); }
    catch { this.onFallback(); return this.postgres.list(filters); }
    // Never fall back to stale projection stock when the authoritative DB fails.
    const products=this.postgres.hydrate ? await this.postgres.hydrate(found.map(p=>p.id),filters.city) : found;
    return products.filter(p=>(!filters.category || p.category===filters.category) && (filters.minPrice===undefined || p.price>=filters.minPrice) && (filters.maxPrice===undefined || p.price<=filters.maxPrice));
  }
  findById(id: string, city: City) { return this.postgres.findById(id, city); }
}
