import type { ComponentProps } from 'react'

// Adapted from the shadcn/ui Card.
export function Card({ className = '', ...props }: ComponentProps<'article'>) {
  return <article data-slot="card" className={`rounded-2xl border border-line bg-white ${className}`} {...props} />
}
