# Signed reservation gateway (B14)

B14 keeps the same-origin browser API. With gateway routing enabled, the three cart routes and the exact orders endpoint go to Vercel Node Function entry points that share one handler. Health, catalog, search and order-tracking reads retain the external Render rewrite. Direct access to a function entry point has the same host, Origin, method and metadata checks and a fixed upstream path.

The gateway signs only requests to the configured HTTPS Render origin. It forwards the reservation cookie, excludes unrelated storefront cookies, and preserves the original Origin, JSON bytes and idempotency key. Redirects are blocked, the upstream is never retried automatically, and protected responses are marked no-store. Vercel and Render must redact cookies and gateway assertions from logs and traces. The browser bundle contains neither the signing key nor the assertion.

Fastify verifies a versioned HMAC over issue time, random nonce, audience, method, target, Origin, admitted IP, idempotency key, content type and digests of the cookie and raw body. It checks the proof before application queries. The signed mode ignores Render forwarding headers and disallows combining it with the trusted-peer or loopback exception. Proofs are valid for at most ten seconds with two seconds of forward clock tolerance. After signature and body verification, an atomic, unique nonce insert in the existing rate-limit table prevents exact assertion replay across API replicas. The existing expiry worker deletes nonce rows after one minute. No migration is required. A browser retry receives a fresh assertion and keeps the original cart idempotency key. Exact assertion replay protection does not make a newly signed legacy checkout retry idempotent.

## Settings

Configure independent secrets and an isolated upstream for staging. Keep the production flags and routing at their current values until approval and successful staging.

| Environment | Variable | Value |
| --- | --- | --- |
| Vercel | `RENDER_API_ORIGIN` | Actual allowed HTTPS Render origin |
| Vercel | `VITE_API_BASE_URL` | `/api` |
| Vercel | `RESERVATION_GATEWAY_ROUTING` | `true` when switching the four routes to the gateway |
| Vercel | `RESERVATION_GATEWAY_FRONTEND_ORIGIN` | Exact HTTPS hostname for that deployment, no trailing slash |
| Vercel | `RESERVATION_GATEWAY_VERCEL_VERIFIED` | Set `true` only after verifying the deployed Vercel metadata boundary for that environment |
| Vercel and Render | `RESERVATION_GATEWAY_SECRET` | Same dedicated random key of at least 32 bytes, canonical unpadded base64url, in server-only settings |
| Render | `RESERVATION_SIGNED_GATEWAY` | `true` for the signed-only boundary |
| Render | `RESERVATION_GATEWAY_AUDIENCE` | Exact canonical Render HTTPS origin, no trailing slash, equal to the Vercel destination origin |
| Render | `FRONTEND_ORIGIN`, `RESERVATION_BROWSER_API_ORIGIN` | The same exact HTTPS storefront origin configured at Vercel |
| Render | `RESERVATION_HTTPS_PROXY_IPS` | Unset in signed mode |
| Render | `RESERVATION_TTL_SECONDS`, `RESERVATION_ALLOW_LOCAL_HTTP` | `30`, `false` |
| Render | `RESERVATION_RATE_LIMIT_SECRET`, `INVENTORY_V1_CUTOFF_AT` | Preserve the existing independent rate key and fixed cutoff |
| Render | `RESERVATIONS_ENABLED` | `false` initially, then `true` only in an authorized isolated test or approved production rollout |
| Vercel | `VITE_CART_RESERVATIONS` | `false` initially, then `true` only after the enabled backend is verified |

Keep public admin and B8 disabled. Vercel must expose its platform-provided `VERCEL=1` to Functions. Never define it yourself to simulate provenance. All internal gateway options are server-only and must stay out of `VITE_*`.

## Restricted staging

1. Use a protected, separately configured Vercel site and Render API with isolated PostgreSQL fixtures, Kafka, and OpenSearch. Use the reviewed code and compatible expiry worker. Leave public reservations unchanged. Verify the Vercel edge in the exact target routing setup, with no custom trusted proxy in front. An approved restricted diagnostic can return only pass/fail for whether Vercel-provided host, scheme and both client IP headers match independently known test facts. Send forged and duplicate headers over HTTP and HTTPS from two controlled networks. Require HTTP to redirect or fail before signing, the configured HTTPS host to stay exact, and IP metadata to match the actual networks rather than injected values. Remove the diagnostic. If either IP header is unavailable, differs, or can be forged, leave the verification flag unset and stop.
2. Enable signed routing and verification only for the approved staging environment. Verify all four protected function routes and that catalog, order tracking and readiness bypass the functions. Confirm query strings survive unchanged. Test direct Render requests for both checkout branches and cart calls with missing, forged or replayed proof. Confirm each fails before application writes. Test rotated or mismatched keys fail closed. Confirm the two real client IPs produce separate quota buckets while forged headers cannot change either.
3. With isolated reservations enabled, check in two actual browser profiles that the session cookie is host-only, Secure, HttpOnly, SameSite=Strict and Path=/. Confirm foreign Origin rejection, no-store on success and error, refresh/PATCH without deadline extension, and status, Retry-After and Set-Cookie forwarding. Separate fixtures must prove checkout before expiry, rejection after real 30-second expiry, foreign-session rejection, one winning last-unit reservation, one order and deduction on replayed checkout with the same browser idempotency key, and outbox → Kafka → OpenSearch correlation.
4. Compare the deployed Render and Laptop B database/schema, cutoff, and compatible revisions privately. Check clock sync, nonce cleanup, CDN misses, and cold starts. A cold request can exceed the ten-second proof window on Render Free. It must fail closed. Verify recovery with a fresh request, preserving the same cart operation key when retrying an uncertain mutation. Only request approval for rollout after these checks.

## Rollback

For normal rollback, disable the Vercel cart feature first and leave gateway routing and signed backend protection in place while existing holds finish or expire. Disable Render reservations after draining. Keep the expiry worker and replay cleanup running. In a security incident, disable Render reservations immediately and block gateway traffic if the signing boundary is suspect. Rotate the signing key on both sides before resuming. Keep signed-only mode through rollback unless operators explicitly approve restoring legacy direct checkout. Coordinate any removal of signed-only mode and Vercel gateway routing so checkout cannot silently fall back to an unreviewed transport. Use only a reservation-aware backend release and preserve the cutoff, inventory, and existing idempotency records.

No deployed Vercel or Render qualification has been performed by B14. Routing integration, header provenance and the real staged browser matrix remain mandatory.
