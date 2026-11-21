import type { ComponentProps } from 'react'

// Adapted from the shadcn/ui Input.
export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={`control min-w-0 w-full ${className}`} {...props} />
}
