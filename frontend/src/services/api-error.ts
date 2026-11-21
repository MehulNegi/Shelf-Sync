export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export function checkoutErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409 && error.code === 'INSUFFICIENT_STOCK') {
    return 'Stock changed before the order was placed. Review availability in your cart, then reduce quantities or remove out-of-stock items.'
  }
  if (error instanceof ApiError && error.status === 501 && error.code === 'NOT_IMPLEMENTED') {
    return 'Live checkout is unavailable on this backend. Your cart is saved.'
  }
  if (error instanceof ApiError && error.status === 0) {
    return 'The connection to the store failed. Your cart is saved. Check whether your order went through before trying again.'
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return 'We couldn’t confirm your order. Your cart is saved. Check with the store before trying again to avoid a duplicate order.'
  }
  return error.message
}
