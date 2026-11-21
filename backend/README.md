# ShelfSync backend

Fastify 5, strict TypeScript, and PostgreSQL via `pg`. Use Node.js 22 or later (an active LTS release is recommended). Run all commands below from `backend/`.

## Setup and commands

```sh
npm install
cp .env.example .env
# Edit .env with your Aiven service URL and local project CA certificate path.
npm run migrate
npm run seed
npm run build
npm start
```

Development: `npm run dev`. Default URL: `http://localhost:3000/api`. Production startup: `npm start` after `npm run build`. Compiled files retain the `dist/src/` structure. Keep `database/` alongside `dist/` when packaging migration/seed tools. Stop with SIGINT/SIGTERM to close HTTP connections and the database pool.

## Environment and Aiven

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL from Aiven; URL-encode credentials. |
| `DATABASE_CA_CERT_PATH` | Path to Aiven project CA PEM, relative to the working directory or absolute. Required when the server certificate uses the Aiven project CA. Omit only for a certificate trusted by Node's default CA store. |
| `PORT` | HTTP port; default `3000`. |
| `HOST` | Bind address; default `0.0.0.0`. |
| `FRONTEND_ORIGIN` | Exact allowed HTTP(S) origin; default `http://localhost:5173`, no trailing slash. |
| `NODE_ENV` | `development`, `test`, or `production`; default `development`. |

In Aiven Console, obtain the PostgreSQL service URI and download the project CA certificate. Save the certificate to `backend/certs/ca.pem` (ignored by Git) and set `DATABASE_CA_CERT_PATH`. The service must be running and reachable from this machine. The database role needs schema/table/index creation privileges for migrations and read/write privileges for seeds. Never commit `.env`, credentials, certificates, or private keys.

TLS certificate and hostname verification stay enabled, including if an Aiven URL contains `sslmode=require`. The application removes that URL option before supplying an explicit verified TLS configuration. `sslmode=verify-full` is also accepted; other SSL URL options are rejected to prevent `pg` from overriding that configuration. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`. See the [Aiven Node.js TLS example](https://aiven.io/docs/products/postgresql/howto/connect-node) and [node-postgres SSL configuration](https://node-postgres.com/features/ssl).

Startup checks a real PostgreSQL connection before listening. Missing credentials, unreadable CA files, and failed connections cause a nonzero exit with setup guidance. There is no in-memory fallback. The pool has at most five connections, a five-second connection timeout, and a ten-second statement timeout. Raw driver errors and request headers/URLs are not logged.

## Database operations

`npm run migrate` applies ordered SQL files in `database/migrations/` in a transaction, records checksums, and serializes concurrent runs with a transaction advisory lock. Repeated runs skip applied files. Never edit an applied migration; add a new migration. For migration failures, inspect database state and migration SQL using a trusted database client; CLI output intentionally omits raw driver details.

`npm run seed` upserts metadata for stable product IDs `prod_001` through `prod_012`. It inserts missing inventory rows for Pune, Delhi, and Bengaluru, preserving existing stock/version values. A fresh database has earphones stock of 1/8/3 respectively. It is safe to repeat, but does not reset inventory for a demo after checkout. Product prices are decimal INR rupees in PostgreSQL, serialized as JSON numbers (1999 means ₹1,999; 159.50 means ₹159.50).

Schema includes products, versioned city inventory, orders, order items, and JSON outbox events. Checkout uses the existing schema; this sprint adds no migrations. Kafka publishing/consuming and OpenSearch are not implemented here.

## Transactional checkout and outbox

`POST /api/orders` accepts a supported lowercase city and 1–100 cart entries. Quantities must be JSON integers from 1 to 2,147,483,647. Duplicate product IDs are combined; the combined quantity must fit the same range. Extra fields such as client-supplied prices/totals are rejected. Product IDs are sorted before inventory updates so overlapping multi-item carts acquire row locks in the same order.

One checked-out PostgreSQL client executes the complete `READ COMMITTED` transaction. Prices come from PostgreSQL; arithmetic uses integer paise internally to avoid floating-point rounding, while SQL and API prices/totals remain INR rupees. Each inventory update conditionally deducts stock only when `quantity >= requested`, increments `version`, and updates `updated_at`. A missing product, missing city inventory, or insufficient stock returns the contract's HTTP 409 `INSUFFICIENT_STOCK`. Any failure rolls back inventory, versions, orders, items, and outbox writes. A client with a failed rollback is discarded from the pool.

The transaction creates one confirmed order, one item per distinct product, and one unpublished `inventory.changed` event per changed inventory row. Success is returned only after commit. PostgreSQL rechecks a conditional update's predicate after a competing updater commits; see [PostgreSQL transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html) and [node-postgres transactions](https://node-postgres.com/features/transactions).

Outbox rows use a UUID matching `payload.eventId`, `event_type=inventory.changed`, and a JSON payload:

```json
{
  "eventId": "uuid",
  "type": "inventory.changed",
  "schemaVersion": 1,
  "productId": "prod_001",
  "city": "pune",
  "quantity": 0,
  "inventoryVersion": 8,
  "occurredAt": "2026-11-21T10:00:00.000Z"
}
```

`quantity` and `inventoryVersion` describe the resulting committed inventory, not a delta. `published_at` remains null for the next sprint's publisher. No external messages are sent by checkout. Inventory versions exceeding JSON's safe integer range fail and roll back instead of emitting a rounded version.

`GET /api/orders/:id` reads persisted orders/items and returns standard-format HTTP 404 for missing orders. Unit prices and totals are checkout snapshots; names come from the current product record. Each POST is a new purchase; request replay/idempotency is not part of the shared contract.

## API integration

The shared contract in `../contracts/api.md` remains unchanged.

- `GET /api/health` returns exactly `{"status":"ok"}`. This is a liveness endpoint; startup separately checks connectivity.
- `GET /api/products?city=pune` returns `{products,total}`. Supports optional `q`, `category`, `minPrice`, and `maxPrice`.
- `GET /api/products/:id?city=pune` returns the same product shape, or standard-format 404.
- `POST /api/orders` creates a confirmed order (HTTP 201) or returns the standard error envelope, including HTTP 409 for unavailable stock.
- `GET /api/orders/:id` returns persisted order details or standard-format HTTP 404.

City is required and accepts only `pune`, `delhi`, or `bengaluru`. Categories are matched exactly (seed uses `electronics`, `apparel`, `groceries`). Search is a case-insensitive literal substring across name and description; typo tolerance awaits OpenSearch. Price bounds are inclusive, nonnegative INR values; inverted bounds return 400. Queries reject unknown keys, repeated scalar parameters, and excessively long text. Unknown categories and searches return empty results. All products remain visible even when selected-city inventory is missing or zero (`stock:0`, `available:false`). The initial catalog is unpaginated; `total` is the filtered product count.

Set frontend `VITE_API_BASE_URL` to the backend `/api` URL and `FRONTEND_ORIGIN` to the frontend origin. Seed image URLs follow the contract's `/images/...` convention; the frontend must supply those assets. This backend does not serve image files.

## Verification

```sh
npm run build
npm test
npm run test:integration
```

`npm test` runs credential-free HTTP contract/validation/CORS/service tests with explicit injected repository doubles, SQL parameterization/mapping tests with a query double, and TLS/environment configuration tests. These do not verify live PostgreSQL behavior or concurrency.

The separate integration suite skips unless explicitly enabled:

```sh
# Configure .env to use a dedicated Aiven TEST database, then:
RUN_DB_TESTS=1 npm run test:integration
```

Integration tests create random isolated schemas in the configured database and drop only those schemas afterward; the test role needs CREATE privileges. They never truncate/reset demo tables. The foundation suite applies actual migrations twice, seeds twice, exercises real SQL search/category/price/city filtering through HTTP, tests constraints, and verifies reseeding preserves changed stock/version.

The checkout suite uses dedicated generated products and checks single/multi-item success, insufficient stock, strict quantity validation, duplicate IDs, decimal server-side totals, order retrieval, city availability, complete rollback when a later item fails, late database write failure, and event payloads. Ten independent last-unit races each launch two checkout requests with `Promise.all` and assert exactly one 201, one 409, stock zero, one confirmed order, and one committed event. A reversed multi-item cart race checks deterministic ordering. These concurrency assertions run against real PostgreSQL, never a mocked database. Use a dedicated test database where possible. An enabled suite fails on unavailable credentials/TLS/database errors instead of skipping. Default test output and integration output must be reported separately.

Next task: publish committed outbox events to Kafka with retry handling, then apply versioned inventory updates to OpenSearch.
