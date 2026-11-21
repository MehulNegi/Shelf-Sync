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
