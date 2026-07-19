# RECOVERY INDEX — Fitzpatrick Warranty Service Tracker

## Purpose

This is a **business-critical, daily-use application**: the Fitzpatrick Warranty
Service Tracker. It is used in active operations, so continuity and recoverability
of the project state matter.

**The GitHub repository is the source of truth.** If there is ever any conflict
between what a planning tool, chat session, or task list shows and what is in the
repository, trust the repository.

> ⚠️ **Perplexity Projects / task visibility may be unreliable.** Task lists,
> project boards, or session history shown in the Perplexity UI can disappear,
> desync, or fail to load. Do **not** treat them as authoritative. Always
> reconstruct state from GitHub commit history first (see Recovery Procedure).

## Repository

| Field           | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Repo URL        | https://github.com/FitzWarranty26/fitzpatrick-service-tracker          |
| Default branch  | `master`                                                               |
| Visibility      | Public                                                                 |
| Description     | Warranty service tracking app for Fitzpatrick Warranty Service, LLC    |
| Production URL  | https://warranty.fitzpatricksalescrm.com/#/ (confirmed 2026-06-11)     |
| Current deploy  | `f61681e` — **Pre-migration batch Items 1–3** (PRs #90–#92) on production 2026-07-19; the "Next 1–2 weeks" ROADMAP items, run as the last work before the Postgres migration (Issue #7). Three sequential same-day deploys, each gated on `npm run check`+`test`+`build`, CI green, and prod HTTP 200 before the next; Kevin approved these deploys 2026-07-19 ~13:22 MDT. **Item 1** `18b740d` (PR #90) sessions + login rate limits moved from in-memory Maps to a shared better-sqlite3 store (`server/session-store.ts`, new `sessions`/`login_attempts` tables created idempotently at startup); httpOnly session cookie so reloads no longer log out; **one-time logout at this deploy** as old in-memory tokens cleared, persistent thereafter; additive, no schema migration to undo (7 tests). **Item 2** `0a1c6ce` (PR #91) `'Needs Return Visit'` added to the `SERVICE_STATUSES` enum (enum-only — the value already exists in prod data/SQL, no rows rewritten); standardized React Query keys in `ServiceCallDetail.tsx`; reset `expiredHandled` on login (3 tests). **Item 3** `f61681e` (PR #92) **versioned schema migrations** — replaced the inline startup migrations (up to "Migration 37") in `server/storage.ts` with `migrations/0000_baseline.sql` (schema snapshot dumped from a legacy-built DB, since `shared/schema.ts` diverges from the live DB) + a startup runner `server/migrate.ts` with a `schema_migrations` bookkeeping table. **Baselining:** an existing DB (production) is detected via the `service_calls` sentinel and the baseline is **marked applied WITHOUT executing**, so the live schema is never touched; a fresh DB builds from the baseline. Seed logic extracted to `server/seed.ts`; the CRM contact seed now runs explicitly via `npm run seed` (S6 admin hardening still auto on empty DB). Migrations run at **startup** (Render pre-deploy runs without the persistent disk mounted — see `render.yaml`). Post-deploy verified: 502 restart blip → sustained HTTP 200 + login serving, no crash-loop (baselining did not run DDL over live data); 5 tests, suite 51 → 56. **Rollback of Item 3 is safe** — old inline-migration code is idempotent and ignores the new `schema_migrations` table. Batch rollback anchor: pre-batch prod `44181e0`, or the prior merge in the chain (Item 2→`18b740d`, Item 3→`0a1c6ce`). Issue #64 (dual-storage removal) intentionally **deferred** to sequence with Issue #7. Prior `25f92d2` — **Phase 0.5 hardening sprint S8–S10** (PRs #86–#88) on production 2026-07-19; no schema/migration in any item. Three sequential same-day deploys, each gated on `npm run check`+`test`+`build`, CI green, and prod HTTP 200 before the next: **S8** `240ffe8` (PR #86) `validate(schema)` zod middleware (`server/validate.ts`) + per-route schemas (`server/validation-schemas.ts`) on users/invoices/visits/appointments — 400 with field-level errors, unknown keys stripped, offline-sync replay unaffected (13 tests); **S9** `79cadee` (PR #87) invoice line amounts + `subtotal`/`total` recomputed server-side from persisted items on create AND update, ignoring client totals, mirroring the client to the cent (no tax line today) — new `server/invoice-totals.ts` + golden-value tests (13), no backfill, response shape unchanged; **S10** `25f92d2` (PR #88) client-only error handling: try/catch on the NewServiceCall parts loop, `onError` toasts on the silent deletePhoto/deleteCall/deleteActivity/reorderPhotos mutations, 300 ms debounce on service-call search. Tests grew 15 → 41. Rollback: pre-S8 prod `0cc53bf` (sprint anchor), or the prior merge in the chain (S9→`240ffe8`, S10→`79cadee`). Prior `39ae074` — **Phase 0.5 hardening sprint S1–S6** (PRs #77–#82) on production 2026-07-19; no schema/migration in any item. Six sequential same-day deploys, each gated on `npm run check`+`test`+`build`, CI green, and prod HTTP 200 before the next: **S1** `ba5b9bc` (PR #77) CI now runs `npm test`; **S2** `fc83e41` (PR #78) `foreign_keys = ON` enabled at startup behind a read-only orphan-audit gate (fail-open) — new `server/orphan-audit.ts` + `scripts/audit-orphans.mjs` — verified ENABLED in production 2026-07-19 12:44 MDT (Render Shell audit: 0 orphans / 10 relationships, service restarted); **S3** `b1b27a2` (PR #79) `deleteServiceCall` now transactional and deletes `invoice_items` (was orphaning them); **S4** `b252acd` (PR #80) `DELETE /api/service-calls/:id` now `requireManager` (guards → `server/auth-guards.ts`); **S5** `b97cae6` (PR #81) removed three `*.legacy.tsx` pages + routes (~4,000 lines, client-only); **S6** `39ae074` (PR #82) seeded-admin password now from `SEED_ADMIN_PASSWORD` or crypto-random, never logged, existing prod users untouched. Tests grew 6 → 15. Rollback: pre-sprint prod `0a164cc` (PR #76), or the prior merge in the chain. Follow-ups closed: blank descriptions on calls #41/#85/#86 re-entered by Kevin 2026-07-19; PR #62 diagnostic reviewed and closed (S7). Prior `52b38de` — fix: photo uploads rejected with 413 (PR #67, fix commit `7704191`) on production 2026-07-17; no schema/migration. Root cause: the global `express.json({ limit: "1mb" })` parser in `server/index.ts` ran before (and silently overrode) the photo route's own 20MB parser in `server/routes.ts`, so any photo whose base64 body exceeded 1MB was rejected 413 (masked as "Internal Server Error" in production). Fix: global 1MB parser now skips `POST /api/service-calls/:id/photos` via `isPhotoUploadRequest` (new `server/photo-upload-path.ts`); route-level 20MB parser + existing 10MB-per-photo cap are now the real limits. Client: friendly "too large" toast via `photoUploadErrorMessage` (`client/src/lib/image-utils.ts`) across all 3 upload paths; +2 regression tests. Checks: test 6/6, check, build all PASS; post-deploy verified live via oversized-body probe (413 → 401 auth-gate response). Prior `69dae783` — harden legacy sync: non-destructive fill-only merge (PR #65, fix commit `0eb67775`) on production 2026-07-16; server-only hardening to `syncLegacyFromProduct` (`server/storage.ts`), no schema/migration — the sync now never overwrites a populated field with an empty/undefined/whitespace value (all 16 synced fields), plus 4 regression tests (`server/storage.test.ts`) and a `test` npm script. Permanent/class-kill fix following the same-day hotfix PR #61; full re-architecture tracked in issue #64. Checks: test 4/4, check, build all PASS; post-deploy app confirmed up (sign-in serving). Prior `87463c0` — fix: service call description wiped on create (PR #61, fix commit `3e292c2b`) on production 2026-07-16; server-only fix to `POST /api/service-calls`, no schema/migration — the multi-product `products[]` create path was blanking `issue_description`/diagnosis/resolution/claim via `syncLegacyFromProduct`. Data cleanup pending: real calls #41, #85, #86 have blank descriptions (unrecoverable, manual re-entry). Prior `5fbdf88` — assign-technician feature (PR #59, feature commit `36bffcb`) on production 2026-06-24; Migration 37 = additive nullable `assigned_technician_id` column (no backfill); adds Assign Technician dropdown on New Service Call, editable on detail, prominent Technician KPI cell, and list Tech column now COALESCEs assigned tech → visit tech. Prior `4ec990d` — service call creator attribution (PR #57, feature commit `24416b6`) on production 2026-06-24; Migration 36 = idempotent data-only backfill of `created_by` (no schema change). Prior `7970b4f` — visit-count + total-hours header fix (PR #55, fix commit `eba52ae`) on production 2026-06-24; client-only, no schema/migration. Prior `97b7b2b` (admin password reset + recovery script, PR #52, 2026-06-18), `26ba94a` (Service Map zoom/geocode fix, PR #50, Migration 35), `e28492b` (Issue #5 CI gate, PR #42, rollback anchor `known-good-2026-06-12`). |
| Auto-Deploy     | On Commit — merges to `master` trigger a Render deploy automatically    |
| Persistent disk | `DB_PATH=/var/data/warranty_tracker.db` on the `/var/data` persistent disk, **10 GB** (grown from 1 GB on 2026-06-12, Issue #4; ~14% used). Holds the live DB + on-disk backups. `render.yaml` declares plan/disk/DB_PATH. |
| Backups         | Render Cron Job `fitzpatrick-service-tracker-backup` (`crn-d8m2sn28qa3s73b0uqm0`), every 12h (`0 6,18 * * *` UTC), POSTs `/api/backup`. Files: `backup-am/pm.db` + `backup-{mon..sun}.db` on `/var/data`. Verified working + restorable 2026-06-12. Procedure: `ROLLBACK.md` §6. |
| Rollback anchor | **`known-good-2026-06-12` → `e28492b`** (current recommended; post-CI-gate). Baseline `known-good-2026-06-05` → `44e91ce`. Both re-verified deployable 2026-06-12 (Issue #6). See `ROLLBACK.md` §0. |

## Key Recent Commits

These are anchor points for reconstructing recent work. List is newest-first.

| Commit    | Description                                                              |
| --------- | ------------------------------------------------------------------------ |
| `6e42ecb` | Merge: sidebar categorization                                            |
| `b80f793` | Sidebar sections and "New Service Call" CTA                              |
| `0f4e161` | Merge: photo categorization                                              |
| `454a758` | Built-in / custom photo labels                                           |
| `7a50eeb` | Merge: tech feedback batch                                               |
| `801d170` | Lightbox nav / photo grouping / homeowner phone / internal flag          |
| `a9e0982` | Permission boundary fixes                                                |
| `d33959a` | Tier 4: schedule / visit / calendar / dashboard data flow                |
| `f03d1f7` | Tier 3: data integrity                                                   |
| `0f8e5cb` | Tier 2: fixes                                                            |
| `a858c55` | Tier 1: fixes                                                            |
| `26b0df8` | App-wide data integrity sweep                                            |

## Recovered Perplexity Session Pointers

These session IDs point to planning/research work done in Perplexity. They are
recorded here because the Perplexity UI may not surface them reliably. Use them
to locate prior context if the UI is available; otherwise treat them as
historical references only.

| Session ID | Topic                                          |
| ---------- | ---------------------------------------------- |
| `2d5f17b8` | Warranty tracker business feasibility          |
| `2251645a` | PO (purchase order) module planning            |
| `e57aa4b9` | WarrVault / FieldSeal naming                   |

## In Progress (not yet deployed)

_None._

## Recently Deployed

| Date       | Branch                              | Summary |
| ---------- | ----------------------------------- | ------- |
| 2026-07-19 | (Pre-migration batch, PRs #90–#92) | **Pre-migration batch Items 1–3** — three sequential production deploys, the "Next 1–2 weeks" ROADMAP items run before the Postgres migration (Issue #7). Each item: `check`/`test`/`build` PASS, CI green, prod HTTP 200 verified before the next. Tests 41 → 56. **Item 1** `18b740d` (PR #90): sessions + login rate limits moved from in-memory Maps to a shared better-sqlite3 store (`server/session-store.ts`; new idempotent `sessions`/`login_attempts` tables); httpOnly session cookie so reloads no longer log out; **one-time logout at this deploy** (old in-memory tokens cleared), persistent thereafter; additive, no schema migration to undo (7 tests). **Item 2** `0a1c6ce` (PR #91): `'Needs Return Visit'` added to `SERVICE_STATUSES` (enum-only, no rows rewritten); standardized React Query keys; reset `expiredHandled` on login (3 tests). **Item 3** `f61681e` (PR #92, HIGHEST CARE): versioned migrations — `migrations/0000_baseline.sql` (schema dumped from a legacy-built DB since `shared/schema.ts` diverges) + startup runner `server/migrate.ts` with a `schema_migrations` table; **baselining** marks the baseline applied WITHOUT executing on the existing prod DB (detected via `service_calls` sentinel), so the live schema is untouched; fresh DB builds from the baseline. Seed logic extracted to `server/seed.ts`; CRM seed now explicit (`npm run seed`), S6 admin hardening still auto on empty DB. Runs at **startup** (Render pre-deploy has no disk mounted). Post-deploy: 502 blip → sustained 200 + login serving, no crash-loop (5 tests). **Item 3 rollback is safe** — old inline migrations are idempotent and ignore `schema_migrations`. Batch rollback anchor: pre-batch prod `44181e0`, or the prior merge in-chain. Kevin approved these deploys 2026-07-19 ~13:22 MDT. Issue #64 (dual-storage removal) intentionally **deferred** to Issue #7. |
| 2026-07-19 | (Phase 0.5 sprint, PRs #77–#82) | **Hardening sprint S1–S6** — six sequential production deploys, no schema/migration. **S1** `ba5b9bc` (PR #77): CI runs `npm test`; `test` script → `tsx --test server/*.test.ts`. **S2** `fc83e41` (PR #78): `foreign_keys = ON` at startup behind a read-only orphan-audit gate (fail-open if orphans); new `server/orphan-audit.ts` + `scripts/audit-orphans.mjs` + 4 tests — **verified ENABLED in production 2026-07-19 12:44 MDT** (orphan audit clean, service restarted). **S3** `b1b27a2` (PR #79): `deleteServiceCall` transactional + deletes `invoice_items` (orphan fix) + regression test. **S4** `b252acd` (PR #80): `DELETE /api/service-calls/:id` → `requireManager`; guards extracted to `server/auth-guards.ts` + tests. **S5** `b97cae6` (PR #81): removed three `*.legacy.tsx` pages + routes (~4,000 lines, client-only). **S6** `39ae074` (PR #82): seeded-admin password from `SEED_ADMIN_PASSWORD` or crypto-random, never logged, `must_change_password` kept; existing prod users untouched (empty-DB only) + test. Each item: `check`/`test`/`build` PASS, CI green, prod HTTP 200 verified before the next. Tests 6 → 15. Rollback: pre-sprint prod `0a164cc` (PR #76), or the prior merge in-chain; known-good `known-good-2026-06-12` → `e28492b`. Follow-up closed 2026-07-19: blank descriptions on calls #41/#85/#86 re-entered by Kevin (field knowledge). PR #62 (read-only diagnostic) reviewed and closed (S7). |
| 2026-07-16 | (hardening branch, PR #65) | **Harden legacy sync: non-destructive fill-only merge** (PR #65, merge `69dae783`, fix commit `0eb67775`). No schema change, no migration. Permanent/class-kill fix for the description-wipe bug, following the same-day targeted hotfix PR #61. Server-only hardening to `syncLegacyFromProduct` (`server/storage.ts`): the legacy sync is now **non-destructive (fill-only merge)** — it never overwrites an already-populated field with an empty/`undefined`/whitespace-only value, applied to all **16** synced fields, so no code path (create, offline-sync replay, product edit, direct API caller) can wipe existing data. Adds **4 regression tests** (`server/storage.test.ts`) + a `test` npm script. Checks: `npm run test` 4/4 PASS, `npm run check` PASS, `npm run build` PASS. **Merged to `master` 2026-07-16** — Render auto-deploy; post-deploy verification: app confirmed up (sign-in serving). Rollback: prior deploy `87463c07` (PR #61); known-good `known-good-2026-06-05` → `44e91ce`. Full re-architecture (single source of truth for the description) remains tracked in **issue #64**. |
| 2026-07-16 | (fix branch, PR #61) | **Fix service call description wiped on create** (PR #61, merge `87463c0`, fix commit `3e292c2b`). No schema change, no migration. Server-only fix to `POST /api/service-calls`: the multi-product `products[]` create path sent identity-only products, so `syncLegacyFromProduct()` copied Product 1's absent narrative fields back onto the parent row and blanked `issue_description`/diagnosis/resolution/claim. If-branch now merges call-level narrative/claim fields onto Product 1 (idempotent sync); also fixes the offline-sync replay path. **Merged to `master` 2026-07-16** — Render auto-deploy; post-deploy verification: app confirmed up (sign-in serving). Rollback: `known-good-2026-06-05` → `44e91ce`. **Follow-ups pending:** real calls #41, #85, #86 have blank descriptions requiring manual re-entry (unrecoverable); recommend hardening `syncLegacyFromProduct` (non-destructive), single source of truth for description, and a regression test for the `products[]` create path. Root cause in `bug-findings.md`. |
| 2026-06-24 | `feature/service-call-creator-attribution` | **Service call creator attribution** (PR #57, merge `4ec990d`). Stamps `service_calls.created_by` from the session on create; shows "Logged by {name}" on the call list and "Created By" on the detail page (manager-reassignable); resolves `created_by_name`/`createdByName` in the list/detail APIs; **Migration 36** idempotently backfills existing calls' creators from `audit_log_system` `created_call` entries (NULL-only, never overwrites). Reports → Team Workload now populates. **Merged to `master` 2026-06-24 after green CI** — Render auto-deploy. Post-deploy smoke OK (root 200; /api/service-calls 401/auth-gated). Rollback: `known-good-2026-06-12` → `e28492b`. |

<!-- legacy table below retained -->

| Date       | Branch                              | Summary                                                                                                                            | State                                                  |
| ---------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-06-18 | `feature/admin-password-reset-and-recovery` | **Admin password reset button + manager-lockout recovery script** (PR #52, merge `97b7b2b`). No schema change. Team page gains a manager-only per-row **Reset Password** button (focused dialog, 8-char min, reuses `PATCH /api/users/:id`, user forced to change at next login). New committed `scripts/reset-password.mjs` Render-Shell escape hatch for full manager lockout (backs up DB, bcryptjs cost 12, re-activates account, sets `must_change_password`, audit row). Relates to Issue #10. | **Approved by Kevin & merged to `master` 2026-06-18** — Render auto-deploy triggered. CI check-and-build gate passed. Rollback: `known-good-2026-06-12` → `e28492b`. |
| 2026-06-15 | `fix/map-fit-and-geocode-bounds` | **Service Map zoom & out-of-region geocoding fix** (Migration 35, PR #50, merge `26ba94a`). Map had opened zoomed out to the whole world with a stray pin off the coast of India — the initial auto-fit was extending bounds to **every** pin including one bad geocode near India. Fix: client auto-fit now extends only with in-region pins (`REGION_MAX_BOUNDS` Utah+S.Idaho, `inRegion()`), `minZoom: 4`, out-of-region pins still drawn with a "check address" popup note; Nominatim geocoder bounded to US + region (`countrycodes=us`, viewbox, US-box sanity check); Migration 35 nulls out-of-US coords for unlocked rows (never deletes calls, never touches `coords_locked=1`, idempotent). | **Approved by Kevin & merged to `master` 2026-06-15 17:27 MDT** — Render auto-deploy triggered. Post-deploy smoke OK (root 200; needs-geocoding endpoint 401/auth-gated). Rollback: `known-good-2026-06-12` → `e28492b`. |
| 2026-06-15 | `feature/map-improvements` | **Service Map & geolocation improvements** (Migration 34, column `coords_locked`, PR #48, merge `a523ffe`). Utah-first auto-widen default view + "Fit to Utah" button; marker clustering (`leaflet.markercluster`); server-side status filter; re-geocode on address edit; "needs geocoding" panel + per-call retry; background `geocode-all` job with progress; color-by-status toggle; heat-map toggle (`leaflet.heat`); manual pin drag-to-correct (locked pins skip geocoding). | **Approved by Kevin & merged to `master` 2026-06-15 17:02 MDT** — Render auto-deploy triggered. Post-deploy smoke OK (root 200; new endpoints 401/auth-gated). Rollback: `known-good-2026-06-12` → `e28492b`. |
| 2026-06-15 | `feature/multi-product-service-calls` | **Multi-product service calls** (Migration 33, PR #46, merge `e910fdc`). New `service_call_products` table lets one call hold multiple units, each with its own manufacturer/model/serial/type/install date, warranty, diagnosis/resolution, and claim+cost fields. Backfills Product 1 from legacy columns; legacy columns retained and synced to Product 1. New-call form gains "Add another product"; detail page gains a Products section with Add/Edit/Remove per visit. | **Approved by Kevin & merged to `master` 2026-06-15 16:07 MDT** — Render auto-deploy triggered. Post-deploy smoke OK (root 200; products endpoint 401/auth-gated). Rollback: `known-good-2026-06-12` → `e28492b`. |
| 2026-06-11 | `feature/installation-review-notes` | Adds internal "Installation Review Notes" field (Migration 32). Excluded from printed/emailed reports by default with opt-in toggle. Residential + commercial. | **Approved by Kevin & merged to `master` 2026-06-11** — Render auto-deploy triggered on commit |

> Deploy approved by Kevin ("Merge and deploy", 2026-06-11 11:09 MDT) and merged
> to `master` (fast-forward). Render Auto-Deploy = On Commit, so the push to
> `master` triggers an automatic production deploy. The additive nullable
> `installation_review_notes` column migration (Migration 32) runs at startup on
> deploy and does not affect existing rows. See `CHANGELOG.md` and
> `DEPLOYMENT-LOG.md` for the full deploy record and rollback point.

## Admin Password Recovery (manager lockout)

If a user forgets their password, a **manager** resets it in-app: Team page →
the user's row → **Reset Password** (or the Edit User dialog's password field).
The user is forced to set a new password at next login.

If **no working manager account** is available (admin lockout), use the
committed recovery script from the **Render Shell** of the
`fitzpatrick-service-tracker` web service:

```bash
node scripts/reset-password.mjs <username> <newPassword>
```

It reads `DB_PATH` (production `/var/data/warranty_tracker.db`), writes a
timestamped `manual-backup-*.db` beside the live DB first, hashes with
`bcryptjs` (cost 12), re-activates the account, sets `must_change_password = 1`,
and writes a `password_reset_cli` audit row. Note: the per-IP login lockout is 5
failed attempts; it clears on its own after the lockout window (or on app
restart), so a "Too many login attempts" message is not a password problem.

## Legacy → Product 1 Divergence Report (Issue #64 prep)

`service_calls` carries 16 legacy columns duplicated on `service_call_products`
(`product_index = 1`). The detail-page edit path updates only `service_calls`,
so the Product 1 row can drift stale. **Before** any legacy → product1
reconciliation, run this **read-only** report from the **Render Shell** to see
exactly what a reconcile would change:

```bash
node scripts/audit-legacy-divergence.mjs
```

It reads `DB_PATH` (production `/var/data/warranty_tracker.db`), opens the DB
`readonly` (cannot write), and prints, per diverged call, the legacy value a
reconcile would keep/copy vs the stale product1 value it would overwrite —
plus a `REVIEW: possible deliberate clear` flag (product1 blanked more recently
than the call), calls with no Product 1 row, and summary counts. No customer
names/addresses are printed. Exits 0; makes no changes.

## Recovery Procedure

To reconstruct project state, follow these steps **in order**:

1. **GitHub commit history first.** Clone or pull
   `https://github.com/FitzWarranty26/fitzpatrick-service-tracker` (branch
   `master`) and read the commit log. This is the authoritative record of what
   the application actually is and does.

2. **Session IDs / artifacts next.** If you need planning or research context
   beyond the code, use the recovered Perplexity session pointers above to locate
   the relevant prior work and any associated artifacts.

3. **Perplexity UI last — only if restored.** If (and only if) the Perplexity
   Projects / task UI is functioning and trustworthy again, use it to fill in
   remaining gaps. Never rely on it as the primary source.

## Future Work Protocol

Any future change to this business-critical app — by a person or an automated
agent — must follow this protocol:

1. **Start at the CRM recovery hub.** Read `BUSINESS-APP-RECOVERY-HUB.md` in the
   CRM repository **first** for cross-app context and the current source of
   truth before touching this project.

2. **Read this recovery index.** Re-read this `RECOVERY-INDEX.md` to confirm the
   repository is authoritative and to load the latest recovery context.

3. **Check the current state.** Review git history, open GitHub issues, and open
   PRs before starting, so work builds on the real current state rather than a
   stale plan or task board.

4. **Branch for significant changes.** Create a dedicated branch for any
   non-trivial change. Reserve direct commits to `master` for small, low-risk
   documentation or safety updates.

5. **Run checks before deploy.** Run `npm run check` (TypeScript) and
   `npm run build` (and a smoke test where possible) before deploying. Do not
   deploy code that fails these checks. **CI runs these automatically on every
   pull request to `master`** (see CI Gate below) — wait for a green run before
   merging.

6. **Update the logs after meaningful work.** After any meaningful change,
   update `CHANGELOG.md`, `DEPLOYMENT-LOG.md`, and this `RECOVERY-INDEX.md` so
   the record stays accurate.

7. **Tag and record rollback points for major releases.** For major releases,
   create a `known-good-YYYY-MM-DD` git tag, add a row to the **§0 targets
   table** in `ROLLBACK.md`, and record the rollback point in
   `DEPLOYMENT-LOG.md` so a safe restore target always exists. Periodically
   rehearse the rollback (non-destructive: checkout the tag, run
   `npm run check` + `npm run build`) and log it in `ROLLBACK.md` §5a.

## CI Gate & Deploy Relationship (Issue #5)

**Render Auto-Deploy is ON for `master`** — every push/merge to `master` deploys
straight to production. There is no manual gate at the Render side, so the
safety gate lives in GitHub.

- **CI workflow:** `.github/workflows/ci.yml` (job `check-and-build`) runs
  `npm run check` (tsc) and `npm run build` on:
  - every **pull request** targeting `master` (catch problems before merge), and
  - every **push to `master`** (backstop).
- **Required workflow:** make changes on a **branch**, open a **PR**, and merge
  **only after CI is green.** This keeps broken type-checks/builds from
  auto-deploying to production.
- **Recommended hardening (one-time, in GitHub UI):** Settings → Branches → add
  a protection rule for `master` → require the **`check-and-build`** status
  check to pass before merging (and optionally require a PR). Until this is
  enabled, CI reports status but does not *block* a merge.

## Operational Safety Documents

| Document             | Purpose                                                     |
| -------------------- | ----------------------------------------------------------- |
| `CHANGELOG.md`       | Notable changes over time (Keep a Changelog format)         |
| `DEPLOYMENT-LOG.md`  | Per-deployment record and rollback points                   |
| `ROLLBACK.md`        | Step-by-step rollback via GitHub and the deploy provider    |
| `.github/workflows/ci.yml` | CI gate: runs `check` + `build` on PRs/pushes to `master` |
| `.github/ISSUE_TEMPLATE/` | Standardized bug report and feature request templates  |
| `docs/adr/`          | Architecture Decision Records (e.g. ADR 0001 — commercial hosting: Render + Supabase, AWS as scale-up target; Issue #27) |
