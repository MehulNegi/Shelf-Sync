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
