# ShelfSync — API Contract

Version: 1.0

Base URL: `/api`

All API requests and responses use JSON.

## 1. Product Search

`GET /api/products`

Query parameters:
- `q`: Search query (optional)
- `city`: `pune`, `delhi`, or `bengaluru` (required)
- `category`: Product category (optional)
- `minPrice`: Minimum price (optional)
- `maxPrice`: Maximum price (optional)

Response (200):

```json
{
  "products": [
    {
      "id": "prod_001",
      "name": "Wireless Bluetooth Earphones",
      "description": "Noise-isolating wireless earphones",
      "category": "electronics",
      "price": 1999,
      "imageUrl": "/images/earphones.jpg",
      "city": "pune",
      "stock": 1,
      "available": true
    }
  ],
  "total": 1
}
```

Prices are in INR.

## 2. Product Details

`GET /api/products/:id?city=pune`

Response (200): A single product object with the same fields as a product in the search response.

Return HTTP 404 with a standard error response when the product does not exist.

## 3. Place Order

`POST /api/orders`

Request:

```json
{
  "city": "pune",
  "items": [
    {
      "productId": "prod_001",
      "quantity": 1
    }
  ]
}
```

Success response (201):

```json
{
  "success": true,
  "orderId": "ord_001",
  "status": "confirmed",
  "total": 1999
}
```

Insufficient stock response (409):

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock available"
  }
}
```

Checkout requirements:
- PostgreSQL is the source of truth.
- Validate stock inside a database transaction.
- Never allow negative stock.
- Create order, update inventory, and insert outbox events atomically.
- Calculate prices and totals on the server.
- Roll back the entire order if any item is unavailable.

## 4. Order Details

`GET /api/orders/:id`

Response (200):

```json
{
  "id": "ord_001",
  "city": "pune",
  "status": "confirmed",
  "total": 1999,
  "items": [
    {
      "productId": "prod_001",
      "name": "Wireless Bluetooth Earphones",
      "quantity": 1,
      "unitPrice": 1999
    }
  ]
}
```

## 5. Health Check

`GET /api/health`

Response (200):

```json
{
  "status": "ok"
}
```

## 6. Standard Error Format

All API errors must follow:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation"
  }
}
```

## 7. Integration Rules

- Frontend must follow this contract exactly.
- Backend must implement these endpoints and response formats.
- No unapproved API changes.
- Use `VITE_API_BASE_URL` for frontend API configuration.
- Support CORS for the configured frontend origin.
- Frontend may use mock data during development, but the final demo must use real backend responses.

## 8. Order Tracking

`GET /api/orders/:id/tracking`

Path parameter:

- `id`: Required order ID string, 1–100 characters, identifying the order returned by `POST /api/orders`. The backend does not require a UUID pattern; an unknown ID returns HTTP 404.

No request body or query parameters are required.

This endpoint is read-only. Order status and history are persisted in PostgreSQL (`orders` and `order_status_history`), which is the source of truth. It does not generate delivery progress. There is no public fulfillment status-update API or endpoint to list every customer's orders. Status transitions are currently disabled because an authorized fulfillment workflow is not available.

Response (200):

```json
{
  "orderId": "ord_example",
  "status": "confirmed",
  "createdAt": "2026-11-21T10:00:00.000Z",
  "history": [
    {
      "status": "confirmed",
      "occurredAt": "2026-11-21T10:00:00.100Z",
      "recordedAt": "2026-11-21T10:00:00.100Z",
      "source": "order_created"
    }
  ]
}
```

The example timestamps illustrate the format; actual values come from PostgreSQL. All fields shown are required. No `success` wrapper is included in a successful tracking response.

| Field | Type | Meaning |
| --- | --- | --- |
| `orderId` | string | Persisted order ID matching the requested order. |
| `status` | string | Current persisted order status: `pending`, `confirmed`, or `cancelled`. New successful checkouts are `confirmed`; legacy records may use the other supported values. |
| `createdAt` | string | Original order creation timestamp. |
| `history` | array of objects | Persisted status observations; may be empty if no history records exist. |
| `history[].status` | string | Observed status: `pending`, `confirmed`, or `cancelled`. |
| `history[].occurredAt` | string or null | Timestamp of a known status occurrence, or `null` when the historical occurrence time is unknown. |
| `history[].recordedAt` | string | Timestamp when PostgreSQL recorded the observation. This does not imply shipment or delivery. |
| `history[].source` | string | `order_created` or `legacy_snapshot`, as described below. |

All non-null timestamps are ISO 8601 UTC strings with a `Z` suffix, serialized with millisecond precision, for example `2026-11-21T10:00:00.100Z`.

History is returned oldest first by `recordedAt` ascending. Equal recording times are ordered by the internal database history ID ascending; that ID is not exposed in the response. Ordering is by recording time, not by the nullable `occurredAt` field.

History sources:

- `order_created`: The initial status recorded atomically with a new order. New successful checkouts have a real `confirmed` entry; its `occurredAt` and `recordedAt` are the same PostgreSQL timestamp.
- `legacy_snapshot`: The status observed when tracking was introduced for an existing order. Its `occurredAt` is `null`; `recordedAt` is the observation time, not an inferred transition time. Clients must not infer missing fulfillment progress from this snapshot.

The endpoint does not return tracking numbers, couriers, shipment dates, or delivery estimates. Existing `POST /api/orders` and `GET /api/orders/:id` responses are unchanged.

Endpoint validation, lookup, and server errors use the standard error format from section 6:

| HTTP status | `error.code` | `error.message` | Condition |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `Invalid request parameters` | Request parameters fail the backend's validation schema, for example an empty ID segment in `/api/orders//tracking`. |
| 404 | `ORDER_NOT_FOUND` | `Order not found` | The requested order does not exist. |
| 414 | `VALIDATION_ERROR` | `Request path parameter is too long` | The router rejects an ID exceeding its 100-character parameter limit, before route-schema validation. |
| 500 | `INTERNAL_ERROR` | `An internal server error occurred` | An unexpected server or database failure; driver details are not exposed. |

Missing-order example (404):

```json
{
  "success": false,
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order not found"
  }
}
```

Unmatched routes return the standard HTTP 404 route error with code `NOT_FOUND` and message `Route not found`.

Malformed URL encoding is an existing router-level exception to the standard error envelope. It is rejected before the tracking handler with HTTP 400, for example:

```json
{
  "error": "Bad Request",
  "code": "FST_ERR_BAD_URL",
  "message": "'/api/orders/%E0%A4%A/tracking' is not a valid url component",
  "statusCode": 400
}
```

The message identifies the malformed requested path; this response shape documents the current router behavior.

## 9. Inventory Command Center — Proposed Read-Only API

**Design contract only: these four admin endpoints are not implemented.** This section does not enable them or change any existing endpoint. Until implementation, requests to these paths receive the existing unmatched-route response. Authentication and the deployment restrictions below are prerequisites for exposing admin data.

### 9.1 Access control and deployment gate

For a deployed Command Center, the backend must authenticate and authorize every admin request before reading any operational data. The proposed mechanism is `Authorization: Bearer <short-lived-admin-access-token>` from a trusted identity provider. The backend must verify the signature using trusted keys, an explicit algorithm allowlist, issuer, audience, expiration and any not-before claim, and require a signed `roles` claim containing `inventory_admin`. A missing/invalid/expired token returns 401; a valid identity without that role returns 403. Neither client UI state nor caller-supplied role headers grant access. Token issuance/login endpoints are outside this contract; no such endpoints currently exist in ShelfSync.

Use HTTPS for deployed requests and keep identity-provider configuration, signing/cursor secrets, and Aiven credentials server-side, provisioned through protected environment configuration or a secret store. Never hardcode an admin secret, embed credentials in a URL, commit secrets, put credentials/tokens in `VITE_*` variables, or include them in frontend bundles. A non-secret public API base URL may still use Vite configuration. If a browser uses a runtime access token, keep it in memory rather than persisting it in local storage or logs. Return `Cache-Control: no-store` for admin responses; allow only the configured frontend origin. CORS and the `/admin` path prefix are not authentication.

There is currently no backend admin authentication/role infrastructure. The future admin module must be disabled by default and fail closed when verification is unconfigured. It must not expose an unrestricted public order list. No stock, order-status, publishing/retry, or other mutation API is defined by this section, even for administrators.

If a safe authentication mechanism cannot be supplied, the feature is restricted to an **explicitly enabled local demonstration**: bind the API/admin surface only to `127.0.0.1`/`::1`, validate the actual socket peer and Host as loopback, and reject non-loopback browser origins. Do not trust forwarded headers to establish local access, use `0.0.0.0`, expose the demo through a tunnel/reverse proxy, or open it to the LAN/Internet. A loopback-only frontend origin must be allowlisted. This opt-in mode is not admin authentication and must not be used for a shared or hosted deployment. The current public API binding must not automatically expose this unauthenticated admin surface.

Security references: [OWASP REST access control guidance](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html) and [Vite client environment-variable exposure](https://vite.dev/guide/env-and-mode).

### 9.2 Shared data, validation and pagination rules

- All four endpoints read authoritative PostgreSQL data, not OpenSearch stock or inferred Kafka state. Use a consistent read-only PostgreSQL snapshot within each response. `asOf` is the database observation time for that response, not a fulfillment timestamp or pipeline acknowledgement.
- All timestamps are ISO 8601 UTC strings ending in `Z`. Response examples use millisecond precision. Prices and totals are JSON numbers in INR rupees, never paise. Stock and counts are nonnegative integers.
- Supported cities are `pune`, `delhi`, and `bengaluru`. Stored order statuses are `pending`, `confirmed`, and `cancelled`. This contract does not add fulfillment states or enable status transitions.
- Stock status is derived using a fixed low-stock threshold of **5 units**: `out_of_stock` means stock = 0; `low_stock` means stock from 1 through 5 inclusive; `in_stock` means stock >= 6. These groups do not overlap. The threshold is not a request parameter.
- Reject unknown query keys, repeated scalar keys, invalid enum values, malformed dates, or invalid limits with 400 `VALIDATION_ERROR`. Filters combine with AND. Unknown valid category/product/event-type identifiers return an empty list, not 404.
- Inventory, orders and events accept `limit` (integer, default 50, range 1–100) and `cursor` (optional opaque string, maximum 2048 characters). Limits outside the range are rejected rather than silently clamped. There is no unbounded/all-results option.
- List responses contain the named array, `asOf`, and `page: {"limit": 50, "nextCursor": null}`. `limit` is the effective requested limit. `nextCursor` is a nonempty opaque string when another page exists at query time, otherwise `null`. Empty results return HTTP 200, an empty array and `nextCursor:null`. No exact total count is promised for paginated lists.
- Use keyset cursors bound to the endpoint, sort order, filters, limit and authorization scope, with integrity protection from a server-only secret and a 15-minute expiry. A cursor is not an access credential; authenticate each request independently. Invalid, tampered, expired or incompatible cursors return 400 `INVALID_CURSOR`. Clients must retain the same filters/limit and pass the cursor unchanged, or restart without it. Cursors for timestamp sorts must preserve PostgreSQL's full timestamp precision internally, even if display timestamps use milliseconds.
- Separate pages are live observations, not a frozen cross-request snapshot. Stock/status filters and outbox publication state may change between pages; new orders/events may require starting a fresh traversal. Do not keep database transactions open across HTTP requests.
- Orders/events optionally accept `createdFrom` (inclusive) and `createdTo` (exclusive), both ISO 8601 UTC timestamps with a `Z` suffix. Either may be omitted. If both exist, `createdFrom` must be earlier than `createdTo`. These filters use the relevant PostgreSQL `created_at`, not event occurrence, publication, or delivery time.
- On a PostgreSQL availability failure, return 503 `DATABASE_UNAVAILABLE`; do not substitute zero counters, sample data, or OpenSearch results. The existing `GET /api/health` remains a liveness check returning `{"status":"ok"}`; it does not prove Kafka/OpenSearch readiness or synchronization.

### 9.3 Overview

`GET /api/admin/overview`

Request parameters: none. This is a bounded aggregate response across all cities and is not paginated.

Response (200), with illustrative values:

```json
{
  "asOf": "2026-11-21T12:00:00.000Z",
  "lowStockThreshold": 5,
  "totalStockUnits": 99,
  "lowStockRecords": 3,
  "outOfStockRecords": 1,
  "ordersToday": {
    "count": 7,
    "date": "2026-11-21",
    "timeZone": "Asia/Kolkata",
    "startsAt": "2026-11-20T18:30:00.000Z",
    "endsAt": "2026-11-21T18:30:00.000Z"
  },
  "inventoryByCity": [
    { "city": "pune", "stockUnits": 20, "lowStockRecords": 2, "outOfStockRecords": 1 },
    { "city": "delhi", "stockUnits": 30, "lowStockRecords": 1, "outOfStockRecords": 0 },
    { "city": "bengaluru", "stockUnits": 49, "lowStockRecords": 0, "outOfStockRecords": 0 }
  ],
  "outboxBacklog": 2
}
```

All fields are required. Definitions:

| Field | Definition |
| --- | --- |
| `totalStockUnits` | Sum of `inventory.quantity` over existing inventory records; zero if none exist. |
| `lowStockRecords` | Number of existing product-city inventory records with quantity 1–5. |
| `outOfStockRecords` | Number of existing product-city inventory records with quantity 0. |
| `ordersToday` | Count of persisted orders, across all stored statuses, whose `orders.created_at` is in `[startsAt, endsAt)`. The business date containing `asOf` is evaluated in the fixed IANA timezone `Asia/Kolkata`, independently of browser, server-session or database-session timezone. `date` is `YYYY-MM-DD`; UTC bounds are the corresponding consecutive local midnights. |
| `inventoryByCity` | Exactly one entry per supported city, in the order Pune, Delhi, Bengaluru. `stockUnits` and stock-status counts use the same definitions as the global metrics, restricted to that city; include zero values when a city has no rows. City metrics sum to the global inventory metrics. |
| `outboxBacklog` | Count of all `outbox_events` rows with `published_at IS NULL`, regardless of event type. This is not Kafka consumer lag or an OpenSearch backlog measurement. |

Only real `inventory` rows are counted. A missing product-city inventory row is not silently counted as an out-of-stock record; this differs from storefront retrieval, which can expose missing selected-city inventory as stock zero.

### 9.4 Inventory

`GET /api/admin/inventory`

| Query parameter | Type and behavior |
| --- | --- |
| `city` | Optional supported city; absent means all cities. |
| `category` | Optional exact, case-sensitive category string, 1–100 characters; matched against `products.category`. |
| `stockStatus` | Optional `in_stock`, `low_stock`, or `out_of_stock`, using section 9.2 thresholds. |
| `limit`, `cursor` | Pagination as defined in section 9.2. |

Response (200):

```json
{
  "asOf": "2026-11-21T12:00:00.000Z",
  "inventory": [
    {
      "productId": "prod_001",
      "name": "Wireless Bluetooth Earphones",
      "category": "electronics",
      "city": "pune",
      "stock": 1,
      "price": 1999,
      "stockStatus": "low_stock"
    }
  ],
  "page": { "limit": 50, "nextCursor": null }
}
```

Return one row per existing `inventory(product_id, city)` joined to `products`. Every item field shown is required: product ID, name and category are strings; city is a supported city; stock is the current PostgreSQL quantity; price is the current PostgreSQL product price in INR; stock status is derived from that quantity. Missing inventory rows are omitted. Sort by city ascending, then product ID ascending, with a consistent binary/string ordering for the cursor and query. Inventory filters are applied before pagination. These reads do not reserve or mutate stock.

### 9.5 Orders

`GET /api/admin/orders`

This bounded listing is admin-only; it must not be added to the unauthenticated storefront order API.

| Query parameter | Type and behavior |
| --- | --- |
| `city` | Optional supported city. |
| `status` | Optional `pending`, `confirmed`, or `cancelled`, matched to persisted `orders.status`. |
| `createdFrom`, `createdTo` | Optional UTC creation-time bounds from section 9.2. |
| `limit`, `cursor` | Pagination as defined in section 9.2. |

Response (200):

```json
{
  "asOf": "2026-11-21T12:00:00.000Z",
  "orders": [
    {
      "orderId": "ord_example",
      "createdAt": "2026-11-21T10:00:00.000Z",
      "city": "pune",
      "total": 1999,
      "status": "confirmed"
    }
  ],
  "page": { "limit": 50, "nextCursor": null }
}
```

All item fields are required. Read `orderId`, `createdAt`, city, total and status directly from `orders.id`, `created_at`, `city`, `total` and `status`. Total is the persisted INR checkout total, not a recalculation using current catalog prices. Sort by `createdAt` descending, then order ID descending as a deterministic tie-breaker. Filters apply before pagination. No customer identity, courier, tracking number, estimate or inferred fulfillment state is added.

### 9.6 Events

`GET /api/admin/events`

This is a PostgreSQL outbox log, not a complete Kafka/OpenSearch processing audit.

| Query parameter | Type and behavior |
| --- | --- |
| `eventType` | Optional exact event-type string, 1–100 characters; currently checkout writes `inventory.changed`. |
| `publicationState` | Optional `pending` or `published`. |
| `productId` | Optional exact product ID string, 1–100 characters, when present in the persisted payload. |
| `city` | Optional supported city, when present in the persisted payload; rows with no city do not match this filter. |
| `createdFrom`, `createdTo` | Optional UTC outbox creation-time bounds from section 9.2. |
| `limit`, `cursor` | Pagination as defined in section 9.2. |

Response (200):

```json
{
  "asOf": "2026-11-21T12:00:00.000Z",
  "events": [
    {
      "eventId": "11111111-1111-4111-8111-111111111111",
      "eventType": "inventory.changed",
      "orderId": null,
      "productId": "prod_001",
      "city": "pune",
      "createdAt": "2026-11-21T11:00:00.000Z",
      "publicationState": "pending",
      "publishedAt": null
    },
    {
      "eventId": "22222222-2222-4222-8222-222222222222",
      "eventType": "inventory.changed",
      "orderId": null,
      "productId": "prod_002",
      "city": "delhi",
      "createdAt": "2026-11-21T10:00:00.000Z",
      "publicationState": "published",
      "publishedAt": "2026-11-21T10:00:01.000Z"
    }
  ],
  "page": { "limit": 50, "nextCursor": null }
}
```

These are illustrative event rows; implementations must return actual PostgreSQL records. Every item field shown is required; nullable fields remain present as `null` when unavailable.

| Field | Type and source |
| --- | --- |
| `eventId` | UUID string from `outbox_events.id`. |
| `eventType` | String from `outbox_events.event_type`. |
| `orderId` | String or null, only from an explicitly persisted order association. The current outbox schema has no order-ID column and checkout payloads omit it, so current checkout events return null. Do not infer an order by matching product, city, timestamps or order items. |
| `productId` | String or null, extracted only when the stored payload contains a valid nonempty product ID string. |
| `city` | Supported city or null, extracted only when a supported city is present in the stored payload. |
| `createdAt` | UTC timestamp from `outbox_events.created_at`, not `payload.occurredAt`. |
| `publicationState` | `pending` when `published_at IS NULL`, otherwise `published`. |
| `publishedAt` | UTC timestamp from `outbox_events.published_at`, or null for pending rows. |

Sort by `createdAt` descending, then event ID descending; apply filters before pagination. Unrecognized/malformed event payloads can still appear with their real row metadata and null associations; do not drop their outbox records or fabricate missing fields. Do not return the unrestricted raw JSON payload or credentials through this endpoint.

The publisher sends a committed outbox payload to `inventory-events`, waits for Kafka acknowledgement, then sets `published_at` and commits. A crash after acknowledgement but before the database marker can leave an already-sent event pending; retries may publish duplicates. Thus `pending` means **no committed publication marker**, not proof that Kafka has never received the event. `published` means the acknowledgement was recorded by the publisher, not that a consumer completed or OpenSearch indexed it.

The consumer commits Kafka offsets after successful OpenSearch processing and keeps the latest inventory version/event ID in a projection document. PostgreSQL has no independently persisted per-event consumer/indexing acknowledgement. Neither a worker log, the current projection's last event ID, nor `published_at` proves complete processing of every event. No consumer-completed, indexed, synchronized, or similar event state is part of this contract.

### 9.7 Proposed common admin errors

These errors apply to all four future endpoints and use the standard envelope in section 6. Authenticate/authorize before returning operational data or performing filter queries. An empty authorized list is HTTP 200, not 404.

| HTTP status | `error.code` | `error.message` | Condition |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `Invalid request parameters` | Invalid/unknown/repeated query parameters, invalid date range, enum or result limit. |
| 400 | `INVALID_CURSOR` | `Invalid or expired cursor` | Cursor is malformed, tampered, expired or incompatible with the endpoint/filters/limit/scope. |
| 401 | `UNAUTHENTICATED` | `Admin authentication required` | Missing, invalid or expired admin access token; include `WWW-Authenticate: Bearer` in protected deployed mode. |
| 403 | `FORBIDDEN` | `Admin access required` | Valid identity lacks the required role, or a request violates local-demo access restrictions. |
| 503 | `ADMIN_DISABLED` | `Admin API is not enabled` | A future admin module is present but disabled or secure verification is unconfigured; explicit eligible local-demo mode is the only exception. |
| 503 | `DATABASE_UNAVAILABLE` | `Operational data is temporarily unavailable` | Authoritative PostgreSQL data cannot be read. |
| 500 | `INTERNAL_ERROR` | `An internal server error occurred` | Unexpected server failure; never expose SQL, credentials, tokens or driver details. |

Example (401):

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Admin authentication required"
  }
}
```

### 9.8 Implementation prerequisites and schema limitations

- No admin endpoints or authentication are implemented by this documentation change. Backend authorization or the explicit local-only deployment gate must precede UI access to real admin data.
- The schema has no admin identities, role assignments, customer ownership or tenant columns. This design is for authorized operational access to the existing single storefront dataset; it does not create a customer-facing global orders feed or a multi-tenant authorization model.
- Inventory aggregates/listing cover existing rows only. Missing product-city records are not auditable stock records and require separate data-quality work if every catalog/city combination must be represented.
- Current order statuses and history do not support a live fulfillment progression. Keep their persisted values; do not synthesize processing/shipping/delivery transitions.
- The outbox has only `id`, `event_type`, `payload`, `created_at` and `published_at`. It has no reliable order association for current checkout events, per-event retry/error history, consumer completion or indexing acknowledgement. Adding those capabilities requires separate persistence/lifecycle design; they must not be inferred or displayed as established facts.
- Existing orders/events indexes may need additional indexes for efficient filtered keyset queries; new indexes, auth wiring and endpoint implementation belong to a later backend task. No database or application behavior changes are authorized by this section alone.

## 10. Smart Cart Reservations — Proposed Design, Not Implemented

This section proposes API, database and event changes for a later implementation. It does not enable reservations, install migrations, change current responses, or claim reservation/concurrency tests have run. Sections 1–9 are preserved. In particular, today's checkout accepts only `city` and `items`; the additional request field below is not yet accepted. Some section 9 implementation-status text predates the implemented admin module; this proposal does not revise its schemas or access restrictions.

### 10.1 Observed baseline and compatibility boundary

- `inventory` has primary key `(product_id, city)`, physical `quantity >= 0`, monotonically increasing `version`, and `updated_at`. There is no reservation/session schema or reserved-stock column.
- Current checkout combines duplicate products, updates city inventory in product-ID order inside one checked-out PostgreSQL transaction, calculates INR prices from `products`, creates a confirmed order/items and inventory outbox records, then commits. Initial order history is recorded by the existing order-insert trigger.
- Existing `inventory.changed` schema-version-1 events contain physical `quantity`, not available stock. The publisher validates version 1, publishes to `inventory-events` with key `productId:city`, and records `published_at` only after acknowledgement. The consumer validates version 1, updates the product-city OpenSearch document only for a greater `inventoryVersion`, and commits offsets after processing.
- PostgreSQL product reads and catalog bootstrap currently use physical quantity. OpenSearch documents expose `stock` and `available` from that quantity. Successful OpenSearch searches currently return projection stock directly; product details and the fallback path use PostgreSQL.
- The frontend persists desired quantities by city in local storage (`shelfsync.cart.v1:<backend>`). It has no reservation identity or expiry state, and currently caps increases using displayed stock. Persistence is cart intent, not an inventory guarantee.

Keep physical inventory and existing admin metrics unchanged. Add reservation tables and optional reservation-aware checkout without renaming existing columns or changing successful order/tracking JSON. Before enabling holds, upgrade **every** stock-writing checkout instance, PostgreSQL product reader, bootstrap, publisher and consumer together as described in section 10.9. An old direct-decrement checkout instance could otherwise sell held units. Backward-compatible request syntax alone is insufficient for a safe rollout.

### 10.2 Time, ownership and browser security

`RESERVATION_TTL_SECONDS` is a server-side integer, default **30** for the hackathon, allowed range 5–300. Reject invalid configuration at startup; never accept TTL, expiry, prices, ownership or available-stock values from clients. Store each new deadline once; configuration changes affect future holds only. All response timestamps are ISO 8601 UTC ending in `Z`, with millisecond display precision; preserve PostgreSQL precision for comparisons.

A reservation is one product-city hold owned by an anonymous browser session. Multiple products use multiple independent holds; a batch creates them at one database decision time. This avoids extending an existing product's deadline when another product is added. Each deadline is `created_at + configured TTL`, capped by the session's fixed expiry. The hold starts when PostgreSQL accepts allocation, not at a client timestamp or before a network request reaches the server. The Add to Cart action must issue that request immediately and show a pending state until acknowledgement.

Proposed session setup: `POST /api/cart/session`, body `{}`, no query parameters. Return 201 for a newly issued session, or 200 for the same still-valid session, with exactly:

```json
{
  "serverTime": "2026-11-21T12:00:00.000Z",
  "sessionExpiresAt": "2026-11-22T12:00:00.000Z"
}
```

The server generates at least 32 cryptographically random bytes as an opaque cookie credential and stores only its SHA-256 digest. A separate internal UUID identifies the session in foreign keys. Neither identifier supplied in a request body, a caller-selected user ID, an admin role header, nor a reservation UUID grants ownership. Do not return the cookie secret in JSON or URLs. A missing/expired credential cannot read, release or consume old holds, even if their public IDs are known.

For HTTPS deployments, issue a host-only `__Host-shelfsync_cart` cookie with `Secure; HttpOnly; SameSite=Strict; Path=/`, no `Domain`, and an expiry matching the fixed 24-hour session lifetime. Reusing a valid session does not slide that lifetime or change hold deadlines. Use a same-origin HTTPS frontend/API deployment, or explicitly configured same-site HTTPS origins; do not relax cookie policy to accommodate arbitrary cross-site hosting. Browser Fetch must use `credentials: 'include'` for cross-origin same-site calls. Credentialed CORS is restricted to the exact configured frontend origin on these routes and reservation-aware checkout, never `*` or a reflection of arbitrary origins. See [browser cookie attribute rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

Every cookie-authorized mutation, including session issuance and reservation-aware checkout, requires `Content-Type: application/json` and an `Origin` exactly equal to the configured frontend origin. Reject missing/`null`/foreign mutation origins. GETs do not mutate or renew anything; if an Origin is supplied it must also match. These checks supplement the host-only HttpOnly cookie and strict same-site policy; CORS alone is not authorization. Return `Cache-Control: no-store` on session/reservation responses and reservation-aware checkout errors. Redact Cookie, Set-Cookie, session digests, authorization values and complete request headers/bodies from logs and tracing.

For a local HTTP hackathon only, propose `RESERVATION_ALLOW_LOCAL_HTTP=true` (default false): a separate host-only HttpOnly `shelfsync_cart_dev` cookie with `SameSite=Strict; Path=/`, without `Secure`, permitted only for non-production loopback bindings, real loopback peers/Hosts, exact loopback frontend origin and no forwarding headers. Use the same hostname for browser and API, for example `127.0.0.1` on both ports 5173 and 3000. Never accept the dev cookie in HTTPS production mode. This is a proposed scoped development exception, not a global TLS or authentication bypass. Existing admin JWT/default-off/local-demo gates remain unchanged; cart cookies grant **no admin access**, and admin local-demo still cannot be exposed through LAN, tunnels or proxies.

### 10.3 Availability and reservation states

For a product-city row at PostgreSQL observation time `T`:

```text
physicalQuantity = inventory.quantity
reservedQuantity(T) = SUM(quantity WHERE state = 'active' AND expires_at > T)
availableQuantity(T) = physicalQuantity - reservedQuantity(T)
```

All sums are scoped to that exact product and city. The allocator must maintain `0 <= reservedQuantity(T) <= physicalQuantity`; a broken invariant is an operational error, not a reason to silently clamp negative results. Missing inventory means zero reservable units. Holds do not decrement physical inventory. Consuming an owned hold reduces physical stock and removes its active reserved quantity in the same transaction, so it does not deduct availability twice.

States are `active`, `expired`, `released`, and `consumed`. Allowed transitions are `active → expired`, `active → released`, and `active → consumed`; terminal rows cannot be reactivated. A fresh explicit reservation creates a new UUID. A row stored as active but with `expires_at <= T` is **effectively expired** for reads and allocation, even before cleanup changes its stored state. At exact equality it is expired. No background worker, Kafka message or OpenSearch refresh is required for PostgreSQL to make those units available again.

GET responses use the effective state. For an unmaterialized expiry, `updatedAt` still means the last persisted row change; do not fabricate an update time. Clients use `serverTime` and the immutable `expiresAt` for a countdown, then reconcile on focus/refresh/checkout. The browser's wall clock cannot grant or extend a hold.

### 10.4 Proposed reservation APIs and exact response model

All endpoints in this subsection require the owning session cookie. Unknown keys, unsupported cities, blank/over-100-character product IDs, malformed UUIDs, repeated query keys, nonnumeric/fractional/nonpositive quantities and client expiry/price/user-ID fields are 400. JSON quantities must be numbers, not coerced strings or booleans. No query parameters are allowed except the optional city on GET. Maximum JSON body is 64 KiB.

Every successful create/update/release response uses exactly this envelope; examples describe a single line but the array contains every requested resulting hold:

```json
{
  "serverTime": "2026-11-21T12:00:00.000Z",
  "reservations": [
    {
      "reservationId": "44444444-4444-4444-8444-444444444444",
      "productId": "prod_001",
      "city": "pune",
      "quantity": 1,
      "status": "active",
      "createdAt": "2026-11-21T12:00:00.000Z",
      "expiresAt": "2026-11-21T12:00:30.000Z",
      "updatedAt": "2026-11-21T12:00:00.000Z",
      "requiresReservation": false,
      "orderId": null
    }
  ]
}
```

Every field shown is required. `quantity` is the stored positive hold quantity, not current public availability. `status` uses the four states above. `requiresReservation` is true for expired/released rows, false for active/consumed rows; a consumed line belongs to a completed order and should be removed from the purchased cart after confirmation. `orderId` is the persisted order ID only for consumed rows, otherwise null. IDs are server-generated UUIDs. Sort reservation arrays by city, product ID, then reservation ID in binary ascending order. No prices, totals, customer identity or credentials are returned here; prices remain PostgreSQL checkout inputs.

| Method and path | Request | Successful behavior |
| --- | --- | --- |
| `POST /api/cart/reservations` | `{"city":"pune","items":[{"productId":"prod_001","quantity":1}]}` | 201 with the envelope above after committing allocation. `items` has 1–100 entries, each quantity 1–99; combine duplicate product IDs by summing before checking limits. At most 20 distinct active products and 100 reserved units per session across all cities. All requested products succeed together or none do. |
| `GET /api/cart/reservations?city=pune` | Optional supported `city`, no body. | 200 with the same envelope, including active and terminal **latest-generation** rows for the owner, optionally restricted by city. Return an empty array when none exist. One latest row per product-city; at most 100 distinct product-city pairs over one session's lifetime, hence no unbounded history/pagination. Older generations are retained internally, not listed. No expiration reset or implicit re-reservation. |
| `PATCH /api/cart/reservations` | `{"city":"pune","items":[{"reservationId":"44444444-4444-4444-8444-444444444444","quantity":2}]}` | 200 with the resulting requested holds. 1–20 unique owned IDs, target quantities 1–99; quantities are absolute, not increments. All rows must be active at the decision time and match the city. An increase allocates only the difference; a decrease releases the difference immediately. Deadlines and `createdAt` never change. Identical targets are no-ops. Zero uses the explicit release endpoint. All-or-nothing. |
| `POST /api/cart/reservations/release` | `{"reservationIds":["44444444-4444-4444-8444-444444444444"]}` | 200 with the resulting requested rows, 1–100 unique owned IDs. Active unexpired holds become released immediately. Effectively expired rows remain expired; released/consumed rows are idempotent no-ops, never order cancellations or stock refunds. A foreign/unknown ID makes the entire batch 404 with no releases. |

Create is for a new hold, not an extension endpoint. Creating an already active product-city returns 409 `RESERVATION_EXISTS`; the frontend must PATCH its existing hold for an increase. PATCH uses server-stored quantity and expiry, not a product-card stock estimate. Independent tabs share the browser session: mutations are serialized, absolute target updates use last successful write semantics, and tabs must reconcile returned state rather than adding optimistic deltas twice.

After duplicate normalization, each product's requested quantity must still be 1–99 (otherwise 400). Exceeding the separate 20-active-product or 100-total-reserved-unit session caps is 409 `RESERVATION_LIMIT`. PATCH duplicate reservation IDs are rejected rather than summed.

**Recover expired items:** after an explicit customer “Reserve again” action, POST the same city/product/desired quantity with a **new** idempotency key. The old expired/released row remains terminal; success creates a new UUID and new deadline. There is no refresh/keep-alive endpoint. A failed reacquisition leaves the desired item in the cart requiring a reservation. An uncertain network result must first retry the original key or GET state, not automatically mint a new hold.

To prevent repeated Add/refresh/release from continuously resetting a hold, the same session/product-city cannot create another generation until **five seconds after the previous generation's original `expiresAt`**, even if released or consumed early. Return 429 `RESERVATION_COOLDOWN` with an integer `Retry-After` until eligible. PATCH, page refresh and retries never bypass it. This intentionally introduces a short reacquisition gap. Other sessions can reserve released/expired stock immediately. Anonymous session/IP admission limits below also apply; this is bounded abuse resistance, not a claim that anonymous browsers provide Sybil-proof identity.

Only one city may have unexpired active holds in a session. A create/PATCH trying to mix cities returns 409 `RESERVATION_CITY_CONFLICT`. On a city switch, release all old-city active holds and wait for acknowledgement (or reconcile an uncertain response), then select the new city and explicitly reserve its items. Keep the old city's desired items in the existing per-city cart, now unreserved. There is no automatic transfer or cross-city stock substitution. Releasing old-city holds and allocating new-city holds are separate actions; a new-city failure does not resurrect old holds. A customer may also wait for old holds to expire. Read-only browsing in another city is unrestricted.

No partial success or HTTP 207 is defined. Unknown products/missing city inventory and inadequate available units return the standard 409 `INSUFFICIENT_STOCK`; the batch has no new holds, quantity changes, order or allocation events. On removal, release is sent immediately. Local UI may remove the desired item promptly but must track a pending release until acknowledged; if offline, immediate server release cannot be promised and the original deadline is the safety bound. Do not rely on page-unload requests for correctness.

### 10.5 Checkout extension and legacy behavior

Propose one optional field on the existing `POST /api/orders`, with the same 201 confirmation JSON and existing order-details/tracking responses:

```json
{
  "city": "pune",
  "items": [{ "productId": "prod_001", "quantity": 1 }],
  "reservationIds": ["44444444-4444-4444-8444-444444444444"]
}
```

When `reservationIds` is present, require the session cookie, mutation Origin check and `Idempotency-Key`. It must contain 1–20 unique UUIDs. Combine duplicate `items` as in current checkout. Owned holds must cover **exactly** the normalized products, quantities and single city; do not accept a price/total from the client, consume partial holds, silently buy an expired line as an ordinary order, or leave part of a submitted hold behind. A mismatch is 409 `RESERVATION_MISMATCH`; expiry is 409 `RESERVATION_EXPIRED`; a released hold is 409 `RESERVATION_NOT_ACTIVE`; an already consumed hold under a different key is 409 `RESERVATION_CONSUMED`. An unknown/foreign ID is 404 without disclosing another session's state.

In one PostgreSQL transaction/client, verify ownership and validity after acquiring the locks, read current product prices, decrement physical quantity with its nonnegative guard, create the confirmed order and items, mark all submitted holds consumed with that order ID, insert availability outbox snapshots, and commit. The existing order trigger records real confirmed history. One unavailable/expired line rolls back the **entire** checkout, including quantities, consumed flags, orders, history and outbox writes. The original desired cart remains intact after a rejected checkout. Validity is evaluated at the atomic allocation decision time after waiting for every required lock, not when a button was clicked; a request that expires while waiting cannot consume the hold. Keep transactions short and perform no Kafka/OpenSearch/network calls in them.

For clients omitting `reservationIds`, retain the original request and response formats and no new session requirement. However, legacy checkout must use the same locked allocator and buy only `availableQuantity`, excluding **all** live holds, even ones owned by a cookie on that request. It cannot bypass another browser's reservation or accidentally consume the owner's hold. Use 409 `INSUFFICIENT_STOCK` when unheld units are inadequate. Existing no-reservation checkout/concurrency tests remain valid; add tests mixing both checkout modes. No order status, payment, fulfillment or public order-list API is added.

### 10.6 Proposed PostgreSQL schema and transactional algorithm

Add a backward-compatible migration later; no migration is created by this document. A reservation already represents a line item, so no additional reservation-header/line table is needed.

| Table | Proposed columns and constraints |
| --- | --- |
| `cart_sessions` | `id uuid PRIMARY KEY`; `token_hash bytea UNIQUE NOT NULL CHECK (octet_length(token_hash)=32)`; `created_at timestamptz NOT NULL`; `expires_at timestamptz NOT NULL CHECK (expires_at > created_at)`. Fixed 24-hour expiry; cookie secrets are never stored. |
| `cart_reservations` | `id uuid PRIMARY KEY`; `session_id uuid NOT NULL REFERENCES cart_sessions(id) ON DELETE RESTRICT`; `product_id text NOT NULL`; `city text NOT NULL`; composite FK `(product_id, city) REFERENCES inventory(product_id, city) ON DELETE RESTRICT`; `quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99)`; `state text NOT NULL CHECK (state IN ('active','expired','released','consumed'))`; `created_at`, `expires_at`, `updated_at` all `timestamptz NOT NULL`; `order_id text NULL REFERENCES orders(id) ON DELETE RESTRICT`; `CHECK (expires_at > created_at)` and `CHECK ((state = 'consumed') = (order_id IS NOT NULL))`. Allocator enforces expiry no later than session expiry, immutable ownership/product/city/creation/deadline and terminal states. |
| `cart_idempotency` | `session_id uuid NOT NULL REFERENCES cart_sessions(id) ON DELETE RESTRICT`; `key uuid NOT NULL`; `request_hash bytea NOT NULL CHECK (octet_length(request_hash)=32)`; `http_status smallint NOT NULL`; `response jsonb NOT NULL`; `created_at timestamptz NOT NULL`; primary key `(session_id, key)`. Store only completed safe JSON responses, never cookies or secrets. Retain until at least 24 hours after session expiry. |
| `reservation_rate_limits` | Bounded PostgreSQL admission counters keyed by scope (`session`, `ip` or `session_issue`), opaque key digest and UTC window start, with count and expiry. Unique `(scope, key_digest, window_start)`; atomic increment-and-check; expiry index and batched deletion. Use a dedicated server-only `RESERVATION_RATE_LIMIT_SECRET` with at least 32 random bytes for HMAC of normalized socket/trusted-proxy IPs; never trust arbitrary `X-Forwarded-For`. No new cache/service is needed. |

Proposed reservation indexes: unique `(session_id, product_id, city) WHERE state='active'`; `(product_id, city, expires_at) INCLUDE (quantity) WHERE state='active'` for live sums; `(expires_at, product_id, city) WHERE state='active'` for expiry scans; `(session_id, product_id, city, created_at DESC, id DESC)` for latest generation and cooldown checks; and `order_id` for reconciliation. Do not put `now()` in a partial-index predicate; filter `expires_at > T` in the query. An effectively expired row must be materialized before inserting the next generation under the partial unique constraint. Preserve current physical quantity/price constraints and inventory version range checks.

Use `READ COMMITTED`, one checked-out `pg` client and parameterized SQL. **Every** allocation, quantity update, release, legacy/reserved checkout and inventory adjustment must use the same inventory-row locking discipline; a cross-row live-reservation sum cannot be protected by a simple CHECK constraint alone. For cookie-authorized mutations:

1. Lock the owning `cart_sessions` row, check the credential/session lifetime and idempotency outcome. This serializes that browser's caps, city gate and competing tab actions. Never acquire another owner's session lock.
2. Resolve all affected inventory keys without first locking reservation rows, then acquire inventory `FOR UPDATE` locks in binary `(product_id, city)` ascending order. A legacy checkout has no session lock but uses the identical inventory order. Never invert this order or retain locks across HTTP requests.
3. In a **subsequent SQL statement after the locks have been obtained**, sample PostgreSQL `clock_timestamp()` once as decision time `T`, read live sums/owned rows, and materialize due expiries for the locked keys. Do not use a transaction-start `now()` captured before a lock wait, or an aggregate computed before another purchaser's commit. Read Committed supplies a fresh statement snapshot; the row locks serialize competing allocators. See [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html) and [locking](https://www.postgresql.org/docs/current/explicit-locking.html).
4. Check the whole proposed resulting set against physical stock, session/unit/city caps and immutable deadlines, then perform all changes. For PATCH, subtract the owner's old live quantity before testing its new target; do not count the same hold twice. For reserved checkout, remove the exact owned holds and decrement physical stock together. Retain a conditional physical-quantity decrement as a final database guard.
5. Increment `inventory.version` and `updated_at` once per changed product-city and insert one full resulting availability snapshot into `outbox_events` per changed key in that transaction. Include expiry reconciliation in those snapshots, without adding multiple conflicting snapshots at one version. No-op reads/replays/identical PATCH targets do not bump versions. Persist the idempotency result with the successful business writes, then commit.

Reservation row locks, when needed, are acquired **after** inventory locks. Expiring another session's due rows must not acquire that session's parent lock. Cleanup workers take inventory locks first and never request session locks; this avoids a worker holding a reservation row while an owning request holds its session lock waiting for inventory. Expiry is server-driven and does not require the owner's credential. Enforce bounded lock/statement/transaction deadlines and bounded retries of deadlock/serialization failures; retries recheck real time/availability and use the same idempotency key. Exhaustion returns a retryable 503, never a fabricated success.

Read APIs use one PostgreSQL snapshot and one observation time per response, joining only holds live at that time. For read observations, `statement_timestamp()` gives the statement time; `clock_timestamp()` is needed for allocation after lock waits rather than transaction-start time. These functions have distinct semantics documented in [PostgreSQL date/time functions](https://www.postgresql.org/docs/current/functions-datetime.html). An expired hold stops reducing read availability through the time predicate even with no cleanup at all.

### 10.7 Idempotency, cleanup and admission limits

Require `Idempotency-Key: <client-generated UUID>` on create, PATCH, release and reservation-aware checkout. It is a request identifier, not an ownership credential. Fingerprint method, path and normalized body (coalesced/sorted product quantities or sorted unique reservation IDs) under the session. The same key and fingerprint returns the original HTTP status and JSON, including original IDs/deadlines/order confirmation; the same key with a different request returns 409 `IDEMPOTENCY_CONFLICT`. Concurrent identical requests must serialize and produce one allocation/order. A replay does not change state, extend expiry or create another outbox event; its original `serverTime` may be old, so a client needing current state must GET it.

Persist completed 2xx and deterministic business-409 outcomes. Use an operation savepoint inside the locked idempotency transaction so a rejected batch can roll back all stock/reservation/order/outbox changes before saving only its error result. Schema/auth/ownership/rate-limit failures and unexpected 5xx are not cached. A later explicit retry after an insufficient-stock outcome uses a new key. A committed order confirmation remains the replay result after the hold deadline **while the owning session credential is still valid**. Never blindly place another order on a timeout.

Retaining idempotency evidence does not authorize expired credentials. After session expiry or cookie loss, return 401 and do not automatically issue a replacement session to retry an uncertain checkout as a new purchase. Existing locally remembered order IDs can still use the unchanged order-details/tracking APIs. If the confirmation itself was lost along with the cookie, this minimal anonymous design has no automatic order-discovery flow; operator-assisted reconciliation is required. No endpoint reveals a global order list or another session's order.

A dedicated PostgreSQL expiry worker polls at most once per second, selects at most 100 distinct due inventory keys, locks available inventory rows with `FOR UPDATE SKIP LOCKED` in the shared order, then rechecks due rows at database time. Mark them expired, increment the key's inventory version, write a full availability outbox event, and commit. Concurrent workers/release/checkout recheck state under the same inventory lock, so an expiry is reconciled once; retries are harmless. A normal allocation/release/checkout can perform the same reconciliation lazily. Selection before locking is only a candidate scan, never authority to expire or allocate.

No expiry transaction increments physical quantity: no unit was physically removed at reservation time. Worker failure delays events/projection updates, **not** PostgreSQL stock availability. Retain expired/released rows until session expiry plus at least 24 hours; retain consumed rows while their orders are retained. Never purge active rows or delete orders as cleanup, and do not remove cooldown/idempotency evidence while it can affect a request. Remove expired rate-limit windows in bounded batches. The original cart's desired item survives row cleanup; loss of a server hold is not an instruction to delete it locally.

Proposed shared admission defaults: at most 20 new session issuances per IP per hour; at most 20 create/reacquire attempts per session per minute and 60 per IP per minute; at most 60 PATCH attempts per session per minute. Use the PostgreSQL counters so multiple API instances cannot bypass limits. Honor the session/unit/100-distinct-pair caps and five-second product cooldown independently. Deny before opening a long inventory transaction; 429 responses include `Retry-After`. Releasing and completing valid held checkout are not blocked behind a create/PATCH quota; apply separate bounded global HTTP protection so releases are not made impossible by repeated Add actions. GETs/session renewal never extend a hold. Stable session-cookie theft or mass new identities remain abuse risks; HTTPS, redaction and IP admission bounds reduce them without claiming a full customer-authentication system.

### 10.8 Proposed errors and status codes

Use section 6's exact standard envelope; no partial-result/error-data variant is added. These errors apply to the proposed APIs and reservation-aware checkout only; existing public/admin error contracts remain intact. Authorization/ownership is checked before exposing stored reservation state.

| HTTP | `error.code` | `error.message` | Condition |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `Invalid request parameters` | Malformed body/query/UUID/idempotency key, empty items, invalid quantity, repeated IDs where uniqueness is required, unknown fields or bounds. |
| 401 | `CART_SESSION_REQUIRED` | `A valid cart session is required` | Missing, unknown or expired cookie. Session issuance itself needs no prior credential. |
| 403 | `CART_ORIGIN_FORBIDDEN` | `Cart request origin is not allowed` | Origin/cookie-transport/local-development access restriction fails. |
| 404 | `RESERVATION_NOT_FOUND` | `Reservation not found` | Unknown or foreign reservation ID; indistinguishable to the caller. |
| 409 | `INSUFFICIENT_STOCK` | `Not enough stock available` | Unknown product, missing city inventory or inadequate available units. |
| 409 | `RESERVATION_EXISTS` | `An active reservation already exists` | Create requests an already actively held product-city in this session. |
| 409 | `RESERVATION_EXPIRED` | `Reservation has expired; reserve the item again` | PATCH/checkout includes an owned effectively expired hold. |
| 409 | `RESERVATION_NOT_ACTIVE` | `Reservation is not active` | PATCH/checkout includes an owned released hold. |
| 409 | `RESERVATION_CONSUMED` | `Reservation has already been consumed` | PATCH/new checkout includes an owned consumed hold; exact checkout replay still returns its original result. |
| 409 | `RESERVATION_MISMATCH` | `Reservations do not match the requested order` | Held product/city/quantity set differs from normalized checkout items, or PATCH city differs from the held row. |
| 409 | `RESERVATION_CITY_CONFLICT` | `Release active reservations before changing city` | Attempt to create/update active holds across cities. |
| 409 | `RESERVATION_LIMIT` | `Cart reservation limit reached` | Session active-line, reserved-unit or lifetime-distinct-pair cap exceeded. |
| 409 | `IDEMPOTENCY_CONFLICT` | `Idempotency key was used for a different request` | A retained session/key is reused with a different fingerprint. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type must be application/json` | A mutation uses another body media type. |
| 429 | `RESERVATION_RATE_LIMITED` | `Too many reservation requests` | Admission quota exceeded; include integer `Retry-After`. |
| 429 | `RESERVATION_COOLDOWN` | `Wait before reserving this item again` | Same-session product-city generation attempted before its cooldown ends; include integer `Retry-After`. |
| 503 | `RESERVATIONS_DISABLED` | `Cart reservations are not enabled` | Future feature module is present but securely disabled. |
| 503 | `DATABASE_UNAVAILABLE` | `Cart data is temporarily unavailable` | PostgreSQL connection/availability failure. |
| 503 | `RESERVATION_BUSY` | `Reservation could not be completed; retry the same request` | Bounded lock/transaction retry budget exhausted; include integer `Retry-After`. |
| 500 | `INTERNAL_ERROR` | `An internal server error occurred` | Unexpected failure; no SQL, tokens, credentials or driver details. |

Expired-checkout example (409):

```json
{
  "success": false,
  "error": {
    "code": "RESERVATION_EXPIRED",
    "message": "Reservation has expired; reserve the item again"
  }
}
```

For owned requests with multiple business problems, use deterministic precedence: not-found/ownership first, then consumed, expired, released, city/set mismatch, cap/cooldown, then insufficient stock. Authentication, schema and transport checks precede this sequence. An error never grants more time or confirms an order.

### 10.9 Transactional outbox, Kafka and OpenSearch design

**Do not reinterpret schema-version-1 `quantity` as available stock.** Introduce version 2 of `inventory.changed`, retaining physical `quantity` and the existing key/topic. Proposed exact snapshot payload:

```json
{
  "eventId": "55555555-5555-4555-8555-555555555555",
  "type": "inventory.changed",
  "schemaVersion": 2,
  "productId": "prod_001",
  "city": "pune",
  "quantity": 1,
  "reservedQuantity": 1,
  "availableQuantity": 0,
  "inventoryVersion": 8,
  "occurredAt": "2026-11-21T12:00:00.000Z",
  "nextExpirationAt": "2026-11-21T12:00:30.000Z",
  "causes": ["reservation.created"]
}
```

All shown fields are required. Quantities are nonnegative integers with `quantity = reservedQuantity + availableQuantity` at `occurredAt`; `inventoryVersion` is the same product-city monotonic database counter, represented only within JSON's safe integer range. `nextExpirationAt` is the earliest remaining live hold deadline or null. `causes` is a nonempty deduplicated array from `reservation.created`, `reservation.updated`, `reservation.released`, `reservation.expired`, `checkout.confirmed`; combine causes when one transaction reconciles expiry and another action. Causes are operational explanations, not a complete customer audit. No session token/digest, reservation secret, raw cookie or inferred order association is included. Current admin event `orderId` remains null without an explicit stored order association.

| Transition | Physical quantity | PostgreSQL availability | Required committed snapshot |
| --- | --- | --- | --- |
| Create/increase | Unchanged | Decreases by newly held units | New inventory version and resulting physical/reserved/available quantities. |
| Decrease/release | Unchanged | Increases by relinquished live units | New version and resulting quantities; no double restoration for already expired/terminal holds. |
| Deadline reached | Unchanged | Increases immediately through `expires_at > T`, even if the row is still stored active | Cleanup/lazy reconciliation subsequently materializes expiry and writes a new-version snapshot. The row timestamp/event observation is real processing time, not a fabricated event published at the deadline. |
| Reserved checkout | Decreases by purchased units | Owned holds are removed; available units usually stay the same | Confirmed order, consumed holds and new-version snapshot in one transaction. |
| Legacy checkout | Decreases by purchased unheld units | Decreases by the same units | New-version snapshot in the checkout transaction; live holds remain intact. |

Continue using PostgreSQL outbox rows and at-least-once publishing. Mark `published_at` only after Kafka acknowledges; leave failed events pending; never publish inside checkout/allocation. The consumer must validate both schemas during migration, apply one atomic version-guarded update per product-city document and commit offsets only after success. Equal versions and duplicates are no-ops; smaller versions cannot overwrite a newer snapshot, regardless of delivery order or timestamp. A strictly newer version wins even if availability decreased. Keep database monotonic versions, not Kafka arrival times or expiry timestamps, as the ordering authority.

Extend explicit OpenSearch mappings with `physicalQuantity` and `reservedQuantity` (integers) and nullable `nextExpirationAt` (date). Map event `quantity → physicalQuantity`, `reservedQuantity → reservedQuantity`, and `availableQuantity → stock`; retain public `available = stock > 0` and the long `inventoryVersion`. A version-1 event can be treated as physical=available and reserved=0 **only for events from before holds are enabled**, when no reservations existed. New writers emit version 2 after cutover, including legacy checkout. Upgrade publisher validators and consumer/parser/scripts/mappings first, stop/drain old writers, migrate/bootstrap consistently, then enable holds. Reject or alert on any post-cutover version-1 writer. Do not enable reservations in a mixed fleet or merely inject version-2 rows into today's version-1-only publisher.

Bootstrap must read catalog, physical quantity, live holds, deadlines and version together. Under each product-city inventory lock, reconcile due expiry and capture a versioned availability snapshot at the same decision time; write any reconciliation outbox record before releasing the database lock. Perform OpenSearch I/O **after** committing/releasing it. Upsert only when that snapshot's version is greater; equal-version bootstrap may fill catalog metadata but must not replace availability. A concurrent newer event cannot be overwritten. Existing missing inventory combinations remain unavailable with version 0 and no invented hold. Bootstrap is repeatable, but its expiry-reconciliation step can legitimately write outbox records; it must share the allocator's locking rules.

**Expiry is not an automatic OpenSearch timer.** Kafka/OpenSearch can lag beyond a deadline, including when the expiry worker is stopped. Product search must use OpenSearch for discovery/typo tolerance, then hydrate the result IDs with current PostgreSQL product prices and **live available quantities** in bounded batches within one short `REPEATABLE READ READ ONLY` transaction and observation time for the response. Product details and PostgreSQL search fallback use that same live formula. Preserve the existing product JSON fields: `stock` now means available-to-purchase units, and `available = stock > 0`. Do not drop candidates based on stale OpenSearch stock. A hold owner's held units are not included in public `stock`; the reservation response is the evidence of that owner's allocation. Product availability responses should use `Cache-Control: no-store`. If PostgreSQL is unavailable, return a standard 503 `DATABASE_UNAVAILABLE` with message `Product availability is temporarily unavailable`, not a stale reservability claim. This proposed availability-failure addition applies after the reservation rollout; it does not change current runtime behavior.

OpenSearch may still be stale for discovery metadata, but it never authorizes reserving or checkout. The expiry worker's target is a one-second polling interval plus outbox/consumer lag, not a guaranteed end-to-end deadline. No Kafka/OpenSearch availability or consumer acknowledgement is inferred from a reservation response or outbox marker. Preserve existing admin definitions: inventory/overview stock metrics remain **physical** PostgreSQL quantity with the existing 1–5 threshold; any future reserved/available admin fields require a separate contract addition. Do not weaken admin authentication to expose reservation monitoring.

### 10.10 Frontend persistence, rollout and planned verification

Keep desired cart items and city buckets in local storage, independent of hold validity. A future versioned cart format may also persist public reservation IDs/deadlines for reconciliation, but never cookie credentials, admin tokens or an assertion that a persisted hold is still active. On reload, create/reuse the browser session and GET reservation state; reconcile IDs/products/cities against the desired cart. Missing session/hold, expired/released status or a lost reservation cookie means “requires a new reservation,” not “remove item” or “restart 30 seconds.” Old cart entries without IDs remain desired but unreserved. Local timers only change presentation; server state decides checkout.

On Add, send create immediately; on subsequent increase/decrease, PATCH the owned active hold without changing its deadline. Disable checkout for pending/unreserved/expired lines; explicit Reserve again uses the create path and cooldown. On successful checkout, remove only purchased desired quantities and clear their hold mappings. On a network timeout, retain cart/key information and reconcile/replay before attempting another checkout. Keep normal order confirmation/history/tracking behavior. Do not cap a hold owner's quantity changes using only public product-card `stock`, which excludes that owner's existing hold.

Implementation is gated off by a proposed `RESERVATIONS_ENABLED=false` default. Enabling it requires the new schema/shared allocator, cookie/Origin/credentialed-CORS wiring, rate-limit secret/counters, checkout compatibility, live availability hydration, both event schema validators, index mappings/bootstrap, expiry worker and the frontend reservation flow. Configuring a 30-second TTL alone does not implement or safely activate the feature. No frontend/backend implementation, environment file, migration or deployment is changed in this task.

Plan these tests before enabling (none are claimed executed by this design):

1. **Real PostgreSQL competing browsers:** isolated physical stock 1, two independent session cookies and distinct keys, concurrent POSTs via `Promise.all`; exactly one 201 and one 409, one live unit held, physical stock still 1 and one committed creation snapshot. Also race a legacy checkout against a reservation and a reserved checkout against expiry/reacquisition.
2. **Expiry without cleanup:** use the real database clock and a 30-second demo TTL, stop the expiry worker, verify no reacquisition before the deadline, zero hold reduction at/after it, immediate availability to another eligible session, and rejection of the original expired checkout without any order or decrement. Repeat with expiry while waiting for an inventory lock.
3. **Cart continuity/refresh:** expired items and per-city desired quantities remain in persisted cart; refresh, GET, repeated Add, same-key retries and quantity PATCH cannot extend expiry. Early release/re-add observes cooldown; a manual new-key reacquisition after eligibility gets a new UUID and deadline.
4. **Valid consumption and release:** checkout before expiry returns the unchanged 201 order shape with server prices, consumes exactly the owned holds and records confirmed tracking history; release/decrease restores only live available units while physical stock is unchanged. Terminal release/replay cannot refund a consumed order.
5. **Multiple items, quantity and city:** duplicate product normalization, caps, partial-stock failure, full-batch rollback, no extra deadline for a new product, same-session tab ordering, explicit old-city release, failed new-city reservation and no cross-city consumption. Verify all physical/nonnegative invariants under concurrency.
6. **Security and idempotency:** missing/foreign/expired cookies, guessed UUIDs, CSRF/Origin/Host failures, cookie flags, log redaction, rejected client TTL/price/user IDs, rate limits across two API instances, credentialed-CORS allowlist, same-key concurrent requests, body/key conflict, deterministic-error replay, lost checkout response, refusal of expired-session replays and session loss.
7. **Real outbox/Kafka/OpenSearch:** each committed creation/update/release/expiry/checkout produces the correct full snapshot; rollback produces no allocation event. Verify eventual projections after the expiry worker resumes, duplicate/out-of-order version rejection, crash-after-ACK duplicates, retry/offset behavior, guarded bootstrap races and version-1-to-2 rollout. With workers unavailable, PostgreSQL-hydrated product availability remains correct; never claim live synchronization without live services.
8. **Regression:** all existing checkout/10-last-unit races, product/filter responses, order details/tracking, admin authentication/local-demo restrictions and physical admin metrics continue passing. Run builds/unit/PostgreSQL integration suites and future reservation tests separately; report live services, skipped tests and migrations actually exercised.

## 11. Retailer Profitability (C8) — Proposed

This section defines a future admin-only feature. Existing routes, checkout requests and replies, stock reservations, and event schemas are unchanged. The [financial and migration design](../backend/docs/retailer-profitability.md) defines transaction, accounting, rollout, and verification rules.

### 11.1 Access, dates, and common validation

- Authorize before data access. Reuse the existing admin JWT gate over HTTPS with a signed `inventory_admin` role. Require a signed `profitability_write` role and a stable verified `sub` for cost writes. Fail closed if the profitability module or required authorization is unconfigured.
- The existing explicitly enabled same-laptop, loopback-only admin demo may read profitability. Cost writes require a separate server-side opt-in, disabled by default, and an exact non-null allowlisted browser `Origin` even on loopback. Keep the existing peer, Host, Origin and forwarding restrictions. Production browser writes also require the exact allowlisted Origin. Only PUT accepts a body, with `Content-Type: application/json` and a 64 KiB maximum. CORS must explicitly allow `PUT` and `If-Match` and expose `ETag` to the configured frontend origin. Return `Cache-Control: no-store` on all responses. Public routes and inventory events never expose private costs.
- Reporting endpoints require `from` (inclusive) and `to` (exclusive) as real `YYYY-MM-DD` business dates in `Asia/Kolkata`. Require `from < to` and at most 366 calendar days. Include confirmed sale cohorts by original order creation date and apply recorded adjustments visible within the response snapshot, even if recorded after `to`. `asOf` is the PostgreSQL observation time. Refunds therefore revise the original cohort when recorded.
- Optional exact `city` is `pune`, `delhi`, or `bengaluru`; omission aggregates across cities. Overview and product list accept optional exact `productId`; detail uses the path ID only. Product IDs are nonblank, case-sensitive strings of at most 100 characters. Reject unknown/repeated query keys, unsupported values, extra body fields, and invalid dates with 400. An unknown filter product returns an empty cohort; a nonexistent path product returns 404.
- Reporting responses are `INR` only. All paise and report margin basis-point values are canonical base-10 strings without a plus sign, redundant leading zero or decimal point. Derived values may be signed; cost-form input amounts are nonnegative, up to `"999999999999"` paise per unit. Counts are nonnegative safe JSON integers. Timestamps are ISO 8601 UTC with `Z` and millisecond precision. Use PostgreSQL exact arithmetic and TypeScript `bigint`; JSON numbers and JavaScript floating point are never authoritative monetary inputs or outputs.

### 11.2 Shared response schemas

Types below describe exact JSON objects. All keys are required unless explicitly marked optional.

```ts
type City = 'pune' | 'delhi' | 'bengaluru'
type Minor = string
type Quality = 'actual' | 'estimated' | 'mixed' | 'unknown'
type Amount = { paise: Minor | null; quality: Quality }
type Margin = { basisPoints: string | null; quality: Quality }
type Metrics = {
  grossSales: Amount
  customerShipping: Amount
  discounts: Amount
  refunds: Amount
  taxCollected: Amount
  taxRefunded: Amount
  netRevenue: Amount
  costOfGoodsSold: Amount
  fulfilmentExpenses: Amount
  paymentFees: Amount
  otherExpenses: Amount
  allocatedOverhead: Amount
  totalCost: Amount
  contributionProfit: Amount
  profitAfterOverhead: Amount
  profitPerUnit: Amount
  profitMargin: Margin
}
type CostBreakdown = {
  procurement: Amount
  retailerShipping: Amount
  packaging: Amount
  labour: Amount
  paymentFees: Amount
  nonRecoverableTaxes: Amount
  allocatedOverhead: Amount
}
type Coverage = {
  orderCount: number
  lineCount: number
  unitsSold: number
  unitsReturned: number | null
  netUnits: number | null
  legacyLineCount: number
  actualProfitLineCount: number
  estimatedProfitLineCount: number
  unknownProfitLineCount: number
}
type Summary = { metrics: Metrics; costs: CostBreakdown; coverage: Coverage }
type Report = {
  asOf: string
  currency: 'INR'
  from: string
  to: string
  timeZone: 'Asia/Kolkata'
  city: City | null
  productId: string | null
}
type TrendPoint = {
  date: string
  netRevenue: Amount
  totalCost: Amount
  profitAfterOverhead: Amount
  orderCount: number
}
type ProductProfitability = Summary & {
  productId: string
  name: string
  category: string
  outcome: 'profitable' | 'loss' | 'break_even' | 'unknown' | 'no_sales'
}
```

Each amount is null with `quality: "unknown"` when a required input is unknown. A computable line metric is actual if all inputs are actual, estimated if all are estimates, mixed if it combines actual and estimated inputs. Aggregate using the same rule across included lines. Unknown values are never silently excluded from aggregates. A mathematically undefined margin/per-unit ratio is null with unknown quality. The three profit line counts partition `lineCount`; the estimated count includes mixed lines. Legacy lines are an overlapping subset. Distinct order counts are scoped to each summary and cannot be summed across individual product rows. A valid empty cohort has actual zero additive totals, zero coverage, and null ratios. Outcome uses full included profit after overhead and its sign; an empty detail is `no_sales`.

### 11.3 Read routes

| Method and path | Query | Success |
| --- | --- | --- |
| `GET /api/admin/profitability/overview` | Required `from,to`; optional `city,productId` | 200 `{report: Report, summary: Summary, trend: TrendPoint[]}` |
| `GET /api/admin/profitability/products` | Same filters plus optional `limit,cursor` | 200 `{report: Report, products: ProductProfitability[], page: {limit: number, nextCursor: string|null}}` |
| `GET /api/admin/profitability/products/:productId` | Required `from,to`; optional `city` | 200 `{report: Report, product: ProductProfitability, byCity: {city: City, summary: Summary}[], trend: TrendPoint[]}` |

Each response uses one consistent read-only PostgreSQL snapshot. Overview and detail trend contain one point for every business date in the requested interval, ascending, including empty days. Detail `byCity` uses Pune, Delhi, Bengaluru order and includes zero-sales cities, or the selected city only. List returns one aggregate per product with at least one included line, ordered by binary ascending `productId`. Reuse section 9.2 keyset rules: default limit 50, range 1–100, opaque cursor at most 2048 characters, bound to filters, sort, limit and authorization scope, 15-minute expiry, null when exhausted. Pages are live observations; there is no exact list count. Unknown amounts render as unavailable. Badges and trends use backend fields, including `outcome`, and do not recalculate totals or fill unknown gaps with zero.

### 11.4 Cost profiles

`GET /api/admin/products/:productId/costs` and `PUT /api/admin/products/:productId/costs` accept only optional `city`. Omit it for the global profile. The path product must exist. A city profile replaces the global profile as a whole, including its explicit unknowns. When no city version is effective, reporting uses the effective global version. The form must distinguish exact scope from fallback.

```ts
type PaymentCost =
  | { method: 'per_unit'; paisePerUnit: Minor }
  | { method: 'rate'; basisPoints: number }
type CostInputs = {
  procurementPaisePerUnit: Minor | null
  retailerShippingPaisePerUnit: Minor | null
  packagingPaisePerUnit: Minor | null
  labourPaisePerUnit: Minor | null
  paymentProcessing: PaymentCost | null
  nonRecoverableTaxesPaisePerUnit: Minor | null
  overheadPaisePerUnit: Minor | null
}
type CostWrite = {
  currency: 'INR'
  effectiveAt: string | null
  costs: CostInputs
}
type CostProfile = {
  productId: string
  city: City | null
  currency: 'INR'
  version: number
  effectiveAt: string
  updatedAt: string
  costs: CostInputs
}
type CostsResponse = {
  productId: string
  city: City | null
  currency: 'INR'
  latest: CostProfile | null
  effective: CostProfile | null
  inheritedEffective: CostProfile | null
}
```

- GET returns 200 with the exact-scope head as `latest`, the version effective at observation time as `effective`, and `inheritedEffective` only when a city has no effective override and a global version is effective. Otherwise those slots are null. An existing product without any profile returns 200 with all three slots null. Both routes return a strong scope-bound `ETag` even for a never-configured scope.
- PUT requires `If-Match` containing the single exact `ETag` from that scope’s most recent GET or PUT. No wildcard or weak validators. It appends a complete immutable version, returning 200 with the same response shape and a new tag. Missing header is 428; a stale or different-scope tag is 412 and the UI reloads before allowing a new save. A lost response is reconciled by GET rather than blindly appending another version.
- In PUT, null `effectiveAt` uses the database write time. Explicit UTC timestamps must be at or after that time, and every version must be strictly later than the previous scope head. A conflicting schedule returns 409. Null cost components are unknown, and explicit zero is a recorded estimate of zero. Rates are integer basis points from 0–10,000. A payment setup uses exactly one method. All editable profile assumptions are estimates until replaced by independently recorded realized costs. `updatedAt` is the database time when that immutable version was recorded.

### 11.5 Errors

Use the standard error envelope in section 6. No raw financial rows, SQL, input bodies, or credential details in errors or application logs.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid path, query, date range, headers or cost fields |
| 400 | `INVALID_CURSOR` | Invalid, expired or incompatible pagination cursor |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired admin identity when required |
| 403 | `FORBIDDEN` | Missing role, disallowed Origin/peer, or demo cost writes disabled |
| 404 | `PRODUCT_NOT_FOUND` | Path product does not exist |
| 409 | `COST_EFFECTIVE_CONFLICT` | Proposed effective time conflicts with an existing version |
| 412 | `COST_VERSION_CONFLICT` | Cost scope's latest version differs from `If-Match` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | PUT body is not JSON |
| 428 | `PRECONDITION_REQUIRED` | Missing `If-Match` on PUT |
| 500 | `INTERNAL_ERROR` | Unexpected backend error |
| 503 | `ADMIN_DISABLED` or `DATABASE_UNAVAILABLE` | Feature/access not configured or authoritative data unavailable |

A protected PostgreSQL failure produces an error, never sample figures. Audit cost writes with product, scope, version and an authorized administrative actor reference. The local demo actor denotes the loopback demo, with no claim of individual user identity.
