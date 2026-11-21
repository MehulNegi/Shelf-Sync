const priceFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0,
})

export function formatPrice(price: number) {
  return priceFormatter.format(price)
}
