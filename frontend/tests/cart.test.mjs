import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const { cartReducer, loadCart, saveCart } = await vite.ssrLoadModule('/src/services/cart.ts')
after(() => vite.close())

const key = 'test.cart'
const adjust = (city, delta, stock = 2) => ({ type: 'adjust', city, productId: 'prod_001', delta, stock })
const empty = () => loadCart({ getItem: () => null }, key)

test('cart increments, decrements and removes with a stock limit', () => {
  let cart = cartReducer(empty(), adjust('pune', 1))
  cart = cartReducer(cart, adjust('pune', 1))
  assert.equal(cart.itemsByCity.pune[0].quantity, 2)
  assert.equal(cartReducer(cart, adjust('pune', 1)), cart)
  cart = cartReducer(cart, adjust('pune', -1, 0))
  assert.equal(cart.itemsByCity.pune[0].quantity, 1)
  assert.equal(cartReducer(cart, adjust('pune', -1)), cart)
  cart = cartReducer(cart, { type: 'remove', city: 'pune', productId: 'prod_001' })
  assert.deepEqual(cart.itemsByCity.pune, [])
})

test('cart and selected city survive reload, including unavailable storage', () => {
  const storage = new Map()
  const localStorage = { getItem: (name) => storage.get(name), setItem: (name, value) => storage.set(name, value) }
  let cart = cartReducer(empty(), { type: 'selectCity', city: 'delhi' })
  cart = cartReducer(cart, adjust('delhi', 2))
  saveCart(localStorage, key, cart)
  assert.deepEqual(loadCart(localStorage, key), cart)
  assert.deepEqual(JSON.parse(storage.get(key)).itemsByCity.delhi, [{ productId: 'prod_001', quantity: 2 }])
  localStorage.setItem(key, 'bad json')
  assert.deepEqual(loadCart(localStorage, key), empty())
  assert.deepEqual(loadCart({ getItem: () => { throw Error('blocked') } }, key), empty())
})

test('switching cities restores independent carts and checkout clears only its city', () => {
  let cart = cartReducer(empty(), adjust('pune', 1))
  cart = cartReducer(cart, { type: 'selectCity', city: 'bengaluru' })
  assert.deepEqual(cart.itemsByCity[cart.city], [])
  assert.equal(cartReducer(cart, adjust('pune', 1)), cart)
  cart = cartReducer(cart, adjust('bengaluru', 2))
  cart = cartReducer(cart, { type: 'clear', city: 'bengaluru' })
  cart = cartReducer(cart, { type: 'selectCity', city: 'pune' })
  assert.deepEqual(cart.itemsByCity[cart.city], [{ productId: 'prod_001', quantity: 1 }])
  assert.deepEqual(cart.itemsByCity.bengaluru, [])
})
