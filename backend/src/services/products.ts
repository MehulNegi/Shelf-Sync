import type { City, ProductFilters, ProductRepository } from '../types/product.js';

export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

export class ProductService {
  constructor(private readonly repository: ProductRepository) {}

  async list(filters: ProductFilters) {
    // AJV may coerce a string such as "Infinity" after its initial type check.
    for (const price of [filters.minPrice, filters.maxPrice]) {
      if (price !== undefined && (!Number.isFinite(price) || price < 0 || price > 9999999999.99)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Price filters must be finite nonnegative INR amounts');
      }
    }
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'minPrice must be less than or equal to maxPrice');
    }
    const products = await this.repository.list(filters);
    return { products, total: products.length };
  }

  async findById(id: string, city: City) {
    const product = await this.repository.findById(id, city);
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    return product;
  }
}
