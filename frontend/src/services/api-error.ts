export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export function checkoutErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409 && error.code === 'INSUFFICIENT_STOCK') {
    return 'Some items are out of stock or have fewer units available. Review the updated quantities in your cart and try again.'
  }
  if (error instanceof ApiError && error.status === 501 && error.code === 'NOT_IMPLEMENTED') {
    return 'Live checkout is unavailable on this backend. Your cart is saved.'
  }
  if (error instanceof ApiError && error.status === 0) {
    return 'The connection to the store failed. Check whether your order went through before trying again.'
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return 'We couldn’t verify whether your order was placed. Check with the store before trying again to avoid a duplicate order.'
  }
  return error.message
}
