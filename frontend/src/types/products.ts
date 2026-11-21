export const cities = { pune: 'Pune', delhi: 'Delhi', bengaluru: 'Bengaluru' } as const
export type City = keyof typeof cities

export const categories = ['electronics', 'apparel', 'groceries'] as const

export interface Product {
  id: string
  name: string
  description: string
  category: string
  price: number
  imageUrl: string
  city: City
  stock: number
  available: boolean
}

export interface ProductQuery {
  city: City
  q?: string
  category?: string
  minPrice?: number
  maxPrice?: number
}

export interface ProductsResponse {
  products: Product[]
  total: number
}
