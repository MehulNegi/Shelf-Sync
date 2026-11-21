export const cities = ['pune', 'delhi', 'bengaluru'] as const;
export type City = (typeof cities)[number];

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  imageUrl: string;
  city: City;
  stock: number;
  available: boolean;
}

export interface ProductFilters {
  city: City;
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface ProductRepository {
  hydrate?(ids: string[], city: City): Promise<Product[]>;
  list(filters: ProductFilters): Promise<Product[]>;
  findById(id: string, city: City): Promise<Product | undefined>;
}
