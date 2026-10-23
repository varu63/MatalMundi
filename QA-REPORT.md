# MetalMundi — QA / Performance / Security test report

Run date: 2026-10-23. Tester: agent acting as QA + performance + security + full-stack.
Everything below was actually executed; raw evidence paths are listed per section. No number here is estimated.

## 1. Architecture and environment under test

| Layer | Implementation found by inspection |
| --- | --- |
| API | Express (CommonJS) `server/src`, mounted at `/api/v1`, port 5000 (dev/prod parity: the same process serves `client/dist`) |
| Client | React 18 + Vite SPA `client/src`, dev server 5173 with `/api` proxy; committed production bundle in `client/dist` |
| DB | PostgreSQL 16 in Docker container `metalmundi`, accessed only through Prisma 6.19.3 |
| Auth | httpOnly `mm.token` JWT cookie + double-submit `mm.csrf` → `x-csrf-token`; roles `USER` / `SELLER` / `ADMIN` enforced server-side |
| Money | integer paise everywhere; totals recomputed server-side, never trusted from the client |
| Response shape | `{success, message, data, meta}`; errors normalised in `server/src/middleware/error.js` |

Databases used (strict separation, no production writes anywhere in this run):

- `metalmundi` — local dev data; only QA-harness-created rows touched, then cleaned by `scripts/e2e-cleanup.js`.
- `metalmundi_test` — Jest suites (auto-created, `DELETE`-only isolation, `--runInBand`).
- `metalmundi_load` — load harness only (`scripts/seed-load.js` fixtures).
- Render production (`matalmundi.onrender.com`) — read-only header/config verification, zero load, zero writes.

Test stack used for load work was a **separate API process on :5100** (and :5110/:5120 for rate-limit demonstrations) so the interactive dev stack on :5000 stayed usable.

## 2. Automated suites (all re-run after the final fixes)

| Suite | Tests | Result |
| --- | --- | --- |
| 17 server Jest suites (`server/tests`) | 172 | **172 passed, 0 failed** (583.2 s, exit 0) |
| 4 client Vitest+RTL files | 31 | **31 passed** (7.6 s) |
| `scripts/e2e-browser.mjs` (Playwright, 5 real roles) | 24 checks | **24 passed, 0 failed** |
| `scripts/e2e-perf.mjs` (Playwright timings) | 12 page loads + 3 interactions | ran, results below |

New suites added by this effort: `security.test.js`, `concurrency.test.js`, `inspectionWorkflow.test.js`, `marketplaceNearby.test.js`, `errorMapping.test.js`, `envGuards.test.js`.
Evidence: `server/tests/full-suite-after-fixes.log`, `scripts/browser-evidence/browser-e2e-2026-10-23T11-25-01-210Z.json` (+ PNGs).

## 3. Functional / E2E coverage (browser, real backend)

Visitor → register (valid + duplicate + invalid) → login (valid + wrong password) → browse/search/filter/paginate → listing detail → cart → purchase request → seller queue → admin accept → schedule → start → pass inspection → admin-entered delivery charge → buyer confirm → dispatch → deliver → complete, with DB state asserted after every UI success message.

Role visibility, refresh persistence, direct-URL entry, and history behaviour were verified per role. Failure injection covered: API down, slow API, malformed 200, injected 503 (`DB_UNAVAILABLE`) + working Retry, session expiry mid-operation, logout + back button.

Notable confirmations:
- Server-side buyer-address privacy: the seller's order payload contains **no** street address or phone before buyer confirmation, and contains them after release — verified on the actual JSON, not just the UI.
- Admin-entered delivery charge reprices correctly: `total = materialSubtotal + tax + 150000 paise`, status moves to `AWAITING_BUYER_CONFIRMATION`.
- Expired session during an operation lands on login; no fake success toast.
- No order is ever marked paid — the app has no payment gateway and the workflow keeps a manual dispatch gate.

## 4. Concurrency and race results

Targets: parallel logins, N buyers on one listing, final-quantity reservation, simultaneous admin updates, many sellers submitting, double-clicked submits, parallel search/filter/sort/paginate, admin editing while another views.

Findings and outcome:

| Race | Result |
| --- | --- |
| 10 buyers reserving the last kg of one lot | exactly one 201, rest 409; no negative `availableQuantityKg`, no oversell |
| Repeated/double-clicked submit with same `Idempotency-Key` | second call 409, one order row only (`Order.idempotencyKey @unique`) |
| Two admins writing different inspection steps on one order | **was inconsistent** (order mirror `PASSED` while inspection row `IN_PROGRESS`) → fixed, now converges |
| Concurrent auction bids | highest bid wins, no lost update |
| Parallel status transitions | compare-and-swap `transitionById` rejects stale transitions with 409; no impossible status |
| Lot invariant after every concurrent run | `reserved + available == total` for all lots (`lotsInconsistent: 0`) |

No fix relies on hiding/disabling a frontend button — all enforcement is in the transactional layer.

## 5. Performance results (closed-loop Node/worker_threads harness)

Provisional thresholds (no SLA exists for this deployment, these are working targets for a single local node): **p95 ≤ 800 ms overall, server-error rate ≤ 1 %**.

### 5.1 Read-only ramp, staging API :5100, `metalmundi_load`, 20 s per level

| VUs | Requests | RPS | 4xx | 5xx | transport | p50 ms | p95 ms | p99 ms | max ms | PG backends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 448 | 121.8 | 0 | 0 | 0 | 7.0 | 11.3 | 13.1 | 26.9 | 13 |
| 10 | 9 440 | 466.7 | 0 | 0 | 0 | 16.5 | 32.4 | 38.3 | 61.6 | 13 |
| 25 | 9 479 | 463.5 | 0 | 0 | 0 | 39.3 | 87.2 | 100.3 | 149.2 | 13 |
| 50 | 9 399 | 462.9 | 0 | 0 | 0 | 78.5 | 177.9 | 198.3 | 280.4 | 13 |
| 100 | 9 116 | 445.8 | 0 | 0 | 0 | 163.1 | 374.5 | 422.2 | 487.5 | 13 |

39 882 requests, **0 × 4xx, 0 × 5xx, 0 transport failures**. Throughput plateaus at ~460 rps from 10 VUs onward while latency grows linearly — the Prisma connection pool (backends pinned at 13 at every level) plus single-node CPU is the bottleneck, not the DB. At 100 concurrent VUs p95 is 374 ms, inside the provisional target.

Egress at 100 VUs was 1 773 019 B/s. The `server.rssMb` sampler needs `LOAD_SERVER_PID`, which was not passed for these post-fix runs, so memory is reported only from the earlier single-level run where RSS held at ~283 MB — treat the RSS column as partial coverage, not a curve.

### 5.2 Write-heavy ramp (same stack, `order-create` in the mix)

| VUs | Requests | RPS | 4xx/5xx | p50 | p95 | p99 | max | order-create calls / failures | PG backends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 6 050 | 298.8 | 0 / 0 | 17.5 | 116.6 | 140.7 | 208.2 | 806 / 0 | 13 |
| 25 | 6 550 | 321.5 | 0 / 0 | 45.0 | 139.2 | 343.5 | 472.7 | 931 / 0 | 14 |
| 50 | 6 988 | 343.0 | 0 / 0 | 89.6 | 258.0 | 341.8 | 889.5 | 1 016 / 0 | 17 |

19 588 requests including 2 753 real order creations (transactional inventory reservation) with zero failures and all lot invariants intact afterwards. 746 harness orders were removed by the harness cleanup; `scripts/e2e-cleanup.js` then reported `lotsInconsistent: 0`.

### 5.3 Rate limiting under overload (shipped limits, :5120, 25 VUs, writes, 15 s)

27 279 requests, 1 775.6 rps, **`200×707 · 201×92 · 429×26480`**, 0 × 5xx, 0 transport errors.
The limiter sheds load cleanly instead of degrading: `apiLimiter` 1000/15 min/IP, `writeLimiter` 120/min/IP. Read-only overload run (:5110) behaved the same: 52 387 requests, 100 % 4xx, **0 server errors**.

### 5.4 Frontend load and interaction timings (`scripts/e2e-perf.mjs`, Chromium, fresh context per page)

Production bundle served by the API (:5000 — the same artifact Render serves):

| Page | cold ready | warm ready | cold LCP | TTFB | HTML bytes |
| --- | --- | --- | --- | --- | --- |
| landing | 237 ms | 218 ms | 224 ms | 2 ms | 920 |
| marketplace | 337 ms | 233 ms | 264 ms | 1 ms | 920 |
| login | 187 ms | 194 ms | 156 ms | 1 ms | 920 |
| register | 218 ms | 197 ms | 196 ms | 1 ms | 920 |

| Interaction | API round trip | DOM settle | total | status |
| --- | --- | --- | --- | --- |
| marketplace search ("steel" + Enter) | 52 ms | 262 ms | 319 ms | 200 |
| marketplace category chip | 56 ms | 258 ms | 318 ms | 200 |
| open listing detail | 62 ms | 260 ms | 324 ms | 200 |

Vite dev-server numbers were also captured (`perf-2026-10-23T11-40-35-180Z.json`); its first-ever hit on a route showed 2 876–2 900 ms for `/login`, which is on-demand module transform, not user-visible behaviour in production — the production table above is the one to quote.

Evidence: `scripts/load-results/load-20261023T11*.json`, `scripts/browser-evidence/perf-2026-10-23T11-41-13-360Z.json`.

## 6. Security testing findings

Verified by `server/tests/security.test.js`, `permissions.test.js`, `rateLimit.test.js`, header/config probes, and a scan of the committed bundle.

Passed:
- Unauthenticated `/api/v1/*` protected routes → 401; role-gated admin/seller routes → 403 for the wrong role (RBAC is server-side; the SPA route guards are cosmetic only).
- Cross-user object access (IDOR) on orders, submissions, my-orders, seller dashboards → 403/404; no enumerable leakage.
- Tampered / expired /_alg=none / wrong-secret JWTs rejected; `mm.token` is httpOnly, `SameSite=Lax`.
- CSRF: missing or wrong `x-csrf-token` on unsafe methods → 403 (`timingSafeEqual` compare).
- SQL injection: Prisma parameterised queries; payload probes (`' OR 1=1 --`, stacked queries, time-based) produced no error, no data change, no dump in responses.
- XSS: user-supplied strings render through React text nodes; no `dangerouslySetInnerHTML` on request data; CSP present.
- Headers confirmed on the API: CSP, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`.
- Uploads: non-image types and oversized files rejected (`MulterError` → 400 `Upload error: …`); body-size overflow → 413 `PAYLOAD_TOO_LARGE`; malformed JSON → 400 `INVALID_JSON`.
- Rate limits per family (api / auth / auth-account / write / bid) verified with `ENFORCE_RATE_LIMIT`.
- No secrets in the committed `client/dist` bundle and no baked `VITE_API_BASE_URL=localhost` (the two `localhost` hits are `socket.io-client` internals); `.env` is gitignored; server logs contain no tokens or passwords.

Issues found are listed in §8.

## 7. Database integrity

- Schema changes were delivered as **additive migrations** (`server/prisma/migrations/20261023054541…`, `…150000`, `…170000`, `…171000`, `…172000`); no table was dropped, truncated or reset. Existing dev rows are intact (`ordersRemaining: 21` pre-existing after cleanup).
- Before/during/after each load level the harness re-checked lot arithmetic and order↔inspection agreement; after the fix both were consistent at every level.
- Jest never issues DDL: `DELETE`-only isolation inside `metalmundi_test`.

## 8. Bugs found, severity, root cause, status

| # | Severity | Finding | Root cause | Status |
| --- | --- | --- | --- | --- |
| 1 | **High (Critical for admin UX)** | `GET /api/v1/admin/dashboard` returned **500** whenever at least one recent order existed | `dashboardController.js:47` destructured the request as `_req` while line 71 called `serializeOrder(order, { viewer: req.user … })` → `ReferenceError: req is not defined`. Only found after adding network-response attribution to the browser harness, because the existing permissions test ran against an empty orders table and was vacuous. | **Fixed** (`req` param restored); permissions test now seeds a real order and is proven to fail (`ReferenceError`) when the fix is reverted |
| 2 | **Medium** | Two admins recording different inspection steps concurrently could leave the order mirror and the `Inspection` row disagreeing (order `PASSED`, inspection `IN_PROGRESS`) | Two sequential writes (inspection upsert, then `ordersRepo.updateById`) outside one transaction | **Fixed**: single `prisma.$transaction([inspectionWrite, order.update])` in `orderWorkflowService.js`; concurrency suite 14/14 and 3/3 repeat race runs green |
| 3 | **Medium** | A production release with `DATABASE_URL` missing would boot silently against the **local development database** | `config/env.js` supplies a dev fallback for `DATABASE_URL` and only guarded JWT/cookie secrets | **Fixed**: prod start now throws `Refusing to start in production without DATABASE_URL.`; covered by `envGuards.test.js` (4 tests, child-process boot assertions) |
| 4 | **Medium** | Pickup-distance figures used in charge estimates are not real distances | `distanceService.estimateDistanceKm()` returns a deterministic `hash-estimate` (±60 % around `BUSINESS_DEFAULT_DISTANCE_KM`) whenever coordinates are absent. It is honestly flagged `provisional: true` and the UI says so, so this is a product-accuracy limitation, not a data-integrity bug. | **Open** — needs a geocoding/routing provider or an explicit "estimate only" label everywhere the number feeds a charge |
| 5 | **Low** | Throughput ceiling ~460 rps regardless of load; latency scales linearly from 10 VUs | Prisma pool caps at 13 PG backends (pinned at every level); single-node CPU. Not a defect — a capacity characteristic. | Open (documented). Raise `connection_limit`, add replicas, or use a larger instance before expecting more |
| 6 | **Low** | A shared-IP / CGNAT client (mobile carriers, corporate NAT, Render's own proxy) collapses into `429` under bursty use, because every limiter keys on IP | `express-rate-limit` default IP key; the code already notes the CGNAT caveat. | Open (design decision). Next step: key writes on `userId + IP` and trust the proxy hop count |
| 7 | Informational | Anonymous page loads log 8× `401 GET /api/v1/auth/me` in the browser console | Intentional session bootstrap; the client treats it as "not signed in" | Optional polish: skip the probe when no cookie is present |
| 8 | Informational | CSP `connect-src` hardcodes `localhost` origins | Static CSP in `app.js` | Optional: derive from an env allow-list before any domain change |
| 9 | Informational | QA harness fixtures carry live session tokens | by design (replayed cookie jar) | **Mitigated**: `.gitignore` now excludes `scripts/load-fixtures*.json`, `scripts/load-results/`, `scripts/browser-evidence/`, and harness `*.log` files |

## 9. Files changed in this phase and why

Fixes (behaviour):
- `server/src/controllers/admin/dashboardController.js` — bug #1.
- `server/src/services/orderWorkflowService.js` — bug #2 (atomic inspection + order mirror).
- `server/src/config/env.js` — bug #3 (production `DATABASE_URL` guard).

Test additions / strengthening:
- `server/tests/security.test.js`, `concurrency.test.js`, `inspectionWorkflow.test.js`, `marketplaceNearby.test.js`, `errorMapping.test.js`, `envGuards.test.js` (new).
- `server/tests/permissions.test.js` — added a seeded-order dashboard regression test that closes the vacuous coverage behind bug #1.
- `server/tests/workflow.test.js`, `orders.test.js` — extended for the workflow/status-machine and idempotency paths.

Harnesses (new, local-only output):
- `scripts/load-test.js` — closed-loop worker-thread load generator with CSRF-aware agents, per-endpoint percentiles, `pg_stat_activity` sampling, exact status-code histogram, self-cleanup.
- `scripts/seed-load.js` — deterministic fixtures into `metalmundi_load` only.
- `scripts/e2e-browser.mjs` — Playwright multi-role E2E with console/network attribution and failure injection.
- `scripts/e2e-perf.mjs` — frontend load + interaction timings (Navigation Timing, buffered LCP observer, MutationObserver settle).
- `scripts/e2e-cleanup.js` — deletes only harness-owned rows and re-checks lot invariants.
- `.gitignore` — QA artifact exclusions.

No feature was removed and no unrelated UI was changed.

## 10. Harness bugs found in my own tooling (fixed, for transparency)

- VU overshoot: `ceil` per-thread split made "25 VUs" run 36 loops → replaced with an even `floor`+remainder split (`scheduledLoops` now equals the requested VUs).
- Error-rate arithmetic divided by 10 twice, reporting a 100 % 4xx run as 10 % → corrected (the :5110 JSON above was produced before the fix and still carries the wrong `errorRatePercent`; the recomputed truth is 100 % 4xx / 0 % 5xx).
- `structuredClone` of the endpoint mix failed (closures are not cloneable) → each worker rebuilds its mix from plain fixtures.
- LCP entries were invisible without a buffered `PerformanceObserver`, so the first perf run silently fell back to ready-time → observer added before navigation.

## 11. Limitations (exact next step for each)

1. **k6 / Artillery not installed** (`npx --no-install k6` and `… artillery` both fail). Load work used an equivalent in-repo Node `worker_threads` closed-loop harness with real cookie+CSRF handshakes. Next step if tooling parity is required: `npm i -D artillery` (or install the k6 binary) and port the endpoint mix in `scripts/load-test.js` to a config file — the endpoints, weights and auth handshake are already enumerated there.
2. **Closed-loop model, not open**: at 100 VUs the offered load is capped by client latency, so 445 rps is a floor, not the ceiling. Next step: open-model arrival scheduling (fixed RPS) in the harness.
3. **DB telemetry is `pg_stat_activity` only** — no `pg_stat_statements` timings, so per-query latency is not broken out. Next step: enable the extension in the container and sample `mean_exec_time`.
4. **Single test client** — everything comes from `127.0.0.1`, so per-IP limiters aggregate the whole fleet (that is exactly what §5.3 shows). Next step: run the generator from several source IPs or set `RATE_LIMIT_*_MAX` per level to separate throttling from capacity.
5. **Windows host**: `os.loadavg()` is always `0`, so CPU pressure is inferred from RSS + throughput plateaus rather than a load average. Next step: run the same ramp inside a Linux container for a real load figure.
6. **Dev-server timings are not production timings** — quote §5.4 only; the Vite numbers are kept for reference.
7. **Two archived load JSONs predate the harness fixes** (`load-20261023T110207/110225` have `scheduledLoops` overshoot, and none of the pre-fix files carry `statusCodes`); §5.1/5.2 tables are taken from the post-fix runs.
8. **Upload interruption** (mid-body disconnect) is covered only at the HTTP-layer contract (413/`MulterError`), not by a torn TCP client. Next step: a socket-killing abort test if required.
9. Production Render instance received no load and no writes beyond header/config verification; the pricing-seed gap noted previously (`prod` has categories but zero `pricing` rows) is still open and would make the sell-form estimate/submit 400 there.

## 12. Exact re-run commands

```bash
# full server suite (~10 min, uses metalmundi_test)
cd server && npm test

# single suites
cd server && npx jest tests/concurrency.test.js tests/security.test.js --runInBand
cd server && npx jest tests/errorMapping.test.js tests/envGuards.test.js

# client unit suite
cd client && npx vitest run --reporter=basic

# browser E2E (needs API :5000 + client :5173 running)
node scripts/e2e-browser.mjs

# frontend timings — dev stack and production bundle
node scripts/e2e-perf.mjs
E2E_CLIENT=http://localhost:5000 node scripts/e2e-perf.mjs

# load ramp — staging DB + dedicated API port, read-only then writes
node scripts/seed-load.js                       # creates metalmundi_load + fixtures
node scripts/load-test.js --levels 1,10,25,50,100 --duration 20000 \
  --db-url postgresql://admin:adminpassword@localhost:5432/metalmundi_load \
  --pid <PID-of-load-api>
node scripts/load-test.js --writes --levels 10,25,50 --duration 20000 \
  --db-url postgresql://admin:adminpassword@localhost:5432/metalmundi_load

# rate-limit demonstration (shipped limits)
ENFORCE_RATE_LIMIT=true node scripts/load-test.js --writes --levels 25 --duration 15000

# QA-owned dev-data cleanup + lot invariant audit
node scripts/e2e-cleanup.js
```

## 13. Verdict

Against the provisional thresholds: **API latency and error-rate targets pass at every level up to 100 concurrent virtual users** (0 × 5xx, 0 × 4xx on the read ramp, p95 374 ms at 100 VUs), writes are correct under concurrency with no oversell, negative stock, lost update or duplicate side effect, the browser E2E is 24/24, and both test suites are fully green (172 server + 31 client).

Three real defects were found and fixed (admin dashboard 500, non-atomic inspection write, production `DATABASE_URL` fallback); one accuracy limitation remains open (hash-based provisional pickup distance), plus two documented capacity/throttling characteristics. Nothing has been committed or pushed, and no production infrastructure was touched.
