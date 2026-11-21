# ShelfSync — Codex Project Instructions

## Project Overview

ShelfSync is a multi-city retail storefront developed for the Build Bengaluru 2.0 hackathon.

The system solves:
1. Outdated inventory visibility.
2. Poor product discovery due to spelling errors.
3. Incorrect stock availability across cities.
4. Overselling during concurrent checkout.

## Technology Stack

Frontend:
- React
- Vite
- TypeScript
- Tailwind CSS
- shadcn/ui

Backend:
- Node.js
- Fastify
- TypeScript
- PostgreSQL
- Apache Kafka
- OpenSearch

Managed infrastructure: Aiven.

## Repository Structure

- `/frontend` — React application.
- `/backend` — API, database, workers and tests.
- `/contracts/api.md` — Shared API specification.

## Agent Ownership

### Codex 1 — Frontend

Branch: `feature/frontend`

Allowed to modify:
- `/frontend`

Responsibilities:
- Storefront UI
- City selector
- Search and filters
- Product details
- Cart
- Checkout interface
- Order confirmation
- API integration

Must not modify backend code or shared contracts.

### Codex 2 — Backend

Branch: `feature/backend`

Allowed to modify:
- `/backend`

Responsibilities:
- PostgreSQL schema and migrations
- Product and inventory APIs
- Atomic checkout
- Transactional outbox
- Kafka publisher and consumer
- OpenSearch integration
- Backend tests

Must not modify frontend code or shared contracts.

## Mandatory Rules

1. Read `/contracts/api.md` before implementation.
2. Follow the API contract exactly.
3. Do not modify files owned by the other agent.
4. Do not modify shared contracts without approval.
5. Use TypeScript strict mode.
6. Use environment variables for credentials.
7. Never commit secrets or `.env` files.
8. Run relevant builds and tests after implementation.
9. Prefer small, testable changes over large rewrites.
10. Report blockers and unfinished work clearly.

## Inventory Consistency Requirements

PostgreSQL is the authoritative inventory database.

Checkout must:
- Execute inside a PostgreSQL transaction.
- Prevent overselling under concurrent requests.
- Update inventory, create orders, and write outbox events atomically.
- Roll back on failure.

Kafka is used to propagate inventory changes.

OpenSearch provides typo-tolerant product discovery and city-specific availability.

Inventory events must include a version to prevent stale updates from overwriting newer inventory.

## Hackathon Priorities

Priority 1: Working storefront and API.

Priority 2: Correct concurrent checkout.

Priority 3: Kafka and OpenSearch synchronization.

Priority 4: UI polish, deployment and demo.

Do not add unnecessary features such as payment processing, authentication or recommendation engines unless explicitly requested.

## Definition of Done

A feature is complete only when:
- Its implementation works.
- It follows the API contract.
- Relevant tests or build checks pass.
- It is committed to the correct feature branch.
- Integration requirements are documented.