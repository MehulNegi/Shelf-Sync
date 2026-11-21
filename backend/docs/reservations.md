# Timed cart reservations

Implements shared contract section 10 under `backend/` only. Cart routes are disabled by default. PostgreSQL owns prices, physical stock, holds, expiry and checkout. The existing frontend must separately integrate C7: an older Add to Cart action still changes only its local cart.

## Commands

From `backend/` with the existing verified Aiven PostgreSQL environment:

```sh
npm run migrate
npm run build
npm start
```

Run workers as separate processes:

```sh
npm run worker:outbox
npm run worker:inventory
npm run worker:reservations
```

`npm run index:products` bootstraps catalog and live availability. It can reconcile expired holds and insert outbox events, and releases PostgreSQL locks before OpenSearch I/O. No reset, truncate or seed is needed.

## Environment and secure activation

| Variable | Meaning |
| --- | --- |
| `RESERVATIONS_ENABLED` | Exact true/false, default false. Cart routes/reserved checkout return 503 while off. Legacy checkout still respects existing live holds. |
| `RESERVATION_TTL_SECONDS` | Integer 5–300, default 30. Changes affect new holds only. |
| `RESERVATION_RATE_LIMIT_SECRET` | Required when enabled: dedicated server-only secret, at least 32 random bytes encoded as unpadded base64url. HMACs rate-limit source IPs. |
| `RESERVATION_ALLOW_LOCAL_HTTP` | Default false. Explicit non-production loopback-only cookie exception; never for LAN/shared/hosted deployments. |
| `RESERVATION_HTTPS_PROXY_IPS` | Optional comma-separated exact TLS proxy socket IPs. Proxy must overwrite forwarding headers; restrict direct API access. |
| `INVENTORY_V1_CUTOFF_AT` | Required to enable: fixed ISO 8601 UTC rollout timestamp ending in Z, shared by API/publisher/consumer. Version-1 events at/after it are rejected, left pending/uncommitted; older events remain supported. |

Generate the secret privately without printing it:

```sh
export RESERVATION_RATE_LIMIT_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
```

Never use shell tracing, commit credentials/certificates, or put ownership/admin credentials in Vite variables, URLs or local storage. HTTPS mode uses a host-only Secure, HttpOnly, SameSite=Strict `__Host-shelfsync_cart` cookie. Use same-origin or explicitly same-site HTTPS frontend/API origins, exact Origin checks and credentialed CORS. Arbitrary forwarded headers cannot attest TLS.

For a same-laptop HTTP presentation, after rollout set `HOST=127.0.0.1`, `NODE_ENV=development`, `FRONTEND_ORIGIN=http://127.0.0.1:5173`, `RESERVATION_ALLOW_LOCAL_HTTP=true`, `RESERVATION_TTL_SECONDS=30`, and `RESERVATIONS_ENABLED=true`. Set the secret and fixed cutoff above server-side. Browser/API must use the same hostname. The separate HttpOnly dev cookie requires a real loopback peer/Host, exact loopback Origin and no forwarding headers. Do not tunnel/proxy this exception. Cart cookies grant no admin access; existing default-off/JWT/local-demo admin restrictions remain unchanged.

## Safe rollout

1. Stop old API/stock writers and drain their committed outbox records. Never clear queues/offsets to make rollout pass.
2. Apply additive migration `003_cart_reservations.sql`: sessions, reservations, idempotency, rate counters, indexes and reservation immutability guard. Existing inventory/orders/history/outbox are preserved.
3. Deploy upgraded publisher/consumer and explicit OpenSearch mappings before holds are enabled. All new backend stock writers emit schema 2, including legacy checkout while cart access is disabled. Never run an old direct-decrement writer alongside live holds.
4. Persist one actual UTC `INVENTORY_V1_CUTOFF_AT` after old writers are stopped/drained, shared across every process/restart. Run `npm run index:products` with the guarded live-availability bootstrap.
5. Start all workers, configure secure cookie transport/rate secret, verify isolated live checks, integrate the reservation-aware frontend, then enable the flag. Setting the TTL alone does not implement an Add to Cart flow.

Disabling the flag stops cart access but does not free existing holds early: legacy checkout excludes them until their deadlines. Leave reconciliation/publishing running. Do not roll back to an old allocator while holds can exist or drop tables/refund orders as rollback.

## API and correctness

- `POST /api/cart/session` with `{}` issues/reuses a fixed 24-hour anonymous session. Only a credential digest is stored. `POST /api/cart/reservations`, `GET /api/cart/reservations?city=...`, `PATCH /api/cart/reservations` and `POST /api/cart/reservations/release` follow the exact shared JSON/errors.
- Cookie-authorized mutations require exact Origin, JSON and (except session issuance) UUID `Idempotency-Key`. Frontend calls need `credentials:'include'`. Reuse a key for uncertain retries, use a new one only for a new explicit action. GET/session reuse never renews a deadline.
- Allocation locks the owner session, then product-city inventory rows in binary order. Database decision time is sampled after lock waits. Expiry workers take inventory locks first and never acquire session locks. Conditional physical decrements and nonnegative constraints remain.
- Physical stock never decreases on reserve or increases on release/expiry. Available stock subtracts only holds live at database observation time, even with cleanup stopped. Public product APIs hydrate OpenSearch IDs with PostgreSQL prices/live stock in bounded batches and one read snapshot. Admin metrics remain physical.
- Reserved checkout adds `reservationIds` to existing city/items, validates exact owned live coverage, and consumes holds atomically with physical deduction, confirmed order/items/history and outbox. Legacy checkout buys only unheld units. Neither trusts frontend prices or OpenSearch stock.
- Quantity changes retain the original deadline. Same-session product-city reacquisition waits until five seconds after the original deadline, even after early release. City switching requires release of old-city holds. Expired desired items remain in the frontend cart with `requiresReservation:true`; the backend does not delete local cart intent.
- Shared PostgreSQL counters enforce 20 session issuances/IP/hour, 20 creates/session/minute, 60 creates/IP/minute, 60 PATCHes/session/minute, plus a separate 1,200 cart requests/IP/minute ceiling. Release/valid checkout do not share create/PATCH quotas. Source IPs are HMAC digests; proxy trust is explicit.
- Successful and deterministic business-409 outcomes persist with idempotency evidence. A rejected operation rolls back its savepoint before saving only its safe error result. Auth/schema/rate/ownership/5xx failures are not cached. Expired/lost credentials cannot replay an order: do not automatically retry an uncertain purchase under a new session.

## Events, expiry and recovery

Schema-2 `inventory.changed` retains physical `quantity`, adds reserved/available quantities, nullable next expiry and causes. One changed product-city gets one new inventory version and committed full snapshot; combined expiry/action causes share it. Topic/key remain `inventory-events` and `productId:city`. The publisher records publication only after Kafka ACK. The consumer updates only greater versions and commits offsets after successful projection. Duplicates/stale snapshots cannot overwrite current availability; outbox publication does not prove consumer completion.

Expiry polls no faster than once per second, locks at most 100 due keys with SKIP LOCKED, rechecks database time, writes snapshots transactionally, and backs off on failure. Retention/pruning is bounded, preserves consumed reservations with orders and keeps other terminal/idempotency evidence through session expiry plus 24 hours. SIGINT/SIGTERM drain the active transaction and close the pool. Worker failure delays projection updates, not PostgreSQL availability.

```sh
npm run build
npm test
RUN_DB_TESTS=1 npm run test:integration
RUN_SEARCH_TESTS=1 npm run test:search
RUN_PIPELINE_TESTS=1 npm run test:pipeline
```

Tests use isolated random schemas/indexes, never reset/reseed demo data. PostgreSQL tests include a real 30-second expiry with cleanup stopped, competing sessions, legacy/hold races, rollback, quantities/cities, ownership, shared quotas, replay and existing checkout/tracking/admin regressions. The live pipeline test uses real Kafka/OpenSearch and tests schema-2 creation, release, expiry (configured five seconds for that live test), checkout, publication markers, stale-version rejection and offsets. Report actual run results separately; mocks are not live verification.
