# Inventory Command Center: local presentation

The existing `local-demo` mode works only when the API and the presenting browser run on the same laptop. It deliberately allows reads without a Bearer token after validating local access. It is not user authentication: other processes and users on that laptop can also reach it. Use a trusted presentation laptop, close the API afterwards, and do not use shared hosting.

## Start the backend on the presentation laptop

From the repository root, use Node.js 22 or newer:

```sh
cd backend
npm install
npm run build
export ADMIN_AUTH_MODE=local-demo
export HOST=127.0.0.1
export PORT=3000
export NODE_ENV=development
export FRONTEND_ORIGIN=http://localhost:5173
export ADMIN_CURSOR_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
npm start
```

These process environment values override values loaded from the ignored `backend/.env`; no tracked configuration or global authentication default changes. The generation command stores a fresh server-only cursor secret without printing it. Do not use shell tracing (`set -x`), print the environment, or copy secrets into screenshots. Restarting with a different secret invalidates previous pagination cursors; refresh the dashboard traversal.

The ignored `backend/.env` must already contain the real `DATABASE_URL` and, for Aiven's project CA, `DATABASE_CA_CERT_PATH`. Certificate and hostname verification remain enabled. Do not copy credentials or certificates into frontend files. Run `npm run migrate` only if the database has not received the existing migrations; these admin APIs require no new migration. Do not reseed/reset demo data to activate monitoring. Kafka and OpenSearch credentials are not required for admin reads; existing optional OpenSearch configuration can remain in place for public search.

Only `ADMIN_AUTH_MODE`, `ADMIN_CURSOR_SECRET`, `HOST`, `NODE_ENV`, `FRONTEND_ORIGIN`, and the PostgreSQL configuration above are needed to opt in. `PORT` selects the local port (default 3000). JWT variables are not needed for this mode. `HOST` must be exactly `127.0.0.1` or `::1`, `NODE_ENV` must not be `production`, and the frontend origin must be loopback. Never set `HOST=0.0.0.0` for this demo.

## Connect the browser directly

On the same laptop, start the existing Vite frontend from a separate terminal at the repository root:

```sh
cd frontend
VITE_API_BASE_URL=http://127.0.0.1:3000/api npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173`. The browser must use that exact origin, matching `FRONTEND_ORIGIN`. `http://127.0.0.1:5173` is a different origin and is denied unless the backend allowlist is changed to that exact value. Use the API URL directly; do not route demo requests through a Vite proxy, another reverse proxy, SSH forwarding or a tunnel. The only Vite value above is a public API base URL, containing no credentials.

The frontend's Command Center integration should fetch the four contract endpoints with no Authorization header in this explicitly local mode. It must use real responses, retain the existing loading/error shell when access or PostgreSQL fails, use bounded cursor pagination, and never substitute sample metrics. Activation of the backend does not add frontend dashboard components or an authentication-mode switch. No frontend files are changed by this task.

Quick read-only checks from the backend laptop, without displaying response bodies or secrets:

```sh
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'Origin: http://localhost:5173' http://127.0.0.1:3000/api/admin/overview
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'Origin: http://localhost:5173' 'http://127.0.0.1:3000/api/admin/inventory?limit=5'
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'Origin: http://localhost:5173' 'http://127.0.0.1:3000/api/admin/orders?limit=5'
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'Origin: http://localhost:5173' 'http://127.0.0.1:3000/api/admin/events?limit=5'
```

Each should return 200 with a configured, reachable PostgreSQL database. Overview uses the real inventory, Asia/Kolkata order-day window and pending outbox count. Inventory/orders/events return actual persisted rows and may correctly be empty. `published` means the stored outbox publication marker, not Kafka consumer or OpenSearch completion. Normal product and transactional checkout routes keep their existing contracts and still need no admin token; a loopback bind makes those routes reachable only locally for this process too.

## Access restrictions and failures

- No opt-in, missing/weak cursor secret or unsafe configuration: 503 `ADMIN_DISABLED`.
- Allowed local-demo request without a token: 200. This is the explicit local exception, not a global authentication bypass.
- Non-loopback socket peer or Host, mismatched/`null` Origin, or any recognized `Forwarded`/`X-Forwarded-For`/`X-Forwarded-Host`/`X-Forwarded-Proto` header: 403 `FORBIDDEN`. A loopback Host alone cannot override a remote socket peer.
- Invalid query parameters: 400 `VALIDATION_ERROR`; invalid pagination cursor: 400 `INVALID_CURSOR`.
- PostgreSQL unavailable: 503 `DATABASE_UNAVAILABLE`; no fabricated metrics. Health is liveness only.
- In JWT mode, missing/invalid token remains 401 `UNAUTHENTICATED`; a verified identity without `inventory_admin` remains 403. Local-demo is never selected automatically.

The API binds only to loopback and rejects forwarding headers; no LAN/Internet listener, public tunnel or proxy should be created to circumvent that boundary. CORS and an `/admin` URL are not authentication. There are no admin mutation endpoints.

## A browser on a second laptop

It cannot safely access this instance in local-demo mode. `localhost`/`127.0.0.1` on that browser refers to the second laptop, and a LAN URL, changed bind address or relayed request is outside the supported security boundary. Do not use an SSH tunnel or reverse proxy to make a remote request appear local.

For the presentation, use the browser on the backend laptop and share its screen. Alternatively, the second trusted laptop can run its own backend and frontend, both bound to its own loopback interfaces, with PostgreSQL credentials provisioned privately on that backend. That is a separate local stack, not remote access to the first laptop's unauthenticated API.

If remote browser access is essential, the smallest safe change is deployment configuration for the **already implemented JWT mode**, not a new authentication mechanism or relaxed loopback checks: provision a trusted identity provider, configure issuer/audience/HTTPS JWKS URL/algorithm allowlist and cursor secret server-side, require signed `roles: ["inventory_admin"]`, and terminate HTTPS with direct API access restricted to the explicit trusted proxy. Allowlist the exact HTTPS frontend origin. Obtain short-lived access tokens through that provider's supported login flow and retain browser tokens only in memory. No ShelfSync login/token-issuance flow currently exists, so supplying a provider/login integration is a prerequisite. See the admin configuration table in the backend README. Do not deploy local-demo mode while waiting for it.

## Verify and stop

```sh
npm run build
npm test
RUN_DB_TESTS=1 npm run test:integration
```

The local-demo integration test uses a real loopback HTTP listener and verified PostgreSQL connection, with its own random schema and cleanup. It checks all four endpoints, Host/Origin/forwarding restrictions, invalid queries, default-off behavior, unchanged read-only state, and public checkout success/stock-conflict behavior. The suite also retains the existing real PostgreSQL concurrency races. It does not reset or truncate demo inventory.

During B6.1 verification, a temporary loopback-only server also read the configured Aiven demo database using a connection forced into read-only mode. All four admin endpoints returned HTTP 200, with five actual rows sampled from each list and values checked against PostgreSQL; public product search returned HTTP 200. That server was closed after the check. This verifies backend readiness, not a remotely accessible dashboard or a browser UI integration.

Stop the API with Ctrl-C, then clear the temporary settings in its terminal:

```sh
unset ADMIN_AUTH_MODE ADMIN_CURSOR_SECRET HOST PORT NODE_ENV FRONTEND_ORIGIN
```

The ordinary default remains disabled unless the ignored `.env` separately opts in. The presentation commands above do not modify that file.
