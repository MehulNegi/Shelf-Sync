# ProfitOS backend foundation (B8)

This implements the persistent foundation from C8/C8.1. F14 remains the independent frontend-only simulator; its demo assumptions/calculations are unchanged. No migration or deployment is run automatically against shared Aiven infrastructure.

## Implemented API

Exact JSON shapes, filters and errors are in shared contract section 11:

- `GET /api/admin/products/:productId/costs`
- `PUT /api/admin/products/:productId/costs`
- `GET /api/admin/profitability/overview`
- `GET /api/admin/profitability/products`
- `GET /api/admin/profitability/products/:productId`

The module defaults off with `PROFITABILITY_ENABLED=false`. Enabling it requires the existing configured admin authorization and a separately reviewed/applied migration 004. Missing configuration fails closed with `ADMIN_DISABLED`. Reports are read-only PostgreSQL snapshots; use required `from,to` business dates in Asia/Kolkata, inclusive/exclusive, maximum 366 days. Product lists use the existing integrity-protected 15-minute keyset cursor, default 50/max 100, bound to filters/limit/authorization scope. Results and date trends are computed from persisted confirmed orders or confirmed history, not OpenSearch, inventory events or current prices.

JWT reads require the existing verified `inventory_admin` role. PUT also requires signed `profitability_write`, a stable verified subject, the exact allowlisted non-null browser Origin, JSON and one strong `If-Match` tag. Unverified role headers have no effect. Actor audit references hash verified issuer/subject, without storing the JWT. Local-demo reads retain the real loopback peer/Host/Origin and no-forwarding gate. Local writes additionally require `PROFITABILITY_DEMO_WRITES_ENABLED=true`; the audit actor is explicitly `local-demo`, not an individual identity. This does not permit LAN/tunnel/proxy exposure. All finance responses are `no-store`; cost-route CORS explicitly allows PUT/If-Match and exposes ETag. Request logs/errors never contain bodies, cost rows, tokens or SQL.

GET cost responses distinguish exact-scope `latest`, currently `effective`, and `inheritedEffective`. A city profile replaces the global profile completely, including nulls. Future city versions fall back globally only until a city version is effective. PUT appends immutable versions under a per-product/scope lock. GET/PUT supply a scope-bound strong ETag even at revision zero; missing If-Match is 428, stale/cross-scope 412, conflicting effective schedules 409. First-create races yield one successful revision. Null effective time uses the database clock after locking; explicit times must be prospective and strictly later than the preceding scope head. Lost responses are reconciled through GET rather than blindly retrying a save.

Cost forms accept INR only and canonical integer-paise strings from zero to 999999999999, or null for unknown. Explicit zero is an estimate, not proof of an absent expense. Payment assumptions choose a per-unit amount or integer basis-point rate. No new fee, discount or tax is inferred from sales/inventory rows.

## Additive migration and deployment

`004_profitability.sql` adds cost scopes/versions, immutable order/item snapshot storage, guards and indexes. It does not rewrite/backfill orders, alter inventory/reservations/outbox, install a checkout trigger, or create settlement/refund workflows. Money in bounded columns is PostgreSQL bigint; captured component values are validated canonical paise strings with explicit provenance quality. Existing stable order-item IDs and transactional guards verify source order, product, quantity and recorded sale price without adding an index/rewrite to existing order tables. Frozen records reject updates/deletes.

The migration is tested only in generated isolated PostgreSQL schemas. **A shared database migration is required before enabling B8, and has not been run by this task.** An operator must review the new-table FK lock window, backup/access/retention requirements and target schema, then explicitly run from `backend/`:

```sh
npm run migrate
npm run build
npm start
```

Use protected server environment configuration for the two flags and the existing admin/JWKS/cursor settings. There is no new dependency or credential. Never enable finance access by putting a secret in Vite or by weakening the existing admin gate. Disabling the module leaves history intact; do not delete tables as rollback.

## Exact calculation model

The deterministic module uses TypeScript bigint for every monetary operation. Money output and margin basis points are canonical decimal strings. It applies signed half-away-from-zero rounding only at ratio/rate boundaries; aggregate component paise before computing ratios.

```text
netRevenue = grossSales + customerShipping - discounts - refunds
fulfilment = retailerShipping + packaging + labour
contribution = netRevenue - procurement - fulfilment - paymentFees - nonRecoverableTaxes
totalCost = procurement + fulfilment + paymentFees + nonRecoverableTaxes + allocatedOverhead
profitAfterOverhead = netRevenue - totalCost
netUnits = soldUnits - verifiedReturnedUnits
profitPerUnit = round(profitAfterOverhead / netUnits), if netUnits > 0 and known
profitMarginBasisPoints = round(profitAfterOverhead * 10000 / netRevenue), if netRevenue > 0 and known
```

Pass-through tax collected/refunded is reported separately and excluded from revenue/cost. Customer shipping revenue is separate from carrier expense. Charge normalization deducts merchandise/shipping discounts and refunds once, enforces the corresponding paid-charge caps, and never infers returns or procurement recovery from a refund. Largest-remainder allocation preserves signed totals, supports caps and quantity fallback, and breaks ties by ascending numeric order-item ID. The engine accepts normalized financial inputs; no source-ingestion/refund endpoint exists.

Unknown required inputs propagate to null/unknown totals; known components can remain visible, but partial lines are never silently omitted from an aggregate. Estimated/mixed provenance propagates. Empty cohorts have actual zero additive totals and null ratios. Negative contribution/profit is valid. Coverage exposes actual/estimated-including-mixed/unknown profit lines and overlapping legacy counts. Distinct order counts cannot be summed across products. These are contribution/allocated-overhead calculations, not audited net profit.

## Historical snapshots and policy gate

`captureOrderFinancials(client, orderId)` is implemented and tested, but **not connected to checkout**. C8.1 explicitly leaves sale-era tax inclusion, booked-revenue classification and authoritative fee/refund/source coverage unresolved. No approved policy was supplied during B8. There is deliberately no environment switch that silently decides those facts or activates capture.

The prepared module requires an explicit caller transaction and an order inserted/confirmed in that transaction. Database guards prevent it from backfilling older orders. It reads applicable city/global profiles for all lines using one MVCC statement and database decision time, stores exact recorded charged unit price and quantity, selected immutable profile ID/method, estimated costs, and unknown revenue/tax/adjustment/return coverage. Rates without a proven fee-bearing base stay unknown. Repeated capture is a no-op. Later profile/catalog edits cannot change frozen data. Structural failure is rethrown so a future enabled confirmation transaction must roll back. No external call is made.

The current snapshot schema labels the pricing policy `unresolved` and requires gross sales to remain unknown. It cannot classify actual tax-exclusive revenue merely because checkout stores a price. Existing/new checkout paths remain unchanged and consequently appear as legacy/incomplete until a separately approved capture rollout. Legacy reporting never joins today's cost profile onto old orders or invents zero fees/refunds/shipping/tax. Stored charged prices remain intact in the original orders/items.

Before capture activation, finance must establish the documented pricing/coverage policy and confirm the atomic failure/retention rollout. A separate reviewed migration/capture integration can then implement that approved policy consistently for all writers. Verified adjustments/settlements and coverage registry remain deferred until an authoritative workflow exists. No automatic status-based refund/restock is added.

## Explicit scope limitations

- B8 requested marketing attribution, but C8 supplies no marketing field and defines other expenses as non-recoverable taxes only. Marketing is not silently added to that field or the public API; it needs a future contract addition. Currency is INR only, as contracted.
- Procurement/FIFO/lot allocation and realized-cost evidence remain unresolved. Editable unit costs are estimates; this foundation does not choose a costing method.
- Reports over current unclassified sales accurately expose counts and unknown financial values. They do not claim verified profit. Reports fetch in 500-line batches but materialize each bounded date cohort in application memory; production volume/lock-budget review remains a gate before enabling this MVP module at scale.
- No shared migration, checkout capture, deployment, customer data feed, AI/LLM integration or frontend simulation change is performed.

## Verification

```sh
npm run build
npm test
RUN_DB_TESTS=1 npm run test:integration
```

Unit tests cover the C8 normalized 78000 net revenue / 25700 contribution / 22700 profit vector, exact large monetary values, losses, zero/unknown inputs, taxes, delivery versus carrier cost, discount/refund caps, signed rounding, allocations, date/field validation, JWT/write authorization and local-demo restrictions. PostgreSQL tests use isolated random schemas and cover migration repeatability, precise costs/immutability, concurrent first writes, scheduled/city scopes, actor auditing, IST cohorts, legacy unknowns, keysets, frozen snapshots, rollback, database failures and no public/event cost exposure. Existing checkout/reservation/tracking/admin/publisher suites run separately in the same integration command. Their fixtures never reset/reseed shared inventory or real orders.
