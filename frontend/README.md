# ShelfSync storefront

Use Node.js 20.19+ in the 20.x series or Node.js 22.12+. From the repository root:

```sh
cd frontend
npm install
```

## Live API mode

Start the ShelfSync backend, then run this from `frontend/`:

```sh
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```

The backend must allow the frontend origin through CORS, typically `FRONTEND_ORIGIN=http://localhost:5173`. Set `VITE_API_BASE_URL` to the public HTTP address of the backend. An optional trailing `/api` is accepted. You can also set the variable in an ignored `.env.local` file and restart Vite. Production builds read it at build time. Keep database credentials on the backend.

The storefront uses the product list and product detail routes for city-specific availability. Checkout posts the current city's product IDs and quantities, then retrieves the confirmed order by ID. Both order endpoints must be implemented for the full live flow. See the [shared API contract](../contracts/api.md). Root-relative product image URLs are tried on the API origin, with a local fallback for `/images/` assets.

## Offline mock mode

Run `VITE_API_BASE_URL= npm run dev` from `frontend/` to force mock mode, including when `.env.local` configures a live URL. With the variable unset, mock mode is the default. Mock search uses case-insensitive substring matching, and price bounds are inclusive. Mock checkout is labeled in the UI and simulates orders and stock changes until the page reloads. Demo product thumbnails are sourced from [DummyJSON](https://dummyjson.com/docs/products).

The selected city and its cart, along with carts for other cities, persist in browser storage. The header shows the current city's quantity. Switching cities restores that city's cart. Mock mode and each configured backend have separate saved carts.

## Checks

```sh
npm test
npm run build
```

## Demo walkthrough

1. In live mode, confirm the storefront says **Live API mode** and select **Pune**.
2. Search for **Bluetooth Earphones**. Check the card's Pune stock count, then add an available unit to the cart.
3. Open the Pune cart and place the order. A successful response shows the order ID and server-calculated total. If stock changed, the cart refreshes and shows which quantities need adjustment.
4. For offline rehearsal, start in **Mock mode**. The sample catalog also contains Wireless Bluetooth Earphones. Reloading resets simulated inventory and orders while retaining saved cart items.
