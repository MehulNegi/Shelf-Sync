# B15 — public demo order feed

The project owner confirmed that ShelfSync and its Aiven PostgreSQL database are exclusively a hackathon demo, every stored order is a test/demo order, and no real customer orders exist in this dataset. That database-level isolation is the access boundary for this intentionally public, read-only endpoint. It is not authentication or a production retailer order-list API.

**Disable `DEMO_ORDER_FEED_ENABLED` before introducing any real/private customer orders, sharing this database with a production shop, or repointing DATABASE_URL at a non-demo dataset.** The schema has no shop/demo marker, so the endpoint cannot separate mixed production/demo records. CORS, a hidden URL, a recent-date filter or a 20-row limit do not provide that boundary.

## Exact HTTP contract

`GET /api/demo/orders`, with **no query parameters**, returns HTTP 200:

```json
{
  "orders": [
    {
      "id": "ord_example",
      "city": "pune",
      "status": "confirmed",
      "total": 1999,
      "created_at": "2026-11-22T12:00:00.000Z"
    }
  ]
}
```

- The top-level object has only `orders`. Each order has exactly the five fields shown. No product/customer/session/token/payment details, order items, cursor, asOf or other metadata are returned.
- `id` is the persisted order ID. `city` is `pune`, `delhi` or `bengaluru`. `status` is the persisted `pending`, `confirmed` or `cancelled` value.
- `total` is a nonnegative JSON number in **INR rupees**, read from the stored order; 1999 means ₹1,999. No price/total is recalculated.
- `created_at` is an ISO 8601 UTC timestamp ending in Z. Results are ordered by the full database `created_at` descending, then ID descending with PostgreSQL C collation to break ties. JSON timestamps retain millisecond display precision.
- Return the latest **20** rows, or fewer if fewer exist. An empty database returns `{"orders":[]}`. There is no pagination. All query keys, including `limit` and `cursor`, are rejected rather than changing the fixed bound.
- `Cache-Control: no-store` is set on successful and error GET responses. The route has no writes or cookie/session issuance. Non-GET mutation methods are not registered.

Errors use the standard envelope `{"success":false,"error":{"code":"…","message":"…"}}`:

| HTTP | Code | Message / behavior |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `Invalid request parameters` — query parameters are unsupported |
| 429 | `RATE_LIMITED` | `Too many demo order requests` — Retry-After gives whole seconds until the next window |
| 503 | `DEMO_ORDERS_DISABLED` | `Demo order feed is not enabled` — no database access |
| 503 | `DATABASE_UNAVAILABLE` | `Demo orders are temporarily unavailable` — no fabricated empty/success response |

The limiter admits **60 requests per 60-second window per API process**, shared across all callers and unaffected by supplied IP/forwarding headers. That supports five-second polling for a small demo audience without a new dependency, trusted-IP configuration or unbounded per-IP memory. It resets on restart and is not a distributed/authentication control. Rate checks happen before query validation/storage access, including on HEAD requests Fastify derives from GET. Existing admin, checkout and cart admission behavior is unchanged.

## Frontend integration

Use the existing same-origin Vercel API proxy:

```text
https://shelf-sync-tau.vercel.app/api/demo/orders
```

Direct backend verification after deployment uses:

```text
https://shelfsync-api-totm.onrender.com/api/demo/orders
```

The generic rewrite already forwards `/api/demo/orders`; it does not collide with signed cart/checkout gateway paths. No frontend or Vercel file was changed by B15.

The current frontend admin orders adapter expects `orderId`, `createdAt`, `asOf` and `page`, and the concurrently prepared F21 adapter requests `?limit=10`/optional cursor. **Do not pass this feed unchanged into that adapter or merely change its URL variable.** Its owner must add a feed-specific validator/reader that calls the endpoint without query parameters, maps `id → orderId` and `created_at → createdAt` for the existing RecentOrders view, and removes pagination for this fixed recent-orders feed. Do not invent a server `asOf` timestamp or cursors. Keep the admin orders contract unchanged. Disabled-feed code `DEMO_ORDERS_DISABLED` matches F21's explicit demo-fallback handling; empty live results must stay distinct from fictional demo data and network/database errors.

Poll immediately on opening Customer Orders and approximately every five seconds while visible, without overlapping requests; stop/abort when the page/tab closes, retain appropriate error/last-refresh states and honor Retry-After on 429. No Kafka consumer, WebSocket, login or browser-local order list is needed. This endpoint reads committed PostgreSQL orders, so customer checkout and the retailer view can use different devices. Render cold starts, database/network latency and frontend polling affect observed delay; five seconds is a polling target, not an end-to-end guarantee.

## Manual deployment and rollback

1. Confirm the target remains the owner-approved demo-only database. Review and manually deploy the approved B15 commit; do not merge/deploy automatically. Build with `npm ci --include=dev && npm run build` and use the existing API start command `node dist/src/server.js`. No migration, seed, bootstrap, worker change or database write is required.
2. Keep `ADMIN_AUTH_MODE=disabled` and profitability flags off. Leave all existing reservation, gateway, inventory, Kafka and OpenSearch settings unchanged.
3. Explicitly set **`DEMO_ORDER_FEED_ENABLED=true`** in the Render API environment only when ready to expose the demo dataset, then perform the approved manual deployment/restart. Default/unset/false disables the feed; invalid flag values fail startup with configuration guidance. No `.env` file or provider settings were changed by this task.
4. Verify the direct backend and Vercel URLs return the exact JSON above and `Cache-Control: no-store`. Existing protected `/api/admin/orders` must still return `ADMIN_DISABLED`. Coordinate the separate frontend adapter change described above before expecting Customer Orders to show the live feed.
5. Roll back exposure by setting `DEMO_ORDER_FEED_ENABLED=false` and manually restarting/redeploying the API; verify HTTP 503 `DEMO_ORDERS_DISABLED`. Do not delete orders, reseed, reverse migrations or change checkout/reservations. Disable the flag **before** any real/private orders enter the database.

Example read-only checks after an approved deployment:

```sh
curl -i 'https://shelfsync-api-totm.onrender.com/api/demo/orders'
curl -i 'https://shelf-sync-tau.vercel.app/api/demo/orders'
curl -i 'https://shelf-sync-tau.vercel.app/api/admin/orders'
```

## Verification

```sh
cd backend
npm run build
npm test
RUN_DEMO_ORDER_FEED_TESTS=1 node --import tsx --test tests/integration/demo-orders.test.ts
```

The focused tests cover default-off/exact configuration, flag gating before any database access, the five-field whitelist, the 20-row cap, empty results, rejected query parameters, global polling limits/recovery, parameterized newest-first SQL, database error sanitization and unchanged disabled admin APIs. Existing checkout/reservation/tracking/publisher/search unit tests also ran.

The opt-in PostgreSQL test uses existing records in a `REPEATABLE READ READ ONLY` transaction, verifies read-only mode, compares the route response with the stored latest records, and rolls back. It creates no fixtures, schemas, migrations, reservations, orders or inventory changes. It does not set the process/deployment feature flag; enabling a local app factory for the test does not activate the public endpoint.

Actual results: production build passed; **94 backend unit tests passed**, zero failures/skips. The read-only Aiven verification passed and matched **17 existing persisted demo orders**. The initial sandbox DNS denial was resolved with approved network access. The write-based PostgreSQL checkout/reservation/concurrency suites were not rerun because no separate isolated test database was provisioned for this task and production database mutations were prohibited. Their implementation was not changed. No public deployment, environment activation or cross-device browser test was performed.
