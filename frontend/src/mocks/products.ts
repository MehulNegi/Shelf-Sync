import type { City, Product, ProductQuery, ProductsResponse } from '../types/products'

type CatalogEntry = Omit<Product, 'city' | 'stock' | 'available'> & {
  inventory: Record<City, number>
}

const catalog: CatalogEntry[] = [
  {
    id: 'prod_001', name: 'Wireless Over-Ear Headphones', category: 'electronics',
    description: 'Cushioned Bluetooth headphones', price: 2499, imageUrl: '/images/headphones.webp',
    inventory: { pune: 12, delhi: 0, bengaluru: 8 },
  },
  {
    id: 'prod_002', name: 'Classic Checked Shirt', category: 'apparel',
    description: 'A relaxed cotton button-down', price: 1099, imageUrl: '/images/shirt.webp',
    inventory: { pune: 7, delhi: 14, bengaluru: 0 },
  },
  {
    id: 'prod_003', name: 'Wildflower Honey', category: 'groceries',
    description: 'Wildflower honey in a glass jar', price: 349, imageUrl: '/images/honey.webp',
    inventory: { pune: 0, delhi: 8, bengaluru: 21 },
  },
  {
    id: 'prod_004', name: 'Portable Bluetooth Speaker', category: 'electronics',
    description: 'Compact wireless speaker', price: 1799, imageUrl: '/images/speaker.webp',
    inventory: { pune: 5, delhi: 11, bengaluru: 0 },
  },
  {
    id: 'prod_005', name: 'Everyday Sneakers', category: 'apparel',
    description: 'Low-top lace-up sneakers', price: 1599, imageUrl: '/images/sneakers.webp',
    inventory: { pune: 0, delhi: 6, bengaluru: 13 },
  },
  {
    id: 'prod_006', name: 'Orchard Apples', category: 'groceries',
    description: 'Crisp red apples, sold per kilogram', price: 189, imageUrl: '/images/apple.webp',
    inventory: { pune: 24, delhi: 0, bengaluru: 17 },
  },
]

export function mockProducts(query: ProductQuery): ProductsResponse {
  const search = query.q?.trim().toLowerCase() ?? ''
  const products = catalog
    .filter((product) => (
      (!query.category || product.category === query.category) &&
      product.price >= (query.minPrice ?? 0) &&
      product.price <= (query.maxPrice ?? Infinity) &&
      [product.name, product.description, product.category].some((value) =>
        value.toLowerCase().includes(search),
      )
    ))
    .map(({ inventory, ...product }) => {
      const stock = inventory[query.city]
      return { ...product, city: query.city, stock, available: stock > 0 }
    })

  return { products, total: products.length }
}
