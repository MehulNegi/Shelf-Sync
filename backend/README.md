# ShelfSync backend

B15 demo order feed: [exact response contract, frontend adapter mapping and manual activation](docs/demo-orders.md). `GET /api/demo/orders` is read-only, default-off and limited to the owner-confirmed demo-only database. Disable `DEMO_ORDER_FEED_ENABLED` before introducing real/private customer orders; protected admin APIs remain disabled.

Render B10: see [deployment configuration, security blockers and rollback](docs/render-deployment.md). This prepares four independent services; it does not deploy them. Public admin and ProfitOS stay disabled. The Vercel/Render cookie topology must be verified before enabling reservations.

ProfitOS B8: see [implementation, policy gates and migration instructions](docs/profitability-implementation.md). The module defaults off; F14 remains frontend-only, and automatic checkout financial capture is deferred pending the C8.1 policy decisions.

F15/B8.1: see [product/city integration readiness and the deployment checklist](docs/f15-backend-readiness.md). Verification uses isolated fixtures and does not activate persistent costs or apply shared migrations.

Timed cart reservations: see [setup, rollout and recovery](docs/reservations.md). The module is disabled by default and implements shared contract section 10; frontend reservation integration is a separate task.

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
| `DATABASE_POOL_MAX` | Per-process limit, integer 1–10; default 5. Budget API/workers and overlapping deployments together. |
| `PORT` | HTTP port; default `3000`. |
| `HOST` | Bind address; default `0.0.0.0`. |
| `FRONTEND_ORIGIN` | Exact allowed HTTP(S) origin; default `http://localhost:5173`, no trailing slash. |
| `NODE_ENV` | `development`, `test`, or `production`; default `development`. |

In Aiven Console, obtain the PostgreSQL service URI and download the project CA certificate. Save the certificate to `backend/certs/ca.pem` (ignored by Git) and set `DATABASE_CA_CERT_PATH`. The service must be running and reachable from this machine. The database role needs schema/table/index creation privileges for migrations and read/write privileges for seeds. Never commit `.env`, credentials, certificates, or private keys.

TLS certificate and hostname verification stay enabled, including if an Aiven URL contains `sslmode=require`. The application removes that URL option before supplying an explicit verified TLS configuration. `sslmode=verify-full` is also accepted; other SSL URL options are rejected to prevent `pg` from overriding that configuration. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`. See the [Aiven Node.js TLS example](https://aiven.io/docs/products/postgresql/howto/connect-node) and [node-postgres SSL configuration](https://node-postgres.com/features/ssl).

Startup checks a real PostgreSQL connection before listening. Missing credentials, unreadable CA files, and failed connections cause a nonzero exit with setup guidance. There is no in-memory fallback. The pool defaults to five connections, with a five-second connection timeout and a ten-second statement timeout. Raw driver errors and request headers/URLs are not logged. `/api/health` retains its liveness response. `/api/ready` is a no-store PostgreSQL readiness probe with a two-second response deadline; it does not assert Kafka/OpenSearch synchronization. API and workers drain on SIGINT/SIGTERM with a 25-second shutdown deadline.

## Database operations

`npm run migrate` applies ordered SQL files in `database/migrations/` in a transaction, records checksums, and serializes concurrent runs with a transaction advisory lock. Repeated runs skip applied files. Never edit an applied migration; add a new migration. For migration failures, inspect database state and migration SQL using a trusted database client; CLI output intentionally omits raw driver details.

`npm run seed` upserts metadata for stable product IDs `prod_001` through `prod_012`. It inserts missing inventory rows for Pune, Delhi, and Bengaluru, preserving existing stock/version values. A fresh database has earphones stock of 1/8/3 respectively. It is safe to repeat, but does not reset inventory for a demo after checkout. Product prices are decimal INR rupees in PostgreSQL, serialized as JSON numbers (1999 means ₹1,999; 159.50 means ₹159.50).

Schema includes products, versioned city inventory, orders, order items, and JSON outbox events. Run migration 003 before starting this version, even with cart routes disabled: checkout, live product availability and search bootstrap read reservation tables. The migration is additive and preserves existing data. PostgreSQL remains authoritative for catalog prices, orders, and inventory; OpenSearch is an eventually consistent projection.

## Transactional checkout and outbox

`POST /api/orders` accepts a supported lowercase city and 1–100 cart entries. Quantities must be JSON integers from 1 to 2,147,483,647. Duplicate product IDs are combined; the combined quantity must fit the same range. Extra fields such as client-supplied prices/totals are rejected. Product IDs are sorted before inventory updates so overlapping multi-item carts acquire row locks in the same order.

One checked-out PostgreSQL client executes the complete `READ COMMITTED` transaction. Prices come from PostgreSQL; arithmetic uses integer paise internally to avoid floating-point rounding, while SQL and API prices/totals remain INR rupees. After locking inventory rows in deterministic order, legacy checkout verifies physical stock minus unexpired holds before its conditional physical decrement. Each changed inventory key increments `version` and updates `updated_at` once. A missing product, missing city inventory, or insufficient stock returns the contract's HTTP 409 `INSUFFICIENT_STOCK`. Any failure rolls back inventory, versions, orders, items, and outbox writes. A client with a failed rollback is discarded from the pool.

The transaction creates one confirmed order, one item per distinct product, and one unpublished `inventory.changed` event per changed inventory row. Success is returned only after commit. PostgreSQL rechecks a conditional update's predicate after a competing updater commits; see [PostgreSQL transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html) and [node-postgres transactions](https://node-postgres.com/features/transactions).

Outbox rows use a UUID matching `payload.eventId`, `event_type=inventory.changed`, and a JSON payload:

```json
{
  "eventId": "uuid",
  "type": "inventory.changed",
  "schemaVersion": 2,
  "productId": "prod_001",
  "city": "pune",
  "quantity": 0,
  "reservedQuantity": 0,
  "availableQuantity": 0,
  "nextExpirationAt": null,
  "causes": ["checkout.confirmed"],
  "inventoryVersion": 8,
  "occurredAt": "2026-11-21T10:00:00.000Z"
}
```

`quantity` and `inventoryVersion` describe the resulting committed inventory, not a delta. `published_at` starts null and is set by the standalone publisher after Kafka acknowledges the event. No external messages are sent by checkout. Inventory versions exceeding JSON's safe integer range fail and roll back instead of emitting a rounded version.

`GET /api/orders/:id` reads persisted orders/items and returns standard-format HTTP 404 for missing orders. Unit prices and totals are checkout snapshots; names come from the current product record. Legacy POSTs without reservation IDs remain new purchases. Reservation-aware checkout requires an owning cookie and idempotency key; see the reservation runbook and shared contract section 10.

## Persisted order tracking

`GET /api/orders/:id/tracking` returns one order's persisted status, original creation time, and chronological history. Existing checkout and order-details responses are unchanged. The additive integration specification, including the proposed shared-contract addition and exact response fields, is in [`contracts/order-tracking.md`](contracts/order-tracking.md); shared root contracts are unchanged.

Apply `002_order_tracking.sql` with `npm run migrate` before starting the updated server. It adds `order_status_history`, an insert trigger that records initial status in the checkout transaction, and a guard that rejects status changes until an authorized workflow exists. The migration briefly locks order writes while recording legacy snapshots and installing the trigger. Existing orders and their creation times/statuses are preserved. Legacy snapshots explicitly have an unknown occurrence time (`occurredAt:null`); `recordedAt` is only the time the database recorded the observation.

New successful checkouts have one real, timestamped `confirmed` entry. No shipping dates, courier names, tracking numbers, delivery estimates, or time-based progression are generated. There is no suitable authorization mechanism, so fulfillment transitions remain disabled and no public update or order-list endpoint is exposed. The future authorized workflow must enforce `confirmed → processing → shipped → delivered` and timestamp each transition atomically; it is not implemented here.

Tracking failure rolls back with checkout: the new history entry, order/items, inventory/version, and inventory outbox writes commit or roll back together. Kafka/OpenSearch inventory events and consumers are unchanged.

## Aiven Kafka outbox publisher

Copy the existing Aiven Kafka **Quick Connect** settings into `backend/.env`, using the same authentication method and its matching port. The template documents both SASL and client-certificate/mTLS modes. Do not change the service's authentication configuration or create new credentials just to use this worker. KafkaJS supports the required TLS/SASL client options; see [KafkaJS configuration](https://kafka.js.org/docs/configuration) and [Aiven authentication](https://aiven.io/docs/products/kafka/concepts/auth-types).

Select/create `inventory-events` in Aiven Quick Connect and use a service user with topic write/describe access. The worker disables automatic topic creation. The live verification test additionally requires topic read and temporary consumer-group access. SASL and mTLS use different broker ports; copy the endpoint for the selected mode.

| Variable | Purpose |
| --- | --- |
| `KAFKA_BROKERS` | Required comma-separated `host:port` values, without schemes or credentials. |
| `KAFKA_AUTH_MODE` | Required `sasl` or `mtls`, matching existing Quick Connect settings. |
| `KAFKA_CA_CERT_PATH` | Project CA PEM path. Omit only for a public CA already trusted by Node. Required for Aiven mTLS. |
| `KAFKA_SASL_MECHANISM` | SASL only: `plain`, `scram-sha-256` (default), or `scram-sha-512`. |
| `KAFKA_USERNAME`, `KAFKA_PASSWORD` | Required for SASL; existing service user credentials. |
| `KAFKA_CLIENT_CERT_PATH`, `KAFKA_CLIENT_KEY_PATH` | Required for mTLS; existing service certificate and private key paths. |
| `KAFKA_CLIENT_ID` | Defaults to `shelfsync-outbox`. |
| `KAFKA_REQUEST_TIMEOUT_MS` | Connect/authentication/request/send timeout; default 10000, maximum 60000 ms. |
| `OUTBOX_BATCH_SIZE` | Maximum events per poll; default 25, maximum 100. |
| `OUTBOX_POLL_INTERVAL_MS` | Pause between polls; default 1000, maximum 60000 ms. |
| `OUTBOX_RETRY_INITIAL_MS`, `OUTBOX_RETRY_MAX_MS` | Exponential backoff ceilings; defaults 1000/30000 ms, with 50–100% jitter. Maximum retry ceiling 300000 ms. |

The worker also needs the existing PostgreSQL variables. Place certificate/key files under ignored `backend/certs/` and use paths relative to `backend/` or absolute paths. TLS certificate and hostname verification remain enabled in both modes; missing/invalid configuration fails with setup instructions. Neither credentials nor raw Kafka/PG errors are written to worker logs.

Start from `backend/` after configuring `.env` and applying the foundation migration:

```sh
npm run build
npm run worker:outbox
```

This is a separate process from the HTTP server. Each poll processes at most the configured batch size, one transaction per event. `SELECT ... FOR UPDATE SKIP LOCKED` claims only committed, unpublished rows. The lock remains held during the Kafka send; `acks=-1` requires all in-sync replicas to acknowledge before the worker updates `published_at` and commits. Concurrent workers skip locked rows. Kafka's internal retry count is finite (two); failures roll back, back off, and retry indefinitely across polls. Shutdown on SIGINT/SIGTERM interrupts the polling/backoff sleep, waits for the current send/transaction to settle, then disconnects Kafka and closes the pool. Allow time for the configured client timeouts and finite retries before force-stopping the process.

Messages go to `inventory-events` with key `<productId>:<city>` and the existing JSON payload unchanged. Delivery is **at least once**: a crash or database failure after Kafka acknowledgement can cause the same `eventId` to be sent again. Unacknowledged events are never intentionally marked published. Multiple workers can publish versions out of order; the consumer's atomic version guard rejects equal/older versions. A malformed/unsupported event remains pending and logs `invalid_event`; correct it after investigating rather than deleting or acknowledging it. An oldest failing event can delay later events on that worker. Structured logs include event IDs, batch counts, failure categories, and retry delays without exposing connection settings.

Publisher tests:

```sh
npm test
RUN_DB_TESTS=1 npm run test:integration
# Only after Kafka Quick Connect and topic permissions are configured:
RUN_KAFKA_TESTS=1 npm run test:kafka
```

The PostgreSQL outbox tests use isolated schemas and a Kafka transport double to verify discovery, row locking, failed-send retries, and duplicate publication after an acknowledged send followed by a database failure. Unit tests cover payloads, bounded polling, backoff, TLS configuration, and graceful shutdown. These do not establish live Kafka delivery.

The opt-in live test performs a real checkout in an isolated PostgreSQL schema, publishes its committed event, and uses a temporary diagnostic Kafka reader to assert the matching event ID, payload, and key appear in `inventory-events`. It cleans up only its database schema and disconnects the reader; the test message remains in Kafka until normal topic retention removes it. `npm run test:kafka` reports a skip unless `RUN_KAFKA_TESTS=1`; an explicitly enabled test fails if configuration/authentication/delivery is unavailable.

## OpenSearch projection and inventory consumer

Configure the official OpenSearch JavaScript client using the existing Aiven service endpoint and credentials. All connections require HTTPS with certificate and hostname verification. Credentials must be supplied separately from the URL, and raw client errors are omitted from application logs.

| Variable | Purpose |
| --- | --- |
| `OPENSEARCH_URL` | HTTPS service origin, such as `https://HOST:PORT`; no embedded credentials or path. Required for bootstrap/consumer. If absent, the HTTP API keeps using PostgreSQL search. |
| `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD` | Existing Aiven OpenSearch credentials. |
| `OPENSEARCH_CA_CERT_PATH` | Optional private/project CA PEM path; omit for a public CA trusted by Node. |
| `OPENSEARCH_INDEX` | Defaults to `shelfsync-products-v1`; lowercase index name. |
| `KAFKA_CONSUMER_GROUP_ID` | Defaults to `shelfsync-inventory-projection-v1`; use the same stable group on restarts. |

The OpenSearch role needs index create/mapping, document update, and search/scroll permissions. The consumer also needs existing Kafka read/describe and consumer-group permissions. Configure these from the existing Aiven service settings; do not disable TLS. Bootstrap needs PostgreSQL configuration; the consumer never connects to or writes PostgreSQL.

From `backend/`:

```sh
npm run build
npm run index:products
# Run these as separate long-lived processes:
npm run worker:outbox
npm run worker:inventory
```

Bootstrap creates the index if absent and applies explicit mappings. Existing incompatible mappings cause an actionable command failure; the command never deletes an index. Product `id`, category and city use keyword mappings, name/description use analyzed text, price uses a scaled float with factor 100 (INR), stock uses an integer, and inventory version uses a long. Each product-city document has ID `SHA256(JSON.stringify([productId, city]))` and holds the API product fields plus `inventoryVersion`, `catalogReady`, and optional `lastEventId`/`occurredAt`.

Bootstrap reads PostgreSQL in keyset batches of 10 products, reconciles expiry under inventory locks, commits before OpenSearch I/O, includes all three cities (missing inventory is stock/version 0), and performs atomic scripted upserts. Catalog fields are refreshed from PostgreSQL, while stock changes only when the incoming inventory version is strictly greater than the stored version. Concurrent Kafka updates therefore survive a stale bootstrap snapshot. Repeating bootstrap is safe; it does not reset stock or delete other documents. Catalog changes need another bootstrap. Catalog deletions or incompatible mapping changes require a fresh index and an explicit rollout; use a new consumer group to replay retained events into that index after bootstrapping.

The consumer reads `inventory-events` from the beginning for a new group and resumes committed offsets for an existing group. It validates historical schema-1 and current schema-2 payloads and their deterministic key. A configured rollout cutoff rejects post-cutover schema-1 records. Schema 2 preserves physical quantity and projects available stock, reserved units and the next expiry. A Painless update script changes only inventory fields when `incoming.inventoryVersion > stored.inventoryVersion`; duplicates and older versions are successful no-ops. `lastEventId` records the latest applied event. An event arriving before catalog bootstrap creates an inventory-only document with `catalogReady=false`. Bootstrap later fills catalog metadata without overwriting newer inventory; incomplete documents are excluded from API search.

Automatic offset commits and automatic batch resolution are disabled. Each record's next offset is manually committed only after its OpenSearch update/no-op succeeds, using integer-safe offset arithmetic. A crash between the OpenSearch update and Kafka commit leads to replay and an idempotent version check. Transient connection failures, timeouts, conflicts, throttling, and server errors retry with exponential backoff from 1 to 30 seconds; heartbeats continue during backoff. SIGINT/SIGTERM stops new work, interrupts backoff, and disconnects cleanly; an interrupted/unprocessed record stays uncommitted. Requests have five-second timeouts with two client retries; the Kafka session timeout is 60 seconds.

There is **no automatic dead-letter queue or skip policy**. Malformed records, unsupported schema/key, authorization errors, and permanent mapping/index errors stop the worker with sanitized partition/offset or failure-category logs. Previously processed records stay committed; the failing record is not acknowledged. Investigate/fix the producer, permissions, mappings, or payload at that offset, then restart the same group. Any manual offset skip must be a deliberate operator decision with a separate recovery plan. Startup connection failures also exit nonzero for a process supervisor to restart.

With `OPENSEARCH_URL` configured, `GET /api/products` uses fuzzy `multi_match` search on name/description (`AUTO` fuzziness), exact city/category filters, and inclusive INR price ranges. A scroll cursor retrieves the whole filtered catalog so the shared unpaginated `{products,total}` contract remains intact. Run bootstrap before enabling search: a healthy empty index returns empty results. If OpenSearch fails (including a missing index), the API logs a sanitized warning and falls back to PostgreSQL substring matching; that fallback does not offer typo tolerance. Product details and checkout always use PostgreSQL. Search discovery metadata can lag; returned stock/prices are hydrated from PostgreSQL in a consistent read snapshot, and checkout checks current PostgreSQL availability and prices. A PostgreSQL availability failure returns 503 instead of projection stock.

Verification commands:

```sh
npm test
RUN_DB_TESTS=1 npm run test:integration
RUN_KAFKA_TESTS=1 npm run test:kafka
RUN_SEARCH_TESTS=1 npm run test:search
RUN_PIPELINE_TESTS=1 npm run test:pipeline
```

Unit tests cover queries, fallback, TLS configuration, retries, offset handling, and shutdown. PostgreSQL integration tests cover real catalog reads using a projection double. The live search suite tests actual OpenSearch mappings, fuzzy HTTP queries, duplicate/old events, and stale-bootstrap protection. The live pipeline suite creates a temporary PostgreSQL schema, OpenSearch index, and Kafka group, performs real reservation creation, release, expiry and checkout, publishes committed schema-2 events, and asserts projected physical/reserved/available stock, stale-version rejection and committed offsets. It deletes only its own test index/schema; Kafka probe events/group metadata remain subject to normal retention. Probe product IDs start with `test_` and must not be treated as real demo catalog entries. Live suites skip unless explicitly enabled and fail if enabled with unavailable services.

Latest local verification: four live OpenSearch checks passed. Schema-2 events for reserve/release/re-reserve/expiry/checkout passed through Aiven Kafka into the projection at versions 2–6 with availability 0/1/0/1/0. Final checkout event `0c40361b-24ec-48e3-8672-fb275460e287` reached version 6/stock 0 and its consumer offset was committed after successful projection. These checks used isolated schemas/indexes/groups; PostgreSQL integration separately verified an actual 30-second hold with cleanup stopped.

## API integration

The shared contract in `../contracts/api.md` remains unchanged.

- `GET /api/health` returns exactly `{"status":"ok"}`. This is a liveness endpoint; startup separately checks connectivity.
- `GET /api/products?city=pune` returns `{products,total}`. Supports optional `q`, `category`, `minPrice`, and `maxPrice`.
- `GET /api/products/:id?city=pune` returns the same product shape, or standard-format 404.
- `POST /api/orders` creates a confirmed order (HTTP 201) or returns the standard error envelope, including HTTP 409 for unavailable stock.
- `GET /api/orders/:id` returns persisted order details or standard-format HTTP 404.
- `GET /api/orders/:id/tracking` adds read-only tracking for a single order, documented in the backend integration specification.

City is required and accepts only `pune`, `delhi`, or `bengaluru`. Categories are matched exactly (seed uses `electronics`, `apparel`, `groceries`). Configured OpenSearch provides typo-tolerant name/description search; the PostgreSQL fallback provides case-insensitive literal substrings. Price bounds are inclusive, nonnegative INR values; inverted bounds return 400. Queries reject unknown keys, repeated scalar parameters, and excessively long text. Unknown categories and searches return empty results. Products remain visible even when selected-city stock is zero (`stock:0`, `available:false`). The catalog is unpaginated; `total` is the filtered product count.

Set frontend `VITE_API_BASE_URL` to the backend `/api` URL and `FRONTEND_ORIGIN` to the frontend origin. Seed image URLs follow the contract's `/images/...` convention; the frontend must supply those assets. This backend does not serve image files.

## Inventory Command Center

The backend implements the four read-only schemas in shared contract section 9: `GET /api/admin/overview`, `/api/admin/inventory`, `/api/admin/orders`, and `/api/admin/events`. No admin mutation routes, login/token-issuance endpoints, or unrestricted storefront order list are added. Start with `npm run build` and `npm start` after configuring the server-side environment. No new migration is required.

**Default: admin data is disabled.** With `ADMIN_AUTH_MODE` absent/`disabled`, or an incomplete/unsafe configuration, all four routes return standard-format HTTP 503 `ADMIN_DISABLED`. The storefront, checkout, tracking, outbox publisher, consumer, and search continue using their existing paths. Missing production identity-provider settings do not silently select a demonstration mode.

| Variable | Purpose |
| --- | --- |
| `ADMIN_AUTH_MODE` | `disabled` (default), `jwt`, or explicitly opted-in `local-demo`. |
| `ADMIN_CURSOR_SECRET` | Required in enabled modes: at least 32 cryptographically random bytes encoded as unpadded base64url. Keep it server-side, use the same value across API instances, and rotate it to invalidate outstanding cursors. See `.env.example` for a local generation command. |
| `ADMIN_JWT_ISSUER` | Required in JWT mode: exact HTTPS issuer from the existing trusted identity provider. |
| `ADMIN_JWT_AUDIENCE` | Required expected access-token audience. |
| `ADMIN_JWT_JWKS_URL` | Required HTTPS URL of the provider's trusted public verification keys; never supplied by a request or JWT header. |
| `ADMIN_JWT_ALGORITHMS` | Explicit allowlist: `RS256` (default), `ES256`, or both comma-separated. Symmetric algorithms and unsigned tokens are rejected. |
| `ADMIN_HTTPS_PROXY_IPS` | Optional comma-separated exact socket-peer IPs of a trusted HTTPS reverse proxy, such as `127.0.0.1`. No wildcards or client-provided forwarding chains are trusted. |

In deployed JWT mode, send the short-lived access token in `Authorization: Bearer <token>` over HTTPS. The backend uses `jose` to validate the signature, algorithm, issuer, audience, required expiration and any `nbf` claim, then requires a signed `roles` array containing `inventory_admin`. Tokens must have no more than 15 minutes remaining; when `iat` is present, their original lifetime must also be at most 15 minutes and the issue time cannot be in the future. The contract does not require `iat`/`sub`; subject-less credentials have their cursors bound to the exact signed token instead. Missing/invalid tokens return 401 with `WWW-Authenticate: Bearer`; valid identities without the role return 403. Raw tokens, claims, credentials and JWT/client errors are never logged or reflected in responses.

The application currently serves HTTP behind the deployment's TLS terminator. JWT admin requests must arrive on a TLS socket or from an explicitly trusted `ADMIN_HTTPS_PROXY_IPS` peer with a single `X-Forwarded-Proto: https` value. Configure the proxy to overwrite that header and restrict direct backend access. A spoofed header from another IP is rejected. A public production frontend origin must be HTTPS; only loopback development can use HTTP. Requests with an Origin header must match `FRONTEND_ORIGIN`. CORS, path names and caller-supplied role headers do not grant access. All admin responses use `Cache-Control: no-store`. Never put admin tokens, cursor secrets, Aiven credentials or signing secrets in `VITE_*`, client bundles, URLs or browser persistent storage.

If no trusted identity provider is available, the contract permits only an explicitly enabled **local demonstration**. Set these values in the ignored `backend/.env`, alongside a generated `ADMIN_CURSOR_SECRET`:

```dotenv
ADMIN_AUTH_MODE=local-demo
HOST=127.0.0.1
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
```

IPv6 `HOST=::1` is also supported. Public/wildcard bindings, non-loopback frontend origins, and production mode disable this configuration. Every request must have a real loopback socket peer and loopback Host; a provided browser Origin must exactly match the configured loopback frontend origin. Forwarded headers are rejected in demo mode. Do not expose it through tunnels, reverse proxies, LAN interfaces or the Internet. It is not admin authentication and must not be used for shared hosting.

See [the local presentation runbook](docs/local-admin-demo.md) for exact backend/browser startup commands, safe credential handling, endpoint checks, second-laptop limitations and the existing JWT alternative. Local-demo activation does not require an authentication code change.

All authorized reads use one checked-out PostgreSQL client in a `REPEATABLE READ READ ONLY` transaction per response. `asOf` comes from the database. Overview uses the fixed 1–5 low-stock range and an explicit `Asia/Kolkata` local-midnight window, independent of the PostgreSQL session timezone. Inventory counts/listing include only existing inventory rows. Orders return persisted status and INR totals. Events expose explicit stored associations only; current checkout events have `orderId:null`. A pending outbox marker does not prove Kafka never received the message, and a published marker does not imply consumer/OpenSearch completion. The endpoints never contact Kafka/OpenSearch or fabricate delivery/indexing state.

Lists default to 50 records, accept limits 1–100, reject unknown/repeated/invalid filters, and use HMAC-protected 15-minute keyset cursors. Cursors bind the endpoint, filters, limit and verified authorization scope; timestamp keys preserve PostgreSQL microseconds. A changed filter/limit/scope, invalid signature, expiry, or incompatible cursor returns 400 `INVALID_CURSOR`. Separate pages are live snapshots. PostgreSQL connection/availability errors return 503 `DATABASE_UNAVAILABLE`; unexpected query failures return sanitized HTTP 500. Empty results retain the contract's HTTP 200 array/page shape.

Verification: `npm test` covers real signed JWTs with generated test keys, rejection paths, deployment gates, cursors and validation. `RUN_DB_TESTS=1 npm run test:integration` exercises the authenticated routes against isolated Aiven PostgreSQL schemas, including timezone bounds, stock classes, filters, microsecond/tied-key pagination, event states, empty results, failures and unchanged operational data. It also runs the existing checkout races. No test grants public access or modifies demo inventory.

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

Integration tests create random isolated schemas in the configured database and drop only those schemas afterward; the test role needs CREATE privileges. They never truncate/reset demo tables. Test files run sequentially to stay within small Aiven connection limits; each last-unit race still launches concurrent requests with `Promise.all`. The foundation suite applies actual migrations twice, seeds twice, exercises real SQL search/category/price/city filtering through HTTP, tests constraints, and verifies reseeding preserves changed stock/version.

The checkout suite uses dedicated generated products and checks single/multi-item success, insufficient stock, strict quantity validation, duplicate IDs, decimal server-side totals, order retrieval, city availability, complete rollback when a later item fails, late database write failure, and event payloads. Ten independent last-unit races each launch two checkout requests with `Promise.all` and assert exactly one 201, one 409, stock zero, one confirmed order, and one committed event. A reversed multi-item cart race checks deterministic ordering. These concurrency assertions run against real PostgreSQL, never a mocked database. Use a dedicated test database where possible. An enabled suite fails on unavailable credentials/TLS/database errors instead of skipping. Default test output and integration output must be reported separately.

Tracking integration tests also exercise the migration against pre-existing orders, known/unknown timestamp semantics, chronological reads, disabled status changes, and rollback on history write failure. Last-unit races assert exactly one persisted confirmation-history record as well as one order/event.

Next task: integrate the frontend C7 reservation flow and perform the documented coordinated worker/API rollout. Production admin access still requires a trusted identity provider; local-demo restrictions are unchanged. Fulfillment mutations remain disabled until a separate authorized workflow is defined.
