# ShelfSync storefront

Use Node.js 20.19+ in the 20.x series or Node.js 22.12+. From the repository root:

```sh
cd frontend
npm install
npm run dev
```

Run `npm run build` from `frontend/` to type-check and build for production.

## Product API

The default catalog uses mock data with city-specific stock and case-insensitive substring search. Prices are in INR, and price bounds are inclusive. Demo product thumbnails are sourced from [DummyJSON](https://dummyjson.com/docs/products).

To use the backend, start Vite with `VITE_API_BASE_URL=http://localhost:3000 npm run dev`, or set that variable in an ignored `.env.local` file and restart Vite. Supply the backend base URL without the `/api` suffix. The adapter appends `/api/products` and sends the parameters in [the API contract](../contracts/api.md). Configure the backend to allow the Vite origin through CORS. Root-relative product image URLs resolve on the backend origin in API mode. Production builds read the variable at build time.
