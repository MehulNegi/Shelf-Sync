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

The storefront uses the product list and product detail routes for city-specific availability. Checkout posts the current city's product IDs and quantities, then retrieves the confirmed order by ID. Both order endpoints must be implemented for the full live flow. See the [shared API contract](../contracts/api.md). Seeded catalog image paths resolve directly to bundled WebP assets. Custom image URLs supplied by the API are tried first and can fall back to bundled images for seeded products. The eleven new product illustrations were generated for ShelfSync.

## Offline mock mode

Run `VITE_API_BASE_URL= npm run dev` from `frontend/` to force mock mode, including when `.env.local` configures a live URL. With the variable unset, mock mode is the default. Mock search uses case-insensitive substring matching, and price bounds are inclusive. Mock checkout is labeled in the UI. Simulated order history persists, while mock inventory resets on reload. Demo product thumbnails are sourced from [DummyJSON](https://dummyjson.com/docs/products).

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
4. For offline rehearsal, start in **Mock mode**. The sample catalog also contains Wireless Bluetooth Earphones. Reloading resets simulated inventory while retaining mock orders and saved cart items.

## My Orders

Open **My Orders** to view purchases saved in this browser. Live mode stores order IDs only, scoped to the configured backend. The page fetches order details through `GET /api/orders/:id` and lists IDs in reverse checkout order. Mock orders use separate browser storage and are labeled as simulated.

Live mode also fetches `GET /api/orders/:id/tracking` for each saved ID. Purchase dates come from `createdAt` and appear in the browser’s timezone. Dated orders sort newest first, with undated orders retaining their saved sequence afterward. The timeline uses persisted status and known `occurredAt` values. A legacy observation with an unknown occurrence time displays **Time unavailable**. If tracking can’t load, order details remain available and tracking can be retried independently. The backend currently supports `pending`, `confirmed`, and `cancelled`, so future fulfillment stages remain pending. For active live orders with a valid purchase timestamp, pending milestones without persisted events show labeled **Demo estimates** based on the browser’s local calendar. These dates are calculated for display only. Mock tracking stays separate.

## Inventory Command Center

The storefront footer links to `#/admin`. For the local demo, run the backend in its authorized loopback-only mode on the same laptop, then start Vite from `frontend/`:

```sh
VITE_API_BASE_URL=http://127.0.0.1:3000/api npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173/#/admin`. The frontend origin must match the backend allowlist exactly. The dashboard reads the overview, inventory, orders, and events endpoints from section 9 of the [shared API contract](../contracts/api.md). It sends no credentials, refreshes every five seconds, and cancels requests when the dashboard closes. Inventory supports exact category, city, and stock-status filters plus cursor pagination. Product search searches the current inventory page. The event list reports only committed Kafka publication markers.

## Timed cart reservations

The storefront keeps its existing checkout and mock mode by default. Set `VITE_CART_RESERVATIONS=true` with a live `VITE_API_BASE_URL` only after deploying the complete backend reservation rollout in [C7](../contracts/api.md). The current backend does not implement C7. A flag alone cannot enable reservations.

Use the backend's documented same-origin or same-site HTTPS setup. For an authorized HTTP loopback demo, use the same hostname for both ports and enable the backend's separate local HTTP reservation exception. The reservation cookie is managed by the backend. The browser keeps desired cart quantities in local storage and may keep an unresolved request's ID and payload in tab-scoped session storage for safe replay. It reconciles holds from the API after reload, uses backend deadlines for display, and never automatically renews an expired reservation. Existing mock checkout does not simulate holds.
