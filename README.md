# ShelfSync 🛒

**A multi-city retail storefront powered by real-time inventory synchronization, event-driven architecture, and intelligent product search.**

Built for **Build Bengaluru 2.0**, a 24-hour hackathon.

## Overview

ShelfSync is an e-commerce platform designed for retail businesses operating across multiple cities in India.

It combines city-specific inventory tracking, typo-tolerant product discovery, and concurrency-safe checkout to provide a more reliable online shopping experience.

Our pilot locations are **Bengaluru, Delhi, and Pune**.

## The Problem

Retailers expanding into online commerce face several challenges:

- **Outdated inventory:** Customers may see products as available even after they have sold out.
- **City-specific availability:** A product available in one city may be unavailable in another.
- **Poor search experience:** Traditional keyword searches can fail when customers make spelling mistakes.
- **Overselling:** Simultaneous checkout requests can attempt to purchase the same final unit.

## Our Solution

ShelfSync addresses these problems through three core services:

| Technology | Responsibility |
|---|---|
| Aiven PostgreSQL | Authoritative inventory, products, orders, and transactional consistency |
| Aiven Apache Kafka | Event-driven inventory change propagation |
| Aiven OpenSearch | Typo-tolerant product discovery and city-aware search |

PostgreSQL acts as the **source of truth** for inventory. Kafka propagates committed inventory changes, and OpenSearch maintains a searchable projection of product availability.

## Key Features

### Multi-City Shopping

Customers can select Bengaluru, Delhi, or Pune and view product availability specific to their city.

### Intelligent Product Search

OpenSearch enables typo-tolerant search.

For example, searching `blutooth earphones` can return Bluetooth Earphones.

### Product Filtering

Browse and filter products by:

- City
- Category
- Price range
- Search query

### Shopping Cart and Checkout

Customers can add products to their cart and place orders.

### Concurrency-Safe Inventory

PostgreSQL transactions prevent two customers from successfully purchasing the same final unit.

### Event-Driven Inventory Synchronization

Committed inventory changes are published to Kafka through a transactional outbox and processed by a consumer that updates OpenSearch.

## System Architecture

```text
                 CUSTOMER
                    |
                    v
             REACT FRONTEND
                    |
                    v
               FASTIFY API
                /       \
               v         v
          OPENSEARCH  POSTGRESQL
          (Search)    (Source of Truth)
                          |
                          v
                  TRANSACTIONAL OUTBOX
                          |
                          v
                    KAFKA PUBLISHER
                          |
                          v
                     APACHE KAFKA
                          |
                          v
                     KAFKA CONSUMER
                          |
                          v
                     OPENSEARCH
                  (Inventory Update)
```

**Important:** OpenSearch is eventually consistent. Checkout always validates inventory against PostgreSQL, never against the search index.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Node.js, Fastify, TypeScript |
| Database | Aiven PostgreSQL |
| Event Streaming | Aiven Apache Kafka |
| Search | Aiven OpenSearch |
| Version Control | Git, GitHub |
| Development Assistance | OpenAI Codex |

## Repository Structure

```text
Shelf-Sync/
├── frontend/             # React storefront
├── backend/
│   ├── src/              # Fastify API and services
│   ├── database/         # Migrations and seed data
│   ├── workers/          # Event publisher and consumer
│   └── tests/            # Backend tests
├── contracts/
│   └── api.md            # Shared API specification
├── AGENTS.md             # Codex development instructions
├── README.md
└── .gitignore
```

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Backend health check |
| GET | `/api/products` | Product search and filtering |
| GET | `/api/products/:id` | Product details |
| POST | `/api/orders` | Create an order |
| GET | `/api/orders/:id` | Retrieve order details |

The authoritative API specification is available in [`contracts/api.md`](contracts/api.md).

## Development Workflow

ShelfSync is being developed in parallel using two Codex accounts.

| Branch | Responsibility |
|---|---|
| `main` | Stable integration |
| `feature/frontend` | Frontend implementation |
| `feature/backend` | Backend and infrastructure implementation |

Both agents must follow [`AGENTS.md`](AGENTS.md) and the shared API contract.

Changes are tested before being merged into `main`.

## Getting Started

Clone the repository:

```bash
git clone https://github.com/MehulNegi/Shelf-Sync.git
cd Shelf-Sync
```

The frontend and backend are currently being implemented.

Installation, environment configuration, database migration, and startup instructions will be added as those components become available.

**Infrastructure requirements:**

- Node.js and npm
- Aiven PostgreSQL
- Aiven Apache Kafka
- Aiven OpenSearch

Do not commit credentials, private certificates, or `.env` files.

## Our Signature Demo: The Last-Unit Race

The central technical demonstration shows how ShelfSync prevents overselling.

1. A product has exactly one unit available in Pune.
2. Two customers attempt to purchase it simultaneously.
3. PostgreSQL processes both checkout requests safely.
4. Exactly one order succeeds.
5. The other receives an insufficient-stock response.
6. The successful transaction produces an outbox event.
7. The event is published to Kafka.
8. A consumer updates the OpenSearch inventory projection.
9. The storefront eventually displays the product as out of stock.

This demonstrates transactional consistency combined with asynchronous event-driven synchronization.

## Project Status

**In development — Build Bengaluru 2.0**

The repository architecture and API contract have been established. Feature implementation and infrastructure integration are in progress.

## Future Scope

Potential future enhancements include:

- Additional cities and store locations
- Inventory analytics
- Order tracking
- Customer accounts
- Personalized product recommendations
- Advanced search and merchandising

These are future possibilities, not features included in the initial MVP.

## Team

**Team: comand C-V**

- Mehul Negi
- Umair Shaikh
- Aditya Mishra
- Aryan Sirohi

## Hackathon

**Build Bengaluru 2.0**

Project repository: https://github.com/MehulNegi/Shelf-Sync

---

*ShelfSync — Discover smarter. Shop confidently. Stay in sync.*