# Render deployment readiness (B10)

This is an operator runbook, not a deployment or shared-database change. Work remains on `feature/backend`. No migrations, seed, catalog bootstrap, Aiven changes or provider configuration run automatically. Existing reservation allocation, event schemas, search mappings, financial feature gates and checkout transactions are preserved.

## Security gates before public reservations

**Do not recommend the complete public storefront/reservation flow until both ingress blockers below have been resolved and tested in a real browser.** Backend injection/PostgreSQL tests do not verify a live proxy or browser cookie delivery.

1. The current frontend `https://shelf-sync-tau.vercel.app` and an API at `https://<service>.onrender.com` are cross-site. C7 requires a host-only `__Host-shelfsync_cart` cookie with `Secure; HttpOnly; SameSite=Strict; Path=/` and no Domain. Direct credentialed Fetch across those sites cannot carry the required reservation session. CORS cannot change that. Do not change to `SameSite=None`, expose a session token to JavaScript, or use local HTTP mode. [Browser cookie rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
2. Render terminates HTTPS before forwarding HTTP to Node. Existing cart security accepts that only from explicitly configured, trusted socket peer IPs with `X-Forwarded-Proto: https`. The actual ingress peer addresses, their stability, their isolation from untrusted callers and header-overwrite behavior have **not** been established here. Do not copy outbound ranges into `RESERVATION_HTTPS_PROXY_IPS`, trust every private IP, set `trustProxy: true`, or accept a header merely because `RENDER=true`. Until validated, leave reservations off or keep the service out of public use. Render's own proxy example cautions that private ranges are illustrative, not a verified ingress allowlist. [Render networking](https://render.com/docs/web-services), [proxy trust considerations](https://render.com/articles/how-to-proxy-analytics-through-your-own-domain).

The supported initial Render browser topology is a **same-origin HTTPS `/api` proxy on the frontend hostname**. The frontend owner must configure and verify an external rewrite before its SPA catch-all: `/api/:path*` → `https://<service>.onrender.com/api/:path*`. Vercel supports external rewrites, but this repository change does not configure one. The browser calls `/api/...`, retaining the frontend hostname; the upstream Render URL stays server-side routing configuration. Verify that the proxy preserves Origin, Cookie, Set-Cookie, JSON, UUID Idempotency-Key, response status, and no-store headers; it must not cache session/checkout responses or rewrite Origin to impersonate a trusted browser. [Vercel rewrites](https://vercel.com/docs/routing/rewrites).

An alternative architectural option is shared-site HTTPS custom domains for frontend/API, which C7 permits with credentialed Fetch. That topology needs a separately reviewed configuration: this initial Render guard deliberately requires the simpler exact same-origin browser API. An environment declaration does not configure or prove a proxy.

Inspect the actual TLS ingress in a restricted staging environment without logging headers, cookies or credentials. Confirm trusted proxy peers cannot be impersonated by public/internal callers. Confirm source-IP handling: the existing limiter accepts only a single overwritten valid IP from a trusted peer; a forwarded chain falls back to the socket peer, sharing that peer's admission quota across users. If the platform cannot supply trustworthy stable peers and a sanitized client IP, a reviewed ingress adapter is a blocker, not permission to broaden trust.

## Admin and ProfitOS

Render automatically provides `RENDER=true`. Every continuously running entry point validates the production profile. `NODE_ENV=production` is required. Admin must be `ADMIN_AUTH_MODE=disabled`; profitability flags and local HTTP must be false/unset. Misconfiguration fails startup rather than exposing local-demo data. All four monitoring routes and all profitability/cost routes return 503 `ADMIN_DISABLED`. A cart session conveys no admin privileges. [Render environment marker](https://render.com/docs/environment-variables).

The existing JWT implementation verifies trusted JWKS signatures, algorithms, issuer, audience, expiration/not-before, short lifetimes and signed `inventory_admin` roles over verified HTTPS. No trusted identity provider/login flow has been configured or verified for this deployment. B10 therefore **disables public admin**, rather than adding credentials or a new login system. Enabling it later requires an explicit review/change to the Render guard, IdP setup, trusted ingress, and frontend runtime-token integration. Never reuse Aiven credentials, ship tokens/secrets in `VITE_*`, or expose local-demo via LAN/tunnels/proxies. B8 must remain off independently of any future admin enablement.

## Four service configurations

Prepare four separate Node services using the same reviewed commit of `MehulNegi/Shelf-Sync`, branch `feature/backend`, root directory **`backend`**, one instance each initially, no disk, and a region chosen near the existing Aiven services. Do not create new PostgreSQL/Kafka/OpenSearch resources. Choose continuously running compute suitable for the demo/production budget; Free web services sleep after inactivity, making them unsuitable for predictable checkout latency. Workers are Background Workers, not web services or cron jobs. [Background workers](https://render.com/docs/background-workers), [Free limitations](https://render.com/docs/free).

Set **Auto-Deploy: Off** for all four. Creating a Render service itself initiates a deployment, so only do so after operator approval and the prerequisites below. This commit uses `[skip render]` to avoid triggering an existing Git-linked Render auto-deploy; that is not a substitute for disabling auto-deploy in service settings. [Deployment controls](https://render.com/docs/deploys).

Build command for each service (no pre-deploy command):

```sh
npm ci --include=dev && npm run build && npm prune --omit=dev
```

Use direct Node start commands so Node receives termination signals. Existing npm aliases remain available for manual operation after building:

| Service | Render type | Start command | npm alias | DB pool max | HTTP health path |
| --- | --- | --- | --- | --- | --- |
| API | Web Service | `node dist/src/server.js` | `npm start` | `3` | `/api/ready` |
| Outbox | Background Worker | `node dist/workers/outbox-publisher.js` | `npm run worker:outbox` | `1` | none |
| Inventory projection | Background Worker | `node dist/workers/inventory-consumer.js` | `npm run worker:inventory` | no PG connection | none |
| Reservation expiry | Background Worker | `node dist/workers/reservation-expiry.js` | `npm run worker:reservations` | `1` | none |

Do not use `dev`, `dev:all`, `concurrently`, an HTTP keepalive workaround or a cron interval to host these processes. Separate services keep worker failures/restarts independent of the API. Background workers do not receive HTTP health checks. [Render health behavior](https://render.com/docs/health-checks).

## Environment matrix

Use protected Render environment settings/groups and Secret Files; do not upload a development `.env` wholesale. Set service-specific pool/client IDs explicitly. No credential belongs in this document or Git. Pin `NODE_VERSION=24.22.1` for this configuration (currently documented Render Node default); verify build/tests on that runtime before deployment and update through reviewed patch changes. The repository supports Node >=22; unbounded engines alone do not pin a production runtime. [Node version selection](https://render.com/docs/node-version).

| Variable | Services | Required setting |
| --- | --- | --- |
| `NODE_ENV` | all | `production` |
| `NODE_VERSION` | all/build | `24.22.1` |
| `ADMIN_AUTH_MODE` | all | `disabled` |
| `PROFITABILITY_ENABLED` | all | `false` |
| `PROFITABILITY_DEMO_WRITES_ENABLED` | all | `false` |
| `RESERVATION_ALLOW_LOCAL_HTTP` | all | `false` |
| `INVENTORY_V1_CUTOFF_AT` | all | **Existing fixed rollout UTC timestamp**, identical to current services; never reset to deployment time |
| `DATABASE_URL` | API, outbox, expiry | Existing Aiven PostgreSQL URL, server-side secret, no insecure TLS URL options |
| `DATABASE_CA_CERT_PATH` | API, outbox, expiry | `/etc/secrets/postgres-ca.pem` if Aiven project/private CA is required |
| `DATABASE_POOL_MAX` | API/outbox/expiry | `3` / `1` / `1`; allowed 1–10, default 5 |
| `HOST` | API | `0.0.0.0` |
| `PORT` | API | Let Render supply it (normally `10000`); numeric 1–65535 |
| `FRONTEND_ORIGIN` | API | `https://shelf-sync-tau.vercel.app`, exact, no slash/wildcard/preview-origin list |
| `RESERVATIONS_ENABLED` | API | `false` for initial verification; `true` only after secure routing is verified and frontend is coordinated |
| `RESERVATION_TTL_SECONDS` | API | `30`; no change to existing held deadlines |
| `RESERVATION_RATE_LIMIT_SECRET` | API | Existing/dedicated >=32 random bytes, canonical unpadded base64url; persist across restarts/instances |
| `RESERVATION_BROWSER_API_ORIGIN` | API with reservations | `https://shelf-sync-tau.vercel.app` only after verified same-origin `/api` routing |
| `RESERVATION_HTTPS_PROXY_IPS` | API with reservations | Verified explicit TLS proxy socket IPs, comma-separated; no guessed ranges |
| `KAFKA_BROKERS` | outbox, projection | Existing Quick Connect `host:port` list, correct TLS/auth port |
| `KAFKA_AUTH_MODE` | outbox, projection | Existing `sasl` or `mtls` service configuration |
| `KAFKA_CLIENT_ID` | outbox, projection | Distinct operational names, e.g. `shelfsync-render-outbox` / `shelfsync-render-projection` |
| `KAFKA_CA_CERT_PATH` | outbox, projection | `/etc/secrets/kafka-ca.pem` for private CA (required for mTLS) |
| `KAFKA_SASL_MECHANISM` | SASL workers | Existing `plain`, `scram-sha-256` or `scram-sha-512` |
| `KAFKA_USERNAME`, `KAFKA_PASSWORD` | SASL workers | Existing protected service credentials |
| `KAFKA_CLIENT_CERT_PATH`, `KAFKA_CLIENT_KEY_PATH` | mTLS workers | `/etc/secrets/kafka-service.cert`, `/etc/secrets/kafka-service.key` |
| `KAFKA_CONSUMER_GROUP_ID` | projection | Existing `shelfsync-inventory-projection-v1`, or the actual currently deployed group; do not change to skip backlog |
| `OPENSEARCH_URL` | API, projection | Existing HTTPS Aiven origin without embedded credentials/path |
| `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD` | API, projection | Protected service credentials |
| `OPENSEARCH_INDEX` | API, projection | Existing `shelfsync-products-v1`, or actual current index; same value everywhere |
| `OPENSEARCH_CA_CERT_PATH` | API, projection | `/etc/secrets/opensearch-ca.pem` when a private CA is required |

The projection worker needs no PostgreSQL URL and the API/expiry worker need no Kafka credentials. The API may omit OpenSearch configuration to use PostgreSQL substring search; configured search failures already fall back to PostgreSQL. This does not provide typo tolerance during a search outage. Details, live reservability and checkout remain PostgreSQL-authoritative.

Leave bounded worker defaults unless measured needs justify changing them: `KAFKA_REQUEST_TIMEOUT_MS=10000`, `OUTBOX_BATCH_SIZE=25`, `OUTBOX_POLL_INTERVAL_MS=1000`, `OUTBOX_RETRY_INITIAL_MS=1000`, `OUTBOX_RETRY_MAX_MS=30000`. See `.env.example` and config validation for ranges.

Budget Aiven connections across all machines, instances and old/new deployment overlap. With the suggested pools, one set uses at most 5 and two sets at most 10, before local clients, migration operators and other applications. Confirm actual service/user limits and reserve operational headroom; adding instances multiplies the budget. Do not fix exhaustion by raising Aiven limits automatically.

## Aiven TLS and network configuration

Download the current project/service CA and, for Kafka mTLS, client certificate/key through existing Aiven Quick Connect. Upload their unmodified PEM contents as Render Secret Files using the filenames above, to **each service that needs them** (or a narrowly scoped environment group). Absolute `/etc/secrets/...` paths avoid build/root-directory ambiguity. Rotate credentials/certificates under operator control; never commit or print them. Secret-file/settings changes can deploy a service, so stage them only as part of the approved rollout. [Render secrets](https://render.com/docs/configure-environment-variables).

All clients keep certificate and hostname verification on. For PostgreSQL, `sslmode=require`/`verify-full` in the URL is normalized to explicit verified TLS; other SSL URL options are rejected. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized:false`, or use an IP instead of the certificate's service hostname. A CA file is a trust anchor, not the server certificate/private key. If the Aiven server chain is publicly trusted by Node, the optional CA path can be omitted; never omit a required private CA just to suppress an error.

Review Aiven firewall/ACL permissions and Render outbound connectivity for PostgreSQL, the selected Kafka listener and OpenSearch. Obtain actual outbound ranges from each Render service's Connect → Outbound view and have the operator approve any necessary allowlist adjustment. These ranges are for **Aiven egress allowlisting**, not trusted inbound HTTP proxy identities. No infrastructure adjustments are made by this task. [Render outbound addresses](https://render.com/docs/outbound-ip-addresses).

Use existing scoped runtime users, separate from migration ownership where supported: API needs commerce read/write, outbox needs pending-row locking/publication marking and Kafka publish, expiry needs reservation reconciliation/retention writes, projection needs Kafka consume/group and OpenSearch index updates. Confirm existing explicit mappings/bootstrap are already present; don't grant broader rights or run bootstrap automatically to hide setup failures.

## Health, shutdown and restart

`GET /api/health` stays exactly `200 {"status":"ok"}`. It is process liveness only. The additive **operational** `GET /api/ready` returns `200 {"status":"ready"}` only after a PostgreSQL probe against the required reservation table; it returns `503 {"success":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"Service is not ready"}}` on dependency failure or draining, with `Cache-Control: no-store`. Responses have a two-second deadline, probes coalesce while one is outstanding, and late connections are released. It checks neither every table/permission nor Kafka ACKs, index health or complete projection synchronization. The deployment checklist must cover those independently.

Set Render's API HTTP health path to `/api/ready`; Render expects a successful response within five seconds and uses failures to gate traffic/restart instances. Startup verifies database access and required existing cart schema before listening; no background migration runs. API listens on Render PORT/0.0.0.0; local defaults remain port 3000 and the existing local origin. Render handles edge TLS/HTTP-to-HTTPS redirection; internal plaintext is never taken as proof of an HTTPS cart request. [Render networking](https://render.com/docs/web-services), [health checks](https://render.com/docs/health-checks).

SIGINT/SIGTERM start one shutdown, abort worker polling/retry sleeps, drain current requests/tasks and close clients/pools. The API stops accepting traffic, reports unready while draining and closes idle keepalive connections. Cleanup has a 25-second deadline; a hung shutdown exits nonzero before Render's default 30-second kill deadline. Keep platform shutdown allowance at least 30 seconds. A forced exit can roll back an in-flight transaction or replay an acknowledged Kafka record: it must never advance an unconfirmed outbox marker/consumer offset. PostgreSQL transactions, at-least-once publishing and version guards are unchanged. [Render shutdown](https://render.com/docs/deploys).

Configure operational restart/alerting for exited services. Fatal setup errors exit nonzero with sanitized instructions; don't loop migrations on restart. Outbox and expiry workers remain alive on transient dependency failures with bounded backoff. Projection retries transient OpenSearch failures, but invalid events/permanent mapping or authorization failures stop it without skipping the failed offset. Repeated crashes require operator repair, not offset resets or fake acknowledgments. Background workers have no HTTP readiness endpoint: monitor process exit/restart, `publisher_retry`/`poll_completed`/`outbox_published`, `consumer_started`/`inventory_projected`/`consumer_blocked`, expiry retry logs, pending outbox age and consumer lag. An outbox publication timestamp proves Kafka ACK only, not indexing completion. Never dump HTTP headers, credentials, cookie digests, raw driver errors or full payloads into diagnostics.

## Manual rollout and verification checklist

1. Record the reviewed commit, previous compatible release, current env/secret references, cutoff, consumer group, topic, index and connection budget privately. Back up using the existing operator process. Keep auto-deploy off. Stop/drain competing **old allocators**; a local API writing the same inventory must be reservation-aware and on the same cutoff.
2. Review migration status read-only. The current API requires existing migrations 001–003 and compatible schema-2 projection mappings. B10 adds **no migration**. If any prerequisite is missing, stop for a separately approved migration plan. Do not execute `npm run migrate`, `npm run seed`, reset SQL, or `index:products` in build/start/pre-deploy commands. Migration 004 is not required to enable B10 and B8 remains disabled.
3. Resolve same-origin routing and verified TLS ingress/client-IP handling in restricted staging; provision env/secret files and Aiven access only with approval. Keep reservation access off until verified. Existing active holds still reduce availability by database time even while cart routes are disabled. Do not present this transitional state as a fully working reservation demo.
4. Run `npm ci --include=dev`, `npm run build`, `npm test`. Against a dedicated test database or explicitly isolated random schemas, run `RUN_DB_TESTS=1 npm run test:integration`. Tests create/drop only their own schemas; do not use a schema search path pointing at shared commerce records. Never run seed/reset or live pipeline checks against real stock to validate a deployment.
5. Deploy the approved worker/API commit manually. Check API `/api/ready` and exact `/api/health`; check all four admin and profitability routes return `ADMIN_DISABLED`, including with arbitrary Bearer tokens/role headers. Inspect sanitized logs for verified dependency setup; check worker subscription/progress. Avoid repeatedly restarting healthy workers during a shared dependency outage.
6. Have the frontend owner call same-origin `/api`, with `credentials:'include'`, exact Origin/JSON and stable UUID idempotency keys. In an isolated fixture flow, verify session cookie attributes/storage, foreign-origin and forged-forwarding rejection, add/reserve, unchanged expiry after reload, release, expiry at 30 seconds and reserved checkout/retry. Verify another browser cannot reserve/buy the held last unit. Confirm public products and order tracking remain contract-compatible. Never export cookies into logs or shell commands.
7. Before enabling public Add to Cart, verify browser behavior on the actual Vercel hostname and Render ingress, CORS preflights and no caching. Verify Kafka topic `inventory-events`, deterministic `productId:city` keys, post-ACK marking, stable consumer group and greater-version projection using isolated permitted fixtures. These **live Render/Kafka/OpenSearch checks were not performed by B10**. Do not claim end-to-end deployment verification from unit tests.

## Rollback

1. Stop further releases; disable auto-deploy and public cart access if necessary, retain expiry/publishing where healthy, and preserve the current cutoff and secrets. Do not free holds manually or fabricate replacement orders after an uncertain checkout. Clients retry with the existing session/key rather than issuing new purchases.
2. Roll API/workers back only to a reviewed **reservation-aware schema-2** release, with the B10 public admin/financial protections or equivalent explicit disablement. A pre-reservation writer is unsafe even if cart access is off. Avoid mixed incompatible writers. Do not drop tables, reverse migrations, restore stale inventory, purge outbox rows, reset Kafka offsets or reseed.
3. Render can reuse previous build artifacts, but rollback configuration can also revert environment values and start/health settings; environment-group behavior differs. Review the actual resulting runtime configuration against this runbook before restoring traffic. Never restore local-demo, finance flags, an obsolete CA, a new cutoff, or unsafe proxy settings accidentally. [Render rollback semantics](https://render.com/docs/rollbacks).
4. Recheck PostgreSQL readiness, disabled admin/finance, browser cookie/session and idempotency continuity, worker replay/backlog and projection versions. Reenable traffic only after security/correctness checks pass. Historical orders and current hold deadlines remain persisted; a service restart does not renew them.

## B10 verification record

- `npm run build` and `npm test`: passed on local Node 26.13.1; **83 unit tests**, zero failures/skips.
- `RUN_DB_TESTS=1 npm run test:integration`: **71 passed**, zero failures/skips. All mutations/migrations were confined to isolated random test schemas, cleaned up afterward; shared commerce data and migration history were untouched.
- Pinned **Node 24.22.1**: TypeScript build and all **83 compiled unit tests** passed. Compiled deployment/checkout/reservation integration tests: **26 passed**, zero failures/skips. An initial sandbox DNS denial was resolved by rerunning with approved network access.
- Both PostgreSQL runs verified **10/10** last-unit checkout races: one HTTP 201, one HTTP 409, physical stock zero, one confirmed order and one committed inventory event per fixture. Both also verified a real 30-second hold expiring with cleanup stopped.
- The new production-style isolated PostgreSQL flow verified strict origin/TLS peer checks, Secure/HttpOnly/SameSite=Strict host-only cookies, unchanged refresh deadlines, live stock hydration, legacy checkout protection, reserved checkout/tracking, transactional pending outbox rows, disabled admin/finance and readiness failure/draining. It simulates an approved TLS proxy; it does not establish Render's actual peers or browser routing.
- No Render deployment, shared schema migration/reseed, live Kafka publish or live OpenSearch synchronization was performed. Existing Kafka/consumer/search unit tests and PostgreSQL outbox integration passed; transport/projection doubles are not live service evidence. Frontend files, shared contracts, checkout/reservation allocation and event/mapping implementations were unchanged.
