# B8.1 — Product-specific profitability readiness for F15

This is an integration and deployment handoff, not activation instructions to run during development. B8's existing endpoints are verified in isolated tests; that does not prove migration 004, authentication or feature flags are configured in a shared environment. No `.env` file, shared database, checkout/capture switch, frontend calculation or running service is changed by B8.1.

Read the shared API contract, section 11, and [B8 implementation/policy gates](profitability-implementation.md) together with the original [profitability design](retailer-profitability.md). The design's proposed/unimplemented headings are not deployment status. Runtime financial behavior still follows the unresolved-policy restrictions below.

## Product identity and supported costs

Use the catalog's exact case-sensitive `product.id`, not a name, array index, category or new profitability-specific identifier. Catalog selectors can use the existing public `GET /api/products?city=...` and `GET /api/products/:id?city=...` responses. The checked-in catalog identifies Wireless Bluetooth Earphones as `prod_001` and Lightweight Running Jacket as `prod_007`; fetch the current catalog rather than hardcoding a complete selector list. Public prices are current INR rupees, not private paise costs or historical tax-exclusive revenue. No private costs are added to public products.

Both catalog and profitability use `pune`, `delhi`, `bengaluru`. Cost scope is `(productId, city)` or `(productId, global)` when city is omitted. Each scope has its own immutable version sequence and ETag. A version or ETag from earbuds, another city or the global scope cannot authorize a jacket/city write.

| Expense | Exact `costs` field | Representation |
| --- | --- | --- |
| Procurement | `procurementPaisePerUnit` | Nonnegative integer-paise string or null |
| Retailer shipping allocation | `retailerShippingPaisePerUnit` | Per-unit expense, separate from customer delivery revenue |
| Packaging | `packagingPaisePerUnit` | Per-unit string or null |
| Labour | `labourPaisePerUnit` | Per-unit string or null |
| Payment processing | `paymentProcessing` | Null, `{method:"per_unit",paisePerUnit:"..."}`, or `{method:"rate",basisPoints:...}` |
| Non-recoverable retailer taxes/duties | `nonRecoverableTaxesPaisePerUnit` | Separate from pass-through tax collected/refunded |
| Allocated overhead | `overheadPaisePerUnit` | Separate from contribution profit |
| Marketing attribution | **Not defined by C8** | Keep F14/F15 modeled marketing assumptions separate; no persistent field exists |

All seven supported input keys are required. Currency is INR only, per-unit amounts range from `"0"` to `"999999999999"`, and rate basis points are integers 0–10,000. Null means unknown. Explicit zero is an entered estimate, not verified absence of an expense. Do not put marketing into tax/overhead fields to bypass the contract. No unsupported backend field was added.

## Existing API integration

All paths below include `/api`. URL-encode product IDs. Pass `city` only when selecting an exact city scope; omit it for global costs or all-city analytics.

| Existing endpoint | Request/response details |
| --- | --- |
| `GET /api/admin/products/:productId/costs?city=pune` | No body. Response: `productId,city,currency,latest,effective,inheritedEffective`; read the scope's response `ETag` header. A valid product without costs has null profile slots and still has a tag. |
| `PUT /api/admin/products/:productId/costs?city=pune` | JSON `CostWrite`, exact `If-Match` from that same scope; 200 returns the same response shape and a new ETag. Appends a version; never overwrites history. |
| `GET /api/admin/profitability/products/:productId?from=2026-01-01&to=2026-02-01&city=pune` | Response: `report,product,byCity,trend`. Detail accepts city/date filters only; do not repeat `productId` as a query parameter. |
| `GET /api/admin/profitability/overview?from=...&to=...&productId=prod_001&city=pune` | Response: `report,summary,trend`. Include `productId` when the view is product-specific. |
| `GET /api/admin/profitability/products?from=...&to=...&productId=prod_001&city=pune&limit=50` | Response: `report,products,page`. Only sold products in the cohort appear; this is not a catalog picker. |

Dates are real YYYY-MM-DD business dates in Asia/Kolkata: from is inclusive, to exclusive, with a maximum 366-day interval. Lists default to 50, allow 1–100 and sort by binary product ID ascending. Pass `page.nextCursor` unchanged with the same filters/limit, or restart without it. Cursors expire after 15 minutes and are bound to authorization scope. Unknown valid filter IDs give empty cohorts; a nonexistent path product is 404. Repeated/unknown query keys and unsupported city IDs are 400.

### Load, display and save a cost scope

1. GET the selected product/city scope. Store its ETag alongside that exact product/city cache key. Do not reuse the global tag when creating a city override.
2. Show `effective` as the current exact-scope profile. If it is null, show `inheritedEffective` as explicit global fallback. Show `latest` separately when it is scheduled for the future. A city override replaces the **whole** global profile, including unknowns: never fill a null city procurement amount from the global value or a different product.
3. Keep an unsaved draft separate from server data and simulation assumptions. All profile inputs are estimates. Blank/unknown input stays null; do not silently submit zero. Persist only retailer-confirmed, contract-supported fields.
4. PUT to the same scope with `Content-Type: application/json`, `If-Match: <exact quoted ETag>` and the existing runtime admin authorization. Use `effectiveAt:null` for immediate database-time activation. This is the complete shape, with unknown placeholders rather than fabricated expenses:

```json
{
  "currency": "INR",
  "effectiveAt": null,
  "costs": {
    "procurementPaisePerUnit": null,
    "retailerShippingPaisePerUnit": null,
    "packagingPaisePerUnit": null,
    "labourPaisePerUnit": null,
    "paymentProcessing": null,
    "nonRecoverableTaxesPaisePerUnit": null,
    "overheadPaisePerUnit": null
  }
}
```

5. Replace the scope's cached response/tag only after success. A 412 means reload/reconcile while retaining the draft; never automatically overwrite using a new tag. A 428 means the tag was missing. Future versions must be strictly later than the current scope head; 409 is a schedule conflict. No reschedule/withdraw/delete endpoint exists. After a lost response, GET before attempting another save.
6. On product/city changes, cancel or disregard stale in-flight responses and clear only the prior selection's draft/cache association. Backend isolation cannot prevent a UI from rendering a late earbuds response under a jacket title.

### Authorization and browser headers

Use the existing trusted identity-provider access token at runtime in `Authorization: Bearer ...`, over the approved HTTPS deployment, never a hardcoded secret or `VITE_*` credential. Reads require signed `inventory_admin`; PUT additionally requires signed `profitability_write` and a stable verified subject. There is no new login/token-issuance endpoint. Keep tokens in memory, not local storage or logs. Admin requests do not use the customer reservation cookie; existing admin fetch behavior can keep `credentials:'omit'` and `cache:'no-store'`.

The browser supplies its real Origin; do not spoof it or add proxy forwarding headers in frontend code. PUT requires the exact configured non-null Origin, JSON and If-Match. The cost-route CORS configuration allows PUT/If-Match and exposes ETag. The existing explicit loopback-only admin demo may read; writes need a separate protected server-side opt-in. B8.1 does not set that opt-in. Never extend local-demo access to a second laptop through LAN/tunnels/proxies.

Handle 401/403 as authentication/authorization failures, 400 as validation or invalid cursor, 404 as missing product, 409/412/428 as the edit conflicts above, 415 as a non-JSON request, and 503 `ADMIN_DISABLED`/`DATABASE_UNAVAILABLE` as unavailable persistent access. Preserve drafts where appropriate. Do not substitute sample costs or report zero profit after an error.

## Historical analytics versus modeled scenarios

Render backend `metrics`, `costs`, `coverage`, `outcome`, `byCity` and `trend`; amounts contain `paise` and `quality`, margins contain `basisPoints` and `quality`. Format decimal strings without using floating point for authoritative money. Contribution excludes allocated overhead; `profitAfterOverhead` and `profitMargin` include it. Pass-through taxes are separate, customer shipping is revenue, retailer shipping is an expense. These are contribution/allocated-overhead measures, not audited net profit.

An all-city detail intentionally sums only the selected product across cities; select city for one-city results. Overview without a product filter intentionally covers all products. Unknown required inputs make their dependent totals null/unknown; do not sum only known rows, fill chart gaps with zero, or label an incomplete result verified profit. Empty cohorts do have actual zero additive totals and `no_sales` in detail. Check `legacyLineCount` and actual/estimated/unknown profit-line counts.

Automatic checkout financial capture is not connected. Existing confirmed sales remain legacy/incomplete where cost/tax/coverage evidence is absent, even if today's profile is complete. The isolated capture module freezes selected versions and charged prices, but keeps revenue unknown under the unresolved pricing policy. Loading or editing a current profile does not backfill a sale. F15 may use retailer-entered/current profile assumptions for a clearly labeled modeled scenario; keep that state/output separate from historical reports and preserve F14 calculations. No modeled change may mutate checkout, sale price, inventory, reservations or financial history.

## Migration 004 review and future operator checklist

The existing file is unchanged. It creates four new tables (`product_cost_scopes`, `product_cost_versions`, `order_financial_snapshots`, `order_item_financial_snapshots`), new-table indexes, FKs/checks and guards. There is no reset, seed, historical INSERT/backfill, table drop/truncate or rewrite of commerce tables. DELETE/UPDATE mentions are immutability guards and privilege revocation on the new tables, not destructive data operations. No trigger is installed on checkout/orders. The runner applies it once under the existing migration ledger/advisory lock and checks prior checksums; raw SQL replay is not the repeatability mechanism.

B8.1 tests a populated isolated pre-004 database with existing products, inventory, orders/items/history, a reservation/session and an outbox event. Applying 004 through the actual runner must preserve every original row, create empty financial tables, and return zero applied migrations on the second call. That establishes schema/data compatibility in isolation, not approval for a live lock window or proof of live migration status.

Future operator checklist — **not executed by B8.1**:

- Confirm target database/schema, PostgreSQL version, expected 001–003 migration ledger/checksums and whether 004 already exists. Stop if schemas/checksums or untracked partial objects disagree; do not edit applied migrations or force them through.
- Review the unchanged 004 SQL, DB role/function privileges, backups, audit/retention requirements and FK dependency/lock window on catalog/order tables. Use a controlled deployment window with a bounded lock plan. Indexes are on the new empty financial tables; no new existing-table unique index is required.
- Keep profitability flags/access off. After explicit approval, a deployment operator may run the existing `npm run migrate` from backend against the verified target. Do not run seed/reset commands or raw-replay 004. No shared migration command is run in this task.
- Verify the ledger records 004, expected tables/guards exist, and original catalog/inventory/orders/reservations/outbox remain unchanged. Repeat the runner only through the normal ledger-aware process when appropriate.
- Validate approved admin configuration, exact browser Origin, role/subject requirements, private responses and conflict handling before a separate decision to enable persistent costs. Test demo-write opt-in only on the permitted trusted laptop; do not turn it on merely to hide an unavailable shell.
- Resolve tax/invoice treatment, pricing/revenue classification, realized-cost/settlement/refund coverage and costing policy before representing real historical profitability or integrating automatic capture. Current snapshot schema intentionally keeps gross revenue unknown; no flag alone can resolve that.
- Roll back access by disabling the module, not by deleting audit history. Commerce, inventory events and search mappings need no profitability-induced change.

## Readiness evidence and remaining gates

New isolated tests cover actual catalog IDs/names, independent complete fields, cross-product ETag rejection, city unknown/zero/fallback/future versions, product-filtered overview/list/detail, multi-city totals, historical version isolation, stale-write concurrency, populated migration compatibility and unchanged commerce rows. Pure normalized fixtures separately verify exact per-product contribution/margins, overhead/tax/delivery separation and unknown payment bases; they are not production financial records.

No critical runtime change was needed for B8.1. Remaining gates are shared migration review/application, approved admin/cost-write activation, financial policy/source decisions, and future F15 API integration. Marketing needs an explicit future contract addition. Production report-volume review remains required because the bounded date cohort is currently materialized in application memory. This task makes no claim that shared B8 is enabled, deployed or populated.
