# Order tracking — additive integration specification

This backend addition is implemented separately from the existing order-details response. `contracts/api.md` is unchanged. The proposed shared-contract addition is the read-only endpoint below; frontend integration can use it without changing existing checkout or order-details parsing.

## GET /api/orders/:id/tracking

The path identifies one order, using the same order ID returned by checkout. There is no order-list endpoint. HTTP 200 returns:

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

The example timestamps illustrate the format. Actual values come from PostgreSQL.

| Field | Meaning |
| --- | --- |
| `orderId` | Persisted order ID. |
| `status` | Current `orders.status`: `pending`, `confirmed`, or `cancelled` for compatibility with legacy records. New successful checkouts are `confirmed`. |
| `createdAt` | Original PostgreSQL order creation timestamp, in UTC ISO 8601. |
| `history` | Persisted observations, oldest first by `recordedAt`, with the database history ID as an internal tie-breaker. |
| `history[].status` | Status observed in that history record. |
| `history[].occurredAt` | PostgreSQL timestamp of a known status occurrence, or `null` when a historical occurrence time is unknown. |
| `history[].recordedAt` | PostgreSQL timestamp when the observation was recorded. This is not a shipment or delivery timestamp. |
| `history[].source` | `order_created` for the initial status recorded atomically with a new order; `legacy_snapshot` for orders that predate history. |

Legacy snapshots have `occurredAt: null`. They describe the status observed during migration, without asserting that the status began at migration time or at order creation. A client must label that time as unknown, rather than infer missing progress.

New orders currently have one genuine `confirmed` entry. The backend does not generate couriers, tracking numbers, shipment dates, delivery estimates, or timed progression.

Missing orders return HTTP 404 using the existing standard envelope:

```json
{
  "success": false,
  "error": { "code": "ORDER_NOT_FOUND", "message": "Order not found" }
}
```

Invalid/oversized path parameters use standard validation errors (including HTTP 414 when the router's parameter length limit is exceeded). Database failures return the standard HTTP 500 `INTERNAL_ERROR` without driver details.

## Compatibility and transition limitation

`POST /api/orders` and `GET /api/orders/:id` retain their existing request/response formats exactly; no tracking fields are added to those responses. The tracking endpoint has the same ID-based access model as existing order details. No authentication system, public order list, or status-update endpoint is added.

There is no suitable authorization mechanism for fulfillment updates. **All status transitions remain disabled**, including direct ordinary SQL updates that would change `orders.status`; a database trigger rejects them. A no-op update to the same status creates no history entry.

Before enabling future transitions, an authorized workflow and a separate migration/contract review are required. That workflow must enforce only `confirmed → processing → shipped → delivered`, record each real transition in the same transaction as the current-status update, and keep historical timestamps intact. None of those fulfillment states is advanced by this feature.

## Deployment

Run `npm run migrate` from `backend/` before deploying the new server. Migration `002_order_tracking.sql` adds the history table and triggers without rewriting existing orders. It briefly serializes order creation while recording the legacy baseline and installing the initial-status trigger. A failed history write rolls back the whole checkout, including inventory, orders/items, and outbox changes.
