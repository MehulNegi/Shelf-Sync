import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } })
const { productImageCandidates } = await vite.ssrLoadModule('/src/services/product-images.ts')
const { mockProducts } = await vite.ssrLoadModule('/src/mocks/products.ts')
after(() => vite.close())

const origin = 'https://store.example'
const api = 'https://api.example'
const seeds = JSON.parse(await readFile(new URL('../../backend/database/seed/products.json', import.meta.url), 'utf8'))

async function assertWebP(path) {
  assert.match(path, /^\/images\/[a-z]+\.webp$/)
  const image = await readFile(new URL(`../public${path}`, import.meta.url))
  assert.equal(image.toString('ascii', 0, 4), 'RIFF', path)
  assert.equal(image.toString('ascii', 8, 12), 'WEBP', path)
  assert.equal(image.readUInt32LE(4) + 8, image.length, path)
}

test('every seeded product bypasses the API image host and resolves to a bundled WebP', async () => {
  for (const product of seeds) {
    const candidates = productImageCandidates(product, api, origin)
    assert.deepEqual(candidates, [product.imageUrl.replace(/\.jpg$/, '.webp')], product.name)
    await assertWebP(candidates[0])
  }
})

test('custom API URLs are preferred with a seeded fallback and generic missing images can stay missing', () => {
  const custom = 'https://media.example/earphones.png'
  assert.deepEqual(productImageCandidates({ id: 'prod_001', imageUrl: custom }, api, origin),
    [custom, '/images/earphones.webp'])
  assert.deepEqual(productImageCandidates({ id: 'new-product', imageUrl: '/uploads/product.png' }, api, origin),
    [api + '/uploads/product.png'])
  assert.deepEqual(productImageCandidates({ id: 'new-product', imageUrl: ' ' }, api, origin), [])
})

test('every mock product keeps its own local image despite overlapping seeded IDs', async () => {
  for (const product of mockProducts({ city: 'pune' }).products) {
    assert.deepEqual(productImageCandidates(product, undefined, origin), [product.imageUrl])
    await assertWebP(product.imageUrl)
  }
})
