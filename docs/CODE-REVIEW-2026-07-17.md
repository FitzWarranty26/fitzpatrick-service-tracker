# DROVE — Full Code Review (2026-07-17)

**Repo:** `FitzWarranty26/fitzpatrick-service-tracker` · **Branch reviewed:** `master` @ `6245549`
**Reviewers:** Two independent audit passes (server/API/data layer; client), every finding verified against source with `file:line` evidence.
**Trigger:** The 2026-07-16 description-wipe incident (PRs #61/#65, Issue #64) and the 2026-07-17 photo-upload 413 (PR #67), plus the decision to take DROVE to a multi-tenant, subscription SaaS.

---

## Executive summary — the honest verdict

**As a single-tenant internal tool this is a B+ codebase. As a multi-tenant SaaS foundation it is a C.** That gap is not sloppiness — it is architecture written for one company that must now carry many. The domain logic (service calls, claims, visits, invoicing) is sound and worth keeping. The risk is concentrated in a small number of load-bearing patterns, and they are all fixable on a known schedule.

**This is not a "sloppy" codebase.** Evidence: clean `tsc`, deny-by-default API auth, above-average security headers/CSP, parameterized SQL throughout, bcrypt cost 12, optimistic concurrency on the highest-risk edit, correct business-timezone date math, server-side report aggregation, and exceptional operational discipline (CHANGELOG / DEPLOYMENT-LOG / RECOVERY-INDEX / rollback tags). Most internal tools have little of this.

**Why bugs keep cropping up anyway.** The last two production incidents are the *same species* of bug:

| Incident | Route-level intent | Global behavior that silently overrode it |
|---|---|---|
| Description wipe (07-16) | Create route stored the narrative correctly | `syncLegacyFromProduct` mirrored empty Product-1 fields over it |
| Photo 413 (07-17) | Photo route declared a 20 MB body limit | Global 1 MB JSON parser ran first and rejected the body |

The pattern: **local intent silently overridden by a global mechanism, with no test that would catch it.** The codebase has three standing generators of this bug class:

1. **Dual-written data** — legacy single-product columns on `service_calls` mirrored from `service_call_products` (Issue #64). Two sources of truth is a standing invitation for the next wipe-class bug.
2. **Unvalidated boundaries** — several mutating routes accept raw `req.body`; ~318 `any` types mean TypeScript's guarantees stop at the HTTP boundary.
3. **A near-empty test net** — 7 tests total, and CI doesn't even run them.

Fix those three generators and the "bugs keep cropping up" experience changes qualitatively. That is what the hardening phase in `ROADMAP.md` does.

## Combined critical findings (both audits)

| # | Finding | Layer | Severity | Effort |
|---|---|---|---|---|
| 1 | No tenant/company scoping in any table or query | Server | Critical | L |
| 2 | Invoice totals computed in browser, stored verbatim by server | Client+Server | Critical | M |
| 3 | `deleteServiceCall` non-transactional; orphans `invoice_items` | Server | Critical | S |
| 4 | FKs declared but never enforced (`PRAGMA foreign_keys` never set) | Server | Critical | S |
| 5 | In-memory sessions + rate limits (lost on deploy; blocks scaling) | Server | Critical | M–L |
| 6 | ~4,000 lines of `*.legacy.tsx` still routed, dangerously drifted | Client | High | S |
| 7 | Raw `req.body` on users/invoices/visits/appointments routes | Server | High | M |
| 8 | CI never runs the test suite | CI | High | S |

The full severity-ranked findings follow: Part 1 (server), Part 2 (client). The consolidated remediation sequence lives in `ROADMAP.md` (Phase 0.5 — Hardening) so there is one work queue, not three.

---

# Part 1 — Server-side audit


**Scope:** `server/index.ts`, `server/routes.ts` (3,443 lines), `server/storage.ts` (2,677 lines), `server/storage.test.ts`, `shared/schema.ts`, `shared/datetime.ts`, `script/build.ts`, `render.yaml`, `.github/workflows/ci.yml`, `drizzle.config.ts`.

**Stack:** Express 5.0.1 · Drizzle ORM (better-sqlite3) · better-sqlite3 11.x · SQLite on Render persistent disk · in-memory sessions & rate limiting · bearer-token auth.

**Context:** Single-tenant today (~16 users, one company). Intent is to become a multi-tenant subscription SaaS with a Postgres migration. Findings are weighted with that trajectory in mind.

**Method:** Every finding below was verified against the actual source. Line numbers reflect the files as read during the audit. No code was modified; no commits or PRs were created.

**Effort key:** S = <2h · M = ~half day · L = 1+ day.

---

## CRITICAL

### C1. No tenant/company scoping anywhere in the data model or queries
- **Where:** `shared/schema.ts` (all 12 tables), every query in `server/storage.ts` and `server/routes.ts`.
- **Evidence:** None of `service_calls`, `photos`, `parts_used`, `service_call_products`, `activity_log`, `contacts`, `users`, `audit_log_system`, `invoices`, `invoice_items`, `service_call_visits`, `photo_label_presets`, `scheduled_appointments` carry a `tenant_id` / `company_id` / `account_id`. Every read is global, e.g. `getAllServiceCalls()` and dashboard queries like `SELECT COUNT(*) ... FROM service_calls WHERE status = 'Completed'` (storage.ts:2377) have no tenant predicate.
- **Why it matters:** This is the single largest blocker to the stated multi-tenant SaaS goal. Retrofitting tenant isolation after launch is far harder — every table needs a column + backfill, every query needs a `WHERE tenant_id = ?`, every insert needs to stamp it, and every unique constraint (`users.username`, `invoices.invoice_number`) must become composite. Missing a single query = cross-tenant data leak.
- **Fix:** Before onboarding tenant #2: add `tenant_id` to all tables; make it NOT NULL with FK to a `tenants` table; convert `username` and `invoice_number` uniqueness to `(tenant_id, …)`; thread tenant context through a request-scoped value and enforce it in a storage-layer wrapper (not per-call-site) so it can't be forgotten. Consider Postgres Row-Level Security once migrated.
- **Effort:** L (multi-day; foundational).

### C2. In-memory sessions and rate-limit state — not multi-instance safe, lost on every restart
- **Where:** `server/routes.ts` — `activeSessions` Map (~line 95), rate-limit Maps (~lines 23, 46).
- **Evidence:** Sessions are a `Map<token, {...}>` in process memory; API and auth rate limiting are also in-memory Maps keyed by IP.
- **Why it matters:** (1) Every deploy/restart logs out all users (acceptable at 16 users, unacceptable at SaaS scale). (2) The moment you run more than one instance (horizontal scale, zero-downtime deploy, Render autoscaling), sessions and rate limits are per-instance — a user bounced to another instance is logged out, and rate limits are trivially bypassed by spreading requests. `render.yaml` is a single Starter instance today, so this is latent, but it hard-blocks scaling.
- **Fix:** Move sessions to a shared store (Postgres table or Redis) with an expiry column; move rate limiting to Redis (or a managed API gateway). Pair with C1 so tokens carry tenant + user.
- **Effort:** M–L.

### C3. `deleteServiceCall` is not transactional and orphans `invoice_items`
- **Where:** `server/storage.ts:1094-1105`.
- **Evidence:**
  ```js
  deleteServiceCall(id: number): void {
    sqlite.prepare(`DELETE FROM scheduled_appointments WHERE call_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM service_call_visits WHERE service_call_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM invoices WHERE service_call_id = ?`).run(id);   // ← raw delete
    db.delete(photos)...; db.delete(partsUsed)...; db.delete(activityLog)...;
    sqlite.prepare(`DELETE FROM service_call_products WHERE service_call_id = ?`).run(id);
    db.delete(serviceCalls).where(eq(serviceCalls.id, id)).run();
  }
  ```
  Deleting `invoices` directly here bypasses `deleteInvoice()` (storage.ts:2207), which is the only path that also runs `DELETE FROM invoice_items WHERE invoice_id = ?`. So every invoice line item for a deleted call is orphaned. Additionally, the whole sequence is 8 separate statements with **no transaction** — a crash/error midway leaves the DB half-deleted (e.g. call gone but visits/photos remain, or vice-versa).
- **Why it matters:** Silent data corruption. Orphaned `invoice_items` inflate any future per-item revenue/report query and can never be reached through the UI. Partial deletes produce dangling references the app assumes can't exist. FKs won't save you (see C4).
- **Fix:** Wrap the entire delete in `sqliteHandle.transaction(() => { … })`; add `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE service_call_id = ?)` *before* deleting the invoices. Post-Postgres, prefer real `ON DELETE CASCADE` with FKs enforced.
- **Effort:** S.

### C4. Foreign keys are declared but never enforced — `PRAGMA foreign_keys` is never set
- **Where:** `server/storage.ts` (no occurrence of `PRAGMA foreign_keys` anywhere in `server/`; verified by grep — 0 matches).
- **Evidence:** Table DDL includes `ON DELETE CASCADE` clauses (service_call_visits, scheduled_appointments, service_call_products), but SQLite disables FK enforcement by default per-connection and the app never runs `PRAGMA foreign_keys = ON`. So the cascades are dead — deletes rely entirely on the manual multi-table logic in C3.
- **Why it matters:** The schema *looks* like it guarantees referential integrity but does not. Any code path that deletes a parent without replicating the manual cascade (or any future contributor who trusts the `ON DELETE CASCADE` text) will orphan children. It also masks bugs during development that would surface loudly in Postgres (where FKs are enforced by default).
- **Fix:** Add `sqlite.pragma('foreign_keys = ON')` immediately after opening the DB. Then audit existing data for pre-existing orphans before enabling in prod (enabling FK enforcement can make previously-silent bad deletes start failing). This also de-risks the Postgres migration by surfacing integrity issues now.
- **Effort:** S (flip) + M (data cleanup / regression test).

---

## HIGH

### H1. Many mutating routes accept raw `req.body` with no zod validation
- **Where (verified):** `POST /api/users` (routes.ts:384), `PATCH /api/users/:id` (408), `POST /api/invoices` (2618, `const data = req.body`), `PATCH /api/invoices/:id` (2662), visit create/update (2703/2766, raw destructure), appointment reschedule/active (2851/2933).
- **Evidence:** These handlers destructure or pass `req.body` straight into storage/SQL. Contrast with the well-validated routes that DO use the drizzle-zod schemas: service-calls POST/PATCH (684/835), contacts (1052/1066), photos (1104), parts (1225/1241), products (1278/1294).
- **Why it matters:** Unvalidated input reaches SQL builders and TEXT money columns. Type confusion (numbers where strings expected, missing required fields, unexpected extra keys), corrupt money strings that later break `parseMoney`/`CAST(... AS REAL)`, and inconsistent data. In a SaaS with untrusted tenants this becomes an attack surface, not just a data-quality issue. The insert schemas already exist (`insertUserSchema`, `insertInvoiceSchema`, etc.) — they're just not applied here.
- **Fix:** Run each body through the corresponding `insert*Schema.parse()` (or a `.pick()`/`.partial()` for PATCH) and return 400 on failure. Centralize with a `validate(schema)` middleware.
- **Effort:** M.

### H2. CI never runs the test suite
- **Where:** `.github/workflows/ci.yml`; `package.json`.
- **Evidence:** CI runs `npm run check` (tsc) and `npm run build` only. `package.json` defines `"test": "tsx --test server/storage.test.ts"` but nothing invokes it in CI.
- **Why it matters:** The one meaningful regression test that exists — the fill-only legacy-sync guard protecting against the #85/#86 data-loss bug — can silently break and merge. As the app grows toward SaaS, an untested CI gate gives false confidence.
- **Fix:** Add a `npm test` step to `ci.yml` after `check`. (See also H3 — coverage is thin, so this is necessary but not sufficient.)
- **Effort:** S.

### H3. Test coverage is minimal relative to logic surface
- **Where:** `server/storage.test.ts` (152 lines total).
- **Evidence:** Only two areas are tested: the legacy `syncLegacyFromProduct` fill-only behavior (5 tests) and the `isPhotoUploadRequest` predicate (2 tests). Zero tests cover: auth/session/role enforcement, invoice number generation race, delete cascade correctness (C3), dashboard/briefing aggregate SQL (hundreds of lines of hand-written SQL with money `CAST`s and TZ math), rate limiting, or any route handler.
- **Why it matters:** The highest-risk code (money aggregation, deletes, auth) is entirely untested. A single wrong `CAST` or date-boundary error silently corrupts executive dashboards that drive business decisions.
- **Fix:** Add targeted tests for: role middleware (manager/editor/staff matrix), `deleteServiceCall` leaves no orphans, `generateInvoiceNumber` under concurrent inserts, and a couple of golden-value dashboard aggregates. Prioritize after C3/C4 fixes so tests lock in the corrected behavior.
- **Effort:** M–L.

### H4. `DELETE /api/service-calls/:id` is allowed for techs (requireEditor), not managers
- **Where:** `server/routes.ts:904` (route), `304` (requireEditor).
- **Evidence:** `requireEditor` only blocks role `"staff"`; techs pass. Deleting a service call triggers the destructive, non-transactional cascade in C3.
- **Why it matters:** Any tech can permanently destroy a call plus its invoices, visits, photos, and parts — a high-blast-radius, irreversible action. In a multi-tenant SaaS, destructive deletes should almost always be manager-gated (or soft-deletes). Combined with C3/C4 this can silently corrupt financial data.
- **Fix:** Change to `requireManager`, or implement soft-delete (`deleted_at`) so the action is reversible and auditable. Confirm the product intent for who may delete.
- **Effort:** S.

### H5. Schema managed entirely by boot-time `CREATE TABLE IF NOT EXISTS` + ~37 ad-hoc ALTER migrations; drizzle migration files unused
- **Where:** `server/storage.ts:54-181` (DDL) and ~37 numbered `columnExists`/`ALTER` blocks through ~line 700; also inline data migrations (Migration 19 imports 40 contacts at storage.ts:2616, Migration 23 at 2666). `drizzle.config.ts` points `out: "./migrations"` but that directory is unused; only `db:push` is run.
- **Evidence:** Migrations are imperative code that runs on every process start, including a drop/recreate table (Migration 14) with partial-failure recovery, and hardcoded production data seeds embedded in the storage module.
- **Why it matters:** (1) No versioned, reviewable migration history — hard to reason about schema state across environments, and impossible to roll back cleanly. (2) Boot-time migrations racing on multiple instances (post-C2 scaling) will conflict. (3) The Postgres migration will require rewriting all of this; SQLite-only idioms (see M-series) are baked in. (4) Seeding real customer data from application code doesn't belong in a multi-tenant world (that data is tenant #1's, not global).
- **Fix:** Adopt a real migration tool (drizzle-kit generate + a migrate-on-deploy step, or a dedicated migration runner) with checked-in SQL. Move seed data out of `storage.ts` into a one-time seed script. Run migrations as a single pre-deploy job, not per-instance-on-boot.
- **Effort:** L.

### H6. Default admin seeded with a hardcoded password printed to the console
- **Where:** `server/storage.ts` ~713-717.
- **Evidence:** `bcrypt.hashSync("fitzpatrick2026", 12)` seeds an admin with `must_change_password = 1`, and the credentials are `console.log`'d on boot.
- **Why it matters:** A known default password is a well-scanned attack vector; the forced-change flag helps but the window between deploy and first login is exploitable, and the plaintext in logs persists in log aggregators. In a multi-tenant SaaS, per-tenant admin bootstrap must not use a shared known secret.
- **Fix:** Generate a random password at first boot (or require an env var), never log the plaintext, and force change on first login. For SaaS, provision the first admin via an invite/onboarding flow per tenant.
- **Effort:** S.

---

## MEDIUM

### M1. SQLite-specific idioms throughout will break the Postgres migration
- **Where:** `server/storage.ts` and `server/routes.ts`, widespread.
- **Evidence (verified samples):** `julianday(...)` date math (storage.ts:2533, 2551, 2570), `datetime('now')` / `date(?, '-7 days')` (2553, 2621, 2671), `CAST(x AS REAL)` on TEXT money columns (2366+, many), `sqliteHandle.backup(slotFile)` (routes.ts:3289), `RETURNING *` with better-sqlite3 `.get()` semantics, `AUTOINCREMENT` PKs, `lastInsertRowid`.
- **Why it matters:** These are the concrete line items the Postgres migration must rewrite. `julianday`/`datetime` don't exist in PG; money-as-TEXT + `CAST AS REAL` should become `numeric`; `.get()`/`lastInsertRowid` are better-sqlite3-specific; the SQLite online `backup()` has no PG equivalent (use `pg_dump`/managed snapshots).
- **Fix:** Track these as a migration checklist. Strongly consider moving money columns to `numeric` during the PG move (removes the entire `parseMoney`/`CAST` fragility). Replace date math with portable SQL or compute in JS.
- **Effort:** L (part of the PG migration).

### M2. Money stored as free-text; correctness depends on every read using `parseMoney`
- **Where:** `shared/schema.ts` (parts_cost, labor_cost, other_cost, claim_amount, invoice.subtotal/total, invoice_items.*), `shared/datetime.ts:102` (`parseMoney`).
- **Evidence:** Columns are TEXT; `parseMoney` exists precisely because `parseFloat("$1,200.00")` = NaN and `parseFloat("1,200")` = 1. SQL aggregates use `CAST(total AS REAL)` which does NOT strip `$`/commas — so a value the user typed as `"$1,200"` sums as `0` or `1` in SQL even though `parseMoney` would read it correctly in JS.
- **Why it matters:** Divergence between JS reads (correct) and SQL aggregates (naive CAST) means dashboards and invoices can disagree. The `datetime.ts` module even documents this hazard. Low probability if the UI always writes clean numeric strings, but nothing enforces that (see H1 — invoice bodies are unvalidated).
- **Fix:** Enforce a normalized numeric string on write (validate + store as canonical `"1200.00"`), or migrate to a real numeric type (M1). At minimum, validate money fields in the invoice routes.
- **Effort:** M.

### M3. `generateInvoiceNumber` has a read-then-write race
- **Where:** `server/storage.ts:2086` (MAX+1 gap-walk).
- **Evidence:** Computes next number from `MAX(...)` then inserts. Concurrent invoice creation can compute the same number. Mitigated by the `UNIQUE` constraint on `invoice_number` plus a collision-retry loop in the route — so it's currently safe but relies on the retry.
- **Why it matters:** At 16 users, collisions are rare; under SaaS concurrency they'll happen. The retry loop makes it correct but is a smell; the number sequence also becomes per-global rather than per-tenant (ties into C1 — invoice numbers must be tenant-scoped and their uniqueness composite).
- **Fix:** Post-C1, make `(tenant_id, invoice_number)` unique and generate per-tenant sequences (Postgres sequence or a per-tenant counter row updated in the same transaction).
- **Effort:** M (with C1).

### M4. Auth guard relies on path-prefix string matching to exempt routes
- **Where:** `server/routes.ts:330-338`.
- **Evidence:** `app.use("/api", ...)` skips auth when `req.path.startsWith("/auth")` or `startsWith("/backup")`. Everything else requires auth. Backup routes have their own `requireBackupAuth`.
- **Why it matters:** Prefix matching is brittle: any future route under `/api/auth*` or `/api/backup*` is automatically unauthenticated, which is easy to trip over (e.g. an `/api/authorize-something` route would be silently public). Currently correct, but fragile as routes proliferate in a SaaS.
- **Fix:** Use explicit per-router mounting (an unauthenticated `authRouter` and `backupRouter`, an authenticated router for everything else) rather than string-prefix exemptions.
- **Effort:** S–M.

### M5. Broad use of `any` erases type safety at the server boundary
- **Where:** `server/routes.ts` (~214 `any`), `server/storage.ts` (~104 `any`), including all middleware signatures (`req: any, res: any`) and every raw-SQL row cast (`.get(...) as any`).
- **Why it matters:** The drizzle-zod types and inferred row types exist but are discarded at exactly the points where bugs hide (row shape mismatches, snake_case vs camelCase mapping errors, missing null handling). tsc passes but guarantees little about runtime shapes.
- **Fix:** Type middleware with proper Express 5 types + an augmented `req.user`; give raw-SQL rows explicit row interfaces (or route them through Drizzle select). Incremental — start with the money/dashboard aggregates.
- **Effort:** M–L (incremental).

### M6. Status string `'Needs Return Visit'` used in SQL is not in the server `SERVICE_STATUSES` enum
- **Where:** `server/routes.ts` (dashboard/calendar SQL) vs `shared/schema.ts:326` (`SERVICE_STATUSES` = Scheduled, In Progress, Completed, Pending Parts, Escalated).
- **Evidence:** Raw SQL references a status value not present in the shared enum used for validation.
- **Why it matters:** Either the enum is incomplete (validation would reject a legitimately-used status) or the SQL references a dead value (query never matches). Both are latent correctness bugs and a sign the status vocabulary isn't single-sourced.
- **Fix:** Reconcile: add the value to the enum if real, or remove the SQL reference if dead. Drive all status checks from the shared constant.
- **Effort:** S.

---

## LOW

### L1. `script/build.ts` esbuild allowlist references packages not in `package.json`
- **Where:** `script/build.ts`.
- **Evidence:** Allowlist includes stripe, nodemailer, openai, passport, jsonwebtoken, multer, cors, axios, uuid, nanoid, xlsx, @google/generative-ai — none are dependencies.
- **Why it matters:** Dead/aspirational config is misleading (suggests integrations that don't exist) and could mask a real bundling problem if one of these is later added but mis-listed. Harmless today.
- **Fix:** Prune the allowlist to actual dependencies; add entries when the dependency is actually introduced.
- **Effort:** S.

### L2. Production error handler is good but pairs with broad `console.error` of full errors
- **Where:** `server/index.ts:108-122`.
- **Evidence:** Client sees generic "Internal Server Error" in prod (good), but `console.error("Internal Server Error:", err)` logs the full error. Elsewhere audit logging swallows errors (`catch (e) { console.error(...) }`, routes.ts:322).
- **Why it matters:** Full errors in logs may contain customer data / serial numbers (the app is careful NOT to log response bodies elsewhere — this is inconsistent). Swallowed audit failures mean the audit trail can silently have gaps.
- **Fix:** Scrub sensitive fields before logging; consider a structured logger with levels. For audit, at least increment a metric on failure so gaps are detectable.
- **Effort:** S.

### L3. Backup endpoint auth is a shared static secret header
- **Where:** `server/routes.ts` backup routes (~3289) + `render.yaml` cron (`x-backup-secret`).
- **Evidence:** `/api/backup` is exempt from session auth and guarded by a single shared secret header, triggered by a Render cron twice daily.
- **Why it matters:** A single long-lived shared secret is lower-assurance than the bearer session model used everywhere else; if leaked it allows triggering backups (and reading the DB file if the response returns it). Acceptable for a single tenant but should be revisited for SaaS.
- **Fix:** Rotate the secret via env; ensure the endpoint only writes to disk and never streams the DB in a response without additional auth. Revisit under the SaaS threat model.
- **Effort:** S.

### L4. `is_test` flag is the only mechanism separating test data from real reports
- **Where:** dashboard/briefing SQL (`AND (is_test = 0 OR is_test IS NULL)`), plus seeded `TEST CUSTOMER` (storage.ts:2666).
- **Why it matters:** Every report query must remember the `is_test` predicate; miss it in one place and test rows pollute a real dashboard. It's applied consistently in the aggregates reviewed, but it's an easy-to-forget convention rather than a structural guarantee. In multi-tenant SaaS, test data should be a tenant attribute or separate environment, not a per-row flag.
- **Fix:** Long-term, drop `is_test` in favor of proper environment/tenant separation. Short-term, centralize the "reportable calls" filter in one query builder.
- **Effort:** S (centralize) / M (rework).

---

## What is done WELL (fairly noted)

- **Security headers** (`server/index.ts:30-52`): CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS in prod, and `no-store` on all `/api` responses. Thoughtful and above-average.
- **Photo upload 413 handling** (`server/index.ts:63-74`, `photo-upload-path.ts`): global 1mb JSON parser deliberately skips the photo route so its own 20mb parser applies — a real bug (PR history) fixed cleanly, with a regression test for the predicate.
- **Timezone correctness** (`shared/datetime.ts`): business-timezone date helpers avoid the classic UTC-rollover bug; the module documents *why* clearly and is used in the dashboard aggregates (e.g. `getExecutiveBriefing` explicitly fixed the month-boundary bug).
- **Money parsing helper** (`parseMoney`): correctly handles `$`, commas, and NaN cases — the JS-side reads are robust (the gap is only the SQL-side `CAST`, M2).
- **Legacy dual-write hardening**: `syncLegacyFromProduct` is fill-only/non-clobbering, with a focused regression test suite proving the #85/#86 data-loss fix.
- **SQL injection posture**: parameterized queries throughout; dynamic identifiers guarded by an `ALLOWED_TABLES` allowlist (storage.ts:199) in `columnExists`.
- **Transactions where it counts in routes**: appointment reschedule/active and visit-mirroring flows use `sqliteHandle.transaction(...)`. (The gap is storage-layer deletes — C3.)
- **Password security**: bcrypt cost 12, `compareSync`, forced password change on seeded accounts.
- **Auth applied by default**: the `/api` guard is deny-by-default with explicit exemptions, not allow-by-default.

---

## Top 10 Prioritized Remediation List

| # | Finding | Severity | Effort | Why this rank |
|---|---------|----------|--------|---------------|
| 1 | **C1** Add tenant scoping to schema + queries | Critical | L | Hard blocker for the entire SaaS goal; only gets more expensive with data. Do first, before tenant #2. |
| 2 | **C4** Enable `PRAGMA foreign_keys = ON` (+ orphan cleanup) | Critical | S/M | One-line correctness fix that also surfaces integrity bugs before the PG move. |
| 3 | **C3** Make `deleteServiceCall` transactional + delete `invoice_items` | Critical | S | Active silent data corruption today; cheap to fix. |
| 4 | **C2** Move sessions + rate limiting to a shared store | Critical | M/L | Hard blocker for multi-instance scaling; prerequisite for zero-downtime deploys. |
| 5 | **H1** Add zod validation to raw-body routes (users, invoices, visits, appointments) | High | M | Closes the input-validation gap on mutating endpoints; schemas already exist. |
| 6 | **H4** Gate `DELETE /api/service-calls/:id` behind manager (or soft-delete) | High | S | High-blast-radius destructive action currently available to techs. |
| 7 | **H2 + H3** Run tests in CI, then expand coverage (auth, deletes, money aggregates) | High | S then M/L | Cheap CI fix now; lock in C3/C4 fixes with tests. |
| 8 | **H5** Adopt versioned migrations; move seed data out of `storage.ts` | High | L | De-risks PG migration and multi-instance boot; removes tenant-1 data from app code. |
| 9 | **H6** Randomize/​env the seeded admin password; stop logging it | High | S | Removes a known-credential attack vector. |
| 10 | **M1 + M2** Track SQLite→PG idioms; move money to numeric during the migration | Medium | L | Consolidate the migration checklist; eliminate the TEXT-money `CAST` fragility class. |

*(M3–M6 and L1–L4 are worthwhile but fall below the line; fold M3/M6 into the C1 and enum-reconciliation work, and pick up the Low items opportunistically.)*

---

# Part 2 — Client-side audit


Scope: `client/src/` (React 18 + Vite + wouter + TanStack Query). Every finding below was
verified against source; `file:line` points at the evidence. Server files are referenced only
where a client behavior depends on server handling.

Reviewed in depth: `App.tsx`, `lib/queryClient.ts`, `lib/auth.ts`, `lib/image-utils.ts`,
`ServiceCallDetail.tsx` (3,295 ln), `NewServiceCall.tsx`, `ServiceCallList.tsx`,
`Reports.tsx`, `Analytics.tsx`, `InvoiceDetail.tsx`, `NewInvoice.tsx`, the three `*.legacy.tsx`
pages, plus cross-checks into `server/routes.ts` and `server/index.ts`.

Severity legend: **Critical** = data loss / money-wrong / security in production today ·
**High** = latent data/correctness bug or hard multi-tenant blocker · **Medium** = correctness/UX
risk under load or drift risk · **Low** = polish / defense-in-depth. Effort: S <2h · M ~half day · L 1+ day.

---

## CRITICAL

### C1. Invoice money totals are computed on the client and stored verbatim by the server
- **Files:** `pages/NewInvoice.tsx:236,258-259`; `pages/InvoiceDetail.tsx:138-142,151-163`; server `routes.ts:2618-2637` (`createInvoice(data)` uses `data.subtotal`/`data.total` from `req.body`).
- **Evidence (client):**
  ```ts
  const subtotal = items.reduce((s, i) => s + parseMoney(i.amount), 0);
  ...
  subtotal: subtotal.toFixed(2),
  total: subtotal.toFixed(2),        // client is the sole authority
  ```
  Line amounts are also client-computed in `InvoiceDetail.updateItem` via `calcAmount(qty, unitPrice)` (`:155-159`). The server's `POST /api/invoices` takes `data = req.body` and calls `storage.createInvoice(data)` with no re-derivation of `subtotal`/`total` from the line items.
- **Why it matters:** The invoice grand total that gets billed to a customer is whatever the browser sent. A rounding difference, a stale React state, or a tampered request produces a stored total that does not match the sum of its own line items. For an internal tool that is a latent bug; for "DROVE" as a paid multi-tenant billing SaaS it is a financial-integrity hole (a tenant could be over/under-billed, and totals are not reproducible server-side).
- **Fix:** Compute `subtotal`/`total` on the server from the persisted line items inside `createInvoice`/`updateInvoice` (ignore any client-supplied totals, or validate they match and 400 on mismatch). Keep the client calc only for live display.
- **Effort:** M

---

## HIGH

### H1. Session token is held in a module variable only — every hard refresh logs the user out, and drafts/edits in memory are lost
- **File:** `lib/auth.ts:17` (`let _token: string | null = null;`), consumed by `App.tsx:199` (`isAuthenticated()` on mount).
- **Evidence:** There is no `localStorage`/`sessionStorage` (or cookie) persistence of the token anywhere in the client — the grep for token persistence returns only the in-memory `_token`. On any full page reload `_token` is `null`, so `isAuthenticated()` returns false and the app drops to the login screen.
- **Why it matters:** Field techs on phones reload/background-suspend constantly. A refresh mid-edit throws away unsaved component state (photo drafts staged in `newPhotoFiles`, part rows, invoice line items — none of which are covered by the `useFormDraft` hook, which only snapshots the RHF form). This is exactly the class of "silently drop data" problem the owner is worried about. (Note: keeping the token out of `localStorage` is a legitimate XSS hardening choice — so the fix is not simply "persist it".)
- **Fix:** Either (a) persist the session token in `sessionStorage` (survives reload, dies with the tab) accepting the XSS trade-off, or (b) move to an httpOnly cookie session so reloads stay authenticated without exposing the token to JS. Whichever is chosen, also extend draft persistence to cover staged photos/parts/line-items, not just the RHF form.
- **Effort:** M (sessionStorage) / L (httpOnly cookie migration)

### H2. Three `*.legacy.tsx` pages are dead code but still routed — ~4,000 lines of drifting duplicate logic
- **Files:** `App.tsx:17-19` (imports), `:55-61` `/calls/list/legacy`, `:77-83` `/new/legacy`, `:161-167` `/calls/legacy/:id`; pages `ServiceCallDetail.legacy.tsx` (2,288), `NewServiceCall.legacy.tsx` (1,211), `ServiceCallList.legacy.tsx` (524).
- **Evidence:** The legacy paths appear **only** as route definitions — a full client grep finds zero `Link`/`navigate()`/`setLocation()`/`<a href>` targeting any `/legacy` path. They are reachable only by manually typing the URL. Meanwhile the copies have already drifted from the maintained versions in dangerous ways:
  - `ServiceCallDetail.legacy.tsx:302-318` does a plain PATCH with **no** `If-Unmodified-Since` and **no** 409 handling, vs the current file's optimistic-concurrency guard (`ServiceCallDetail.tsx:443-449, 475-488`) → legacy path is silent last-write-wins.
  - `NewServiceCall.legacy.tsx:333-336` posts the create body **without the `products[]` array** (single-product only), vs current `NewServiceCall.tsx:392-417` → a call created via the legacy route saves no products.
  - Legacy photo-upload loops (`NewServiceCall.legacy.tsx:341-347`, `ServiceCallDetail.legacy.tsx:307-309`) are bare `await`s with no try/catch — one failed photo aborts the whole save, no toast.
- **Why it matters:** A bookmarked/typed legacy URL silently uses the old, buggy code path (no concurrency guard, drops products). Every future fix has to be made in two places or the drift widens. This is the concrete "sloppy code / latent bug" the owner flagged.
- **Fix:** Delete the three legacy files and their routes/imports (`App.tsx:17-19, 55-61, 77-83, 161-167`). If any are needed for reference, keep them in git history, not in the bundle.
- **Effort:** S

### H3. No debounce on the service-call search → one server request per keystroke, each a distinct cache entry
- **File:** `pages/ServiceCallList.tsx:329-343` (search feeds `queryString` → `queryKey`), input at `:471-472` (`onChange={(e) => setSearch(e.target.value)}`).
- **Evidence:** `search` state is written directly on every keystroke and is part of both the request URL and the React Query key, so typing "Carrier" fires 7 sequential `GET /api/service-calls?search=...` requests and creates 7 cache entries.
- **Why it matters:** With 16 users and a small SQLite table it is merely wasteful; as a multi-tenant SaaS with large tables it becomes an easy self-inflicted load spike and a sluggish search UX. Also unbounded cache growth per tenant session.
- **Fix:** Debounce `search` (~300 ms) before it enters `queryString`/`queryKey`, e.g. a `useDebouncedValue` hook.
- **Effort:** S

### H4. Multi-tenancy is blocked by pervasive hardcoded branding, contact info, and business rules in the client
- **Branding / company name (blocker):** `client/index.html:20-21`; `components/LoginScreen.tsx:107,225`; `components/Layout.tsx:343,427`; `pages/Dashboard.tsx:389`; `components/PerplexityAttribution.tsx:4`; PDF headers/footers `lib/pdf.ts:281,437,602`, `lib/invoice-pdf.ts:114,315,329`, `lib/report-pdf.ts:97,106`; IndexedDB name `lib/offline-queue.ts:28` (`"fitzpatrick-offline"`).
- **Company contact baked into every invoice PDF (blocker):** `pages/InvoiceDetail.tsx:187,330-332` ("Kevin Withers", `Fitz.warranty@fitzpatrickwarranty.com`); `lib/invoice-pdf.ts:119,129` ("PO Box 157", "West Jordan, Utah 84088").
- **Logo assets embedded in the bundle (blocker):** `lib/logo-data.ts` (base64 Fitzpatrick logos) used by LoginScreen/Layout/pdf.
- **Business-rule constants in `shared/schema.ts` reached client-side (blocker):** `MANUFACTURERS` (9 fixed brands, `:314-324`), `WATER_HEATER_MANUFACTURERS` + `getWarrantyYears()` warranty periods (`:376-401`), `JOB_STATES = ["UT","ID"]` (`:368`), `PRODUCT_TYPES` (`:370`), `CLAIM_STATUSES` (`:334-340`). These are per-tenant data, not universal.
- **Why it matters:** Every one of these must become tenant-scoped config before a second customer can be onboarded; several (manufacturers, warranty math, states, invoice "from" block) are business logic, not just cosmetics.
- **Fix:** Introduce a tenant/branding config fetched at login (company name, logo URL, invoice-from block, currency) and tenant-scoped lookup tables for manufacturers/warranty rules/states/statuses; replace the hardcoded imports with that config. (Coordinate with the server audit — schema needs a tenant column first.)
- **Effort:** L

---

## MEDIUM

### M1. `NewServiceCall` parts-upload loop has no error handling — a failed part aborts invalidation, draft-clear, and navigation
- **File:** `pages/NewServiceCall.tsx:437-457`.
- **Evidence:** Inside `createMutation.onSuccess`, photos are wrapped in try/catch (`:424-435`) but the parts loop is a bare `await apiRequest(...)` (`:439-445`). If any part POST throws, the async `onSuccess` rejects before reaching `invalidateQueries` / `clearDraft()` / `navigate()` (`:447-457`). The service call **was** already created server-side, so the user is left on the form (draft still present) with no navigation and only a generic unhandled-rejection — likely re-submitting and creating a duplicate call.
- **Why it matters:** Partial-write with confusing UX → duplicate calls and orphaned parts.
- **Fix:** Wrap the parts loop in try/catch like the photos loop, accumulate a `partError`, and always fall through to invalidate/clear/navigate; surface a non-blocking toast on partial failure.
- **Effort:** S

### M2. Several detail-page mutations have no `onError` → silent failures
- **File:** `pages/ServiceCallDetail.tsx:492-497` (`deletePhotoMutation`), `:499-508` (`deleteCallMutation`), `:606-611` (`deleteActivityMutation`), `:713-722` (`reorderPhotosMutation`).
- **Evidence:** Each defines only `onSuccess`; a rejected request (network, 403, 500) produces no toast and no rollback. For `reorderPhotosMutation` the drag-and-drop order is applied in local state first, so on server failure the UI shows an order that silently reverts on the next refetch.
- **Why it matters:** "Deleted" that didn't delete, or a reorder that didn't persist, with zero feedback — erodes trust and hides real backend errors.
- **Fix:** Add `onError` toasts (and for reorder, invalidate to snap back to server truth). Consider a small shared mutation wrapper that toasts errors by default.
- **Effort:** S

### M3. Client edits the legacy single-product columns directly, re-creating the dual-write drift that caused the prod bug
- **File:** `pages/ServiceCallDetail.tsx:1684` (manufacturer), `:2047-2072` (productModel / productSerial / productType / installationDate) all `setEditData(...)`, saved via PATCH at `:546-547`.
- **Evidence:** `startEdit` seeds `editData = {...call}` (`:524`) and the edit form mutates the legacy scalar product fields, which `insertServiceCallSchema.partial().parse` accepts and writes (server `routes.ts:835,869`). These are the same legacy columns that `syncLegacyFromProduct` mirrors from `service_call_products[index=1]` — yesterday's wipe bug lived in that sync.
- **Why it matters:** On a multi-product call, editing these legacy fields writes only the legacy columns, diverging them from the product rows — the exact drift class that produced the description-wipe incident. (Mitigation already present: the server's zod `.partial().parse` strips the nested `products`/`photos`/`parts` arrays that `saveEdit` leaves in the body at `:546`, so the client cannot wipe those — good defense.)
- **Fix:** On the multi-product detail page, edit product attributes only through the product mutations (`createProductMutation`/`updateProductMutation`, `ServiceCallDetail.tsx:968-996`) and drop the legacy scalar product fields from the edit form; let the server derive legacy columns.
- **Effort:** M

### M4. Invoices have no tax line — `total` is hardwired to `subtotal`
- **File:** `pages/NewInvoice.tsx:258-259`; `pages/InvoiceDetail.tsx:141-142`.
- **Evidence:** `total: subtotal.toFixed(2)` in both create and edit; there is no tax rate, tax amount, or tax field anywhere in the invoice flow.
- **Why it matters:** Any tenant that must charge sales tax (most US service businesses) cannot produce a correct invoice. Blocks DROVE onboarding beyond tax-exempt/warranty-only billing.
- **Fix:** Add tenant-configurable tax rate + a computed tax line; fold into the server-side total from C1.
- **Effort:** M (rolls up with C1)

### M5. Query-key inconsistency makes one scheduling invalidation a no-op (currently masked by a broader one)
- **File:** `pages/ServiceCallDetail.tsx:641-658`.
- **Evidence:** The main call query key is the array `["/api/service-calls", callId]` (`:426`), but `invalidateSchedulingSurfaces` invalidates the string key `` [`/api/service-calls/${callId}`] `` (`:643`), which does not prefix-match the array key. It works today only because `:645` also invalidates `["/api/service-calls"]`, which does match. The appointments query uses yet a third style (string key, `:631`).
- **Why it matters:** Fragile: if the broad `["/api/service-calls"]` invalidation is ever narrowed for performance, the detail view will silently stop refreshing after a reschedule. Mixed key conventions are a standing source of stale-cache bugs.
- **Fix:** Standardize on the array key convention everywhere for a given resource; remove the ineffective string-key invalidation.
- **Effort:** S

---

## LOW

### L1. `expiredHandled` guard never resets — a second session expiry in the same page load is swallowed
- **File:** `lib/queryClient.ts:8,16-30`.
- **Evidence:** `expiredHandled` flips to `true` on the first 401 and is never reset (login goes through `App.handleLogin` without clearing it). If a user re-authenticates in the same SPA session (no reload) and the new session later expires, `handleSessionExpired` returns early → no redirect, no "session expired" message.
- **Why it matters:** Rare, but produces a confusing dead-app state where queries fail silently.
- **Fix:** Reset `expiredHandled = false` inside `setAuth`/on successful login.
- **Effort:** S

### L2. Photo compression quality/size is fixed and can still exceed the 20 MB route cap in bulk
- **File:** `lib/image-utils.ts:44-48` (`maxDimension=1600, quality=0.7`); uploads are one-per-request (`ServiceCallDetail.tsx:457`, `NewServiceCall.tsx:426`) so each photo is well under 20 MB — the 413 reported 2026-07-17 was correctly fixed server-side (route-level `express.json({limit:"20mb"})`, `routes.ts:1100`, with the global 1 MB parser skipping this route, `server/index.ts:57-64`).
- **Why it matters:** Not a live bug — noting for completeness. The per-photo one-request design is the right call and keeps bodies small. Only risk: no client-side guard that the *compressed* data URL is under the cap before POST, so a pathological image could still 413 (handled gracefully by `photoUploadErrorMessage`).
- **Fix (optional):** Check the compressed data-URL length before upload and warn early. Low priority.
- **Effort:** S

---

## What is genuinely WELL done (be fair)

- **Optimistic concurrency on the highest-risk edit.** `ServiceCallDetail` sends `If-Unmodified-Since` and handles 409 with a clear "someone else saved first" refresh (`ServiceCallDetail.tsx:443-449, 475-488`; server `routes.ts:820-833`). This directly addresses the lost-update class of the description-wipe incident.
- **Server-side aggregation for Reports and Analytics.** Reports consumes server-computed summaries (`Reports.tsx` renders `d.summary.*`, `m.totalCosts`, etc.; only a trivial column sum is client-side at `:853`) and Analytics uses a proper custom `queryFn` that actually forwards the date range (`Analytics.tsx:211-214`). Money/time aggregates are not re-derived in the browser — the correct choice.
- **Server validates PATCH bodies with zod** (`routes.ts:835`, `insertServiceCallSchema.partial().parse`), which strips the stray nested arrays the client leaves in the edit payload — a real safety net against client-driven wipes.
- **Robust image handling.** `lib/image-utils.ts` handles HEIC detection, EXIF rotation via `createImageBitmap`, 50 MB preflight, and surfaces friendly errors; photo-add/upload paths in the *current* pages never silently drop a file (`NewServiceCall.tsx:519-534`, `ServiceCallDetail.tsx:561-579`).
- **Centralized 401 handling with a thundering-herd guard** (`queryClient.ts:8-30`) so a wave of parallel 401s produces one redirect, not dozens.
- **Sensible query defaults** for field use: `refetchOnWindowFocus`, `refetchOnReconnect`, 30 s `staleTime`, `retry:false` (`queryClient.ts:88-108`).
- **Code-splitting**: heavy pages are `lazy()`-loaded with Suspense fallbacks (`App.tsx:15-31`), keeping first load small for techs on phones.
- **Thorough scheduling invalidation** (`invalidateSchedulingSurfaces`, `ServiceCallDetail.tsx:641-658`) with a comment documenting exactly which stale surfaces it fixes.
- **Token kept out of `localStorage`** (in-memory only) — a deliberate XSS-hardening posture (the trade-off is H1's reload-logout).

---

## Top-10 prioritized remediation list

1. **C1 — Move invoice `subtotal`/`total` (and line amounts) to server-derived values; stop trusting client totals.** (M) Financial integrity; hard requirement before DROVE billing.
2. **H2 — Delete the three `*.legacy.tsx` pages + their routes.** (S) Removes ~4k lines of drifting, buggy, still-reachable code in one stroke.
3. **H4 — Extract tenant/branding config + tenant-scoped lookup tables (manufacturers, warranty rules, states, invoice-from, logo, currency).** (L) The core multi-tenant blocker; start now, it's the long pole.
4. **H1 — Persist the session across reloads (sessionStorage or httpOnly cookie) and extend draft coverage to staged photos/parts/line-items.** (M/L) Stops silent loss of in-progress work for field techs.
5. **M1 — Wrap the NewServiceCall parts-upload loop in try/catch so save always finalizes.** (S) Prevents duplicate calls / orphaned parts.
6. **M4 + C1 — Add a tenant-configurable tax line to invoices.** (M) Functional gap for most tenants; bundle with the server-side total work.
7. **M3 — Edit products only via the product mutations on the multi-product detail page; drop legacy scalar product fields from the edit form.** (M) Closes the dual-write drift that caused the description-wipe incident.
8. **M2 — Add `onError` toasts to delete/reorder mutations (and rollback on reorder failure).** (S) Ends silent failures.
9. **H3 — Debounce the service-call list search.** (S) Removes per-keystroke request storm before it matters at scale.
10. **M5 + L1 — Standardize React Query key conventions (kill the no-op string-key invalidation) and reset `expiredHandled` on login.** (S) Removes two latent stale-state traps.
