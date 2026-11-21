# ShelfSync 🛍️

**Helping neighborhood shops go online—without losing track of stock or earnings.**

ShelfSync is a full-stack commerce prototype designed around a simple idea: a traditional shopkeeper should be able to sell online, manage inventory across locations, fulfill orders, and understand the money behind each sale without needing to learn complicated software.

Built for a hackathon, ShelfSync combines a customer storefront with a shopkeeper-friendly retailer workspace and a concurrency-safe inventory system.

## Live demo

**Frontend:** https://shelf-sync-tau.vercel.app

> **Deployment status:** The frontend is live on Vercel. The cloud backend and background workers are being prepared. Until they are connected, live catalog data, checkout, reservations, and retailer metrics may be unavailable. The local end-to-end demo remains the reference environment.

## What ShelfSync does

### For customers

- Browse and search products, with city-specific availability.
- Add products to a cart and check out.
- Follow orders through the **My Orders** experience.
- Get short-lived **30-second cart reservations** for limited stock, preventing another checkout from taking the reserved unit while the hold is valid.

### For shopkeepers

- **My Shop:** a straightforward overview of orders and inventory, with quick access to activity.
- **My Products:** search, filter, and inspect stock across cities.
- **Customer Orders:** review recent orders and their statuses.
- **My Earnings:** select products visually, inspect an estimated per-sale gain or loss, see grouped expenses, and try changing discounts and delivery costs.

**My Earnings uses explicitly labeled fictional demo costs**, not verified accounting records. Its product-specific scenarios are editable and kept in browser memory; they do not modify actual prices, orders, or inventory.

## How it works

```text
                    CUSTOMER + SHOPKEEPER
                             │
                       React / Vite
                             │
                        Fastify API
                             │
                ┌────────────┴────────────┐
                │                         │
          PostgreSQL                  Transactional
       orders + inventory               outbox
                │                         │
                │                      Kafka
                │                         │
                └──────────────────► OpenSearch
                                     product search
```

PostgreSQL is the authoritative source for inventory and orders. Inventory changes are published through a transactional outbox to Kafka and projected into OpenSearch. The reservation flow uses database-backed concurrency control so simultaneous checkouts cannot sell the same last unit twice.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS / shadcn-style components |
| Backend | Node.js, TypeScript, Fastify |
| Database | Aiven PostgreSQL |
| Event streaming | Aiven Kafka |
| Search projection | Aiven OpenSearch |
| Frontend hosting | Vercel |
| Backend hosting | Deployment in progress |

## Run locally

**Prerequisites:** Node.js and npm, plus access to the project's configured Aiven services.

```bash
git clone https://github.com/MehulNegi/Shelf-Sync.git
cd Shelf-Sync
npm install
npm --prefix frontend install
npm --prefix backend install
```

Configure the backend environment using the repository's example configuration and your own credentials. Configure `frontend/.env.local` for local development:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:3000/api
VITE_CART_RESERVATIONS=true
```

Once the required backend configuration and database migrations are in place, start the local demo:

```bash
npm run demo
```

- Storefront: http://127.0.0.1:5173
- Retailer workspace: http://127.0.0.1:5173/#/admin
- My Earnings: http://127.0.0.1:5173/#/admin/profit-os

`npm run demo` starts the frontend, API, outbox worker, inventory worker, and reservation-expiry worker. It is a **local development command**, not a production deployment command.

> **Security:** Never commit `.env` files, database URLs, credentials, or certificates. Local-demo admin authentication and loopback-only HTTP reservation settings are **not suitable for public deployment**. Do not reset or reseed a shared database, or apply pending migrations, without reviewing the rollout plan.

## Reliability and testing

ShelfSync includes automated frontend and backend tests, including isolated PostgreSQL integration tests for concurrent checkout and reservation expiry. The development team has exercised last-unit checkout races and the 30-second reservation lifecycle. For current results, run the test commands against your checked-out revision:

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix backend run build
npm --prefix backend test
```

## Current limitations

- The public frontend is deployed; cloud API and worker deployment is still in progress.
- The retailer earnings tool models **per-sale contribution**, not audited net profit or guaranteed business outcomes.
- Product-specific demo costs are illustrative and are not saved to the backend.
- A profitability backend foundation exists, but its persistent cost-profile feature is disabled pending reviewed migration, financial policy, and production authorization.

## The idea behind ShelfSync

For a first-time online retailer, the important questions aren't “What is my event-stream topology?” or “What is my contribution margin formula?” They're:

1. **What did customers order?**
2. **Do I have enough stock?**
3. **Will I earn money if I sell this product?**

ShelfSync keeps the technical complexity behind the scenes and puts those questions front and center.

---

**Built for a hackathon.** ShelfSync is a working prototype, not a production-ready financial or commerce service.
