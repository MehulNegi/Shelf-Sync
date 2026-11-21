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

The backend must allow the frontend origin through CORS, typically `FRONTEND_ORIGIN=http://localhost:5173`. For local development, set `VITE_API_BASE_URL=http://127.0.0.1:3000/api` or use the matching localhost address for a loopback reservation demo. An optional trailing `/api` is accepted. You can also set the variable in an ignored `.env.local` file and restart Vite. Production builds read it at build time. Keep database credentials on the backend.

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

The storefront keeps its existing checkout and mock mode by default. Set `VITE_CART_RESERVATIONS=true` with a live `VITE_API_BASE_URL` only after deploying the complete backend reservation rollout in [C7](../contracts/api.md). The backend must also enable C7 and enforce its transport and Origin checks.

Use the backend's documented same-origin or same-site HTTPS setup. For an authorized HTTP loopback demo, use the same hostname for both ports and enable the backend's separate local HTTP reservation exception. The reservation cookie is managed by the backend. The browser keeps desired cart quantities in local storage and may keep an unresolved request's ID and payload in tab-scoped session storage for safe replay. It reconciles holds from the API after reload, uses backend deadlines for display, and never automatically renews an expired reservation. Existing mock checkout does not simulate holds.

## ProfitOS

Open `#/admin/profit-os` from the Inventory Command Center. Order Autopsy shows the fixed illustrative sale, while the Loss Prevention Lab and strategy presets calculate contribution from local demo assumptions. The demo scenario works in mock and live storefront configurations without calling an API or saving any scenario inputs.

Use **Analyze a product** for the selected city's catalog. ProfitOS reads the existing product listing endpoint when a live API base is configured and labels the mock catalog otherwise. Search filters the selected city's returned product names and IDs. Valid catalog prices initialize labeled fictional demo assumptions. The deterministic model uses product identity, category, price, and city. Edits remain in memory by product and city, and **Reset to demo estimates** discards edits only for the selected product and city. A cleared cost or unavailable price prevents contribution and strategy calculations. The original illustrative scenario remains available under **Demo scenario**.


## Vercel deployment and Render API proxy

Use the Vite preset with **Root Directory** set to `frontend`, build command `npm run build`, and output directory `dist`. The app uses hash routes, so no SPA catch-all is needed. If the project already has a catch-all, keep API routing ahead of it.

Set these variables in the Vercel **Production** environment, then redeploy so the Vite bundle and rewrite are built together.

| Variable | Value |
| --- | --- |
| `RENDER_API_ORIGIN` | The actual Render web service HTTPS origin ending in `.onrender.com`. Use the origin only, without `/api`, a port, or credentials. |
| `VITE_API_BASE_URL` | `/api` |
| `VITE_CART_RESERVATIONS` | `false` for the initial release, or leave unset |

`vercel.mjs` generates the external rewrite at build time. Only the relative `/api` base goes into the browser bundle. The rewrite keeps the original API path and leaves the HTTP request and upstream response handling to Vercel. No CORS allowances or forwarded-header overrides are configured on the frontend proxy. API responses are marked `no-store`. A Vercel environment with both API settings unset can still build a mock storefront. Leave previews in mock mode unless they have a separately authorized staging backend and matching Origin configuration. Local `npm run dev` continues to support direct loopback and mock modes. [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts) · [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)

### Rollout checks

1. Start with Render `RESERVATIONS_ENABLED=false` and the frontend flag off. Keep `FRONTEND_ORIGIN=https://shelf-sync-tau.vercel.app` on Render and follow the [B10 Render runbook](../backend/docs/render-deployment.md). Admin and persistent profitability stay disabled on the public backend.
2. On the deployed Vercel hostname, check `/api/health`, `/api/ready`, and `/api/products?city=pune`. In the browser network panel, confirm the URL stays on Vercel, the city query reaches Render, error status and JSON are preserved, and API responses are served without caching. Confirm POST/PATCH/DELETE, JSON bodies, and `Idempotency-Key` forwarding against isolated staging fixtures.
3. Before enabling reservations publicly, verify the actual Render ingress peer, TLS attestation and forwarding-header overwrite behavior under B10. In an authorized restricted deployment using isolated fixtures, confirm that the session response passes through `Set-Cookie` unchanged and the browser stores `__Host-shelfsync_cart` on the frontend hostname with `Secure; HttpOnly; SameSite=Strict; Path=/` and no `Domain`. Confirm subsequent same-origin calls send the cookie, foreign-origin requests are denied, and session, hold, release and checkout responses are never cached. Check that a reload preserves the hold deadline. Keep cookie values out of logs and test artifacts.
4. Keep both reservation flags off for public traffic until these checks pass. A successful catalog proxy request alone does not verify cookie handling or TLS trust.
