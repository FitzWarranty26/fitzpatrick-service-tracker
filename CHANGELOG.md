# Changelog

All notable changes to the Fitzpatrick Warranty Service Tracker are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2026-07-17] — Fix photo uploads rejected with 413 (body-limit override)

Deployed to production 2026-07-17 (commit `52b38de`, merge of PR #67, fix
commit `7704191`). No schema change, no migration. Post-deploy verified live
via oversized-body probe (pre-deploy 413 → post-deploy 401 auth-gate response).

### Fixed — Photo uploads rejected with 413 (global 1MB body limit overrode photo route's 20MB limit)

Service techs saw `413: {"message":"Internal Server Error"}` ("X uploaded, Y
failed") when uploading detail-heavy photos. Root cause: `server/index.ts`
registered a **global** `express.json({ limit: "1mb" })` body parser that ran
before the photo upload route's own `express.json({ limit: "20mb" })` in
`server/routes.ts`. The global parser threw `PayloadTooLargeError` (status 413,
masked as "Internal Server Error" by the production error handler) for any body
over 1MB — and a compressed photo (1600px / JPEG q0.7) can reach ~1MB binary →
~1.4MB base64, exceeding the cap. The route-level 20MB parser never ran.

Fix (server, `server/index.ts` + new `server/photo-upload-path.ts`): the global
1MB JSON parser now **skips** `POST /api/service-calls/:id/photos` via the
`isPhotoUploadRequest` predicate, so the route's own 20MB parser is the real
limit. The route's existing 10MB-per-photo cap (400 "Photo too large") is
unchanged.

Fix (client): photo-upload failures now map 413 (and the server's 400 "Photo too
large") to a friendly "<file> is too large to upload. Try a smaller photo."
message via a shared `photoUploadErrorMessage` helper in
`client/src/lib/image-utils.ts`, applied across all three upload paths
(`ServiceCallDetail` review + save flows, `NewServiceCall` create flow).

### Added — Regression tests for the body-limit skip predicate

- 2 tests in `server/storage.test.ts` covering `isPhotoUploadRequest` (matches
  the POST upload route only; ignores GET, reorder, delete, and other routes).
- `npm run check`, `npm run build`, and `npm run test` all pass.

### Added — Full code review + consolidated ROADMAP.md (docs only, no code change)

- `docs/CODE-REVIEW-2026-07-17.md`: two-pass (server + client) severity-ranked
  code review with file:line evidence, triggered by the 2026-07-16
  description-wipe incident and 2026-07-17 photo 413. Headline: solid
  single-tenant codebase; multi-tenant readiness blocked by tenant scoping,
  client-computed invoice totals, non-transactional deletes, unenforced FKs,
  in-memory sessions, and thin test coverage.
- `ROADMAP.md`: new single working roadmap. Supersedes the April 2026 launch
  roadmap PDF (retired). Consolidates the June phase issues (#7–#36), ADR-0001,
  Issue #64, open loose ends (PR #62, blank-description data cleanup for calls
  #41/#85/#86), and adds Phase 0.5 hardening with the 2026-07-18/19 weekend plan.

## [2026-07-16b] — Harden legacy sync: non-destructive fill-only merge

Deployed to production via PR #65 (merge commit `69dae783`, fix commit
`0eb67775`). No schema change, no migration. Rollback anchor: prior deploy
`87463c07` (PR #61); known-good `known-good-2026-06-05` → `44e91ce`.

### Fixed — `syncLegacyFromProduct` no longer overwrites populated fields with empty values

Permanent, class-kill hardening fix for the description-wipe bug, following the
same-day targeted hotfix (PR #61). PR #61 patched the single `POST
/api/service-calls` create path, but `syncLegacyFromProduct` itself was still
destructive: any caller that saved a Product 1 row with an absent
narrative/claim field would blank the corresponding populated column on the
parent `service_calls` row.

Fix (server-only, `server/storage.ts`): `syncLegacyFromProduct` is now a
**non-destructive, fill-only merge** — it never overwrites an already-populated
field with an empty, `undefined`, or whitespace-only value. Applied uniformly to
all **16** synced fields, so the legacy sync can no longer wipe existing data
regardless of which code path (create, offline-sync replay, product edit, or a
direct API caller) triggers it.

### Added — Regression tests + `test` npm script

- **4 regression tests** in `server/storage.test.ts` covering the fill-only
  merge (populated fields preserved when a product omits them; genuinely new
  values still written). Added a `test` npm script to run them.
- `npm run test` (4/4 pass), `npm run check`, and `npm run build` all pass. Full
  re-architecture (single source of truth for the description) remains tracked in
  **issue #64**.

## [2026-07-16] — Fix service call description wiped on create (multi-product sync)

Deployed to production via PR #61 (merge commit `87463c0`, fix commit
`3e292c2b`). No schema change, no migration. Rollback anchor:
`known-good-2026-06-05` → `44e91ce`.

### Fixed — New service call Issue Description (and diagnosis/resolution/claim) blanked on create

Creating a service call through the **New Service Call** form silently blanked the
**Issue Description** (and Diagnosis / Resolution / all Claim fields) on the saved
call.

Root cause: the form always sends a `products[]` array whose entries carry only the
identity columns (manufacturer, model, serial, type, install date) and **omit** the
narrative/claim fields. On `POST /api/service-calls`, `createServiceCall` stored the
description correctly, but saving Product 1 then triggered `syncLegacyFromProduct()`,
which copied **all** of Product 1's columns — including `issue_description = NULL` —
back onto the parent `service_calls` row, overwriting the text the user just typed.
Older calls (created before the form began sending `products[]`) were unaffected
because they went through the server's `else` branch, which built Product 1 *with*
the narrative fields.

Fix (server-only, `server/routes.ts`): the `POST /api/service-calls` if-branch now
merges the call-level narrative/claim fields (`issueDescription`, `diagnosis`,
`resolution`, `claim*`) onto Product 1 before saving, so `syncLegacyFromProduct`
writes back the same values `createServiceCall` already stored instead of NULL. The
operation is idempotent and does not change `syncLegacyFromProduct` itself, so the
product editor is unaffected. Because the fix is server-side it also covers the
offline-sync replay path and any direct API caller posting identity-only products.

`npm run check` and `npm run build` pass. **Data cleanup pending:** real calls
**#41, #85, #86** were created through the buggy path and have blank descriptions
that must be **manually re-entered** (text is unrecoverable). **Hardening
recommended:** make `syncLegacyFromProduct` non-destructive (never overwrite a
populated field with an empty one), define a single source of truth for the
description, and add a regression test for the `products[]` create path.

## [2026-06-24] — Assign Technician on service calls (dropdown, editable, prominent)

Adds a first-class **assigned technician** to service calls. A technician can
now be chosen directly when logging a New Service Call, changed later from the
detail page, and is shown prominently instead of being implied only by a visit.
Branch `feature/assign-technician`. Includes **Migration 37** (additive,
nullable `service_calls.assigned_technician_id` column — no data backfill).
Rollback anchor: `known-good-2026-06-12` → `e28492b`.

### Added — Technician assignment captured, editable, and surfaced

- **New Service Call form:** an **Assign Technician** dropdown now sits at the
  top of the Scheduling card (options = active users with role tech / manager /
  sales, plus an explicit *Unassigned*). The chosen technician is sent on
  `POST /api/service-calls` as `assignedTechnicianId`.
- **Editable after scheduling:** the **Service Call detail** page shows an
  **Assigned Technician** row in Call Information and an editable dropdown in
  edit mode; the change persists via `PATCH /api/service-calls/:id`. A prominent
  **Technician** cell was added to the detail header KPI strip (now 7 cells) so
  the assignment is visible at a glance rather than buried under Visits.
- **Schema / persistence:** `shared/schema.ts` adds `assignedTechnicianId` to
  `serviceCalls`. Unlike `createdBy`, it is intentionally **user-settable** on
  both create and update, so it is **not** omitted from `insertServiceCallSchema`
  — `POST` and `PATCH` accept it automatically and `createServiceCall` /
  `updateServiceCall` persist it.
- **List "Tech" column:** `getAllServiceCalls` now resolves
  `primary_technician_id` / `primary_technician_name` as
  `COALESCE(sc.assigned_technician_id, most-recent visit's technician)`. The
  Service Calls list Tech column and the "My Calls" filter therefore reflect the
  explicitly assigned technician, and fall back to the visit-derived technician
  for legacy calls that predate the column.
- **Migration 37:** `ALTER TABLE service_calls ADD COLUMN assigned_technician_id
  INTEGER`. Additive, nullable, guarded by `columnExists` (idempotent); no
  backfill — existing calls start NULL ("Unassigned") and keep their
  visit-derived Tech value via the COALESCE fallback.

## [2026-06-24] — Service call creator attribution (capture, display, retroactive backfill)

Adds first-class “who created this service call” tracking. Branch
`feature/service-call-creator-attribution`. Includes **Migration 36** (a
one-time, idempotent data backfill — no schema/column change). Rollback anchor:
`known-good-2026-06-12` → `e28492b`.

### Added — Creator captured, shown, and recoverable for past calls

Every new service call now records the **creator** (the authenticated user who
logged it), it is shown in the UI, and existing calls are backfilled.

- **Capture (going forward):** `POST /api/service-calls` now stamps
  `service_calls.created_by` from the authenticated session
  (`req.user.id`) — never from the request body. The `created_by` column has
  existed since Migration 11 but was never written; this is the first code that
  populates it. `shared/schema.ts` now exposes `createdBy`; it is omitted from
  `insertServiceCallSchema` so it cannot be spoofed via the create body.
- **Display:** the **Service Call list** (desktop rows + mobile cards) shows a
  subtle “Logged by {name}” line under the customer/site; the **Service Call
  detail** page shows “Created By {name}” in Call Information and lets a manager
  reassign the creator from the edit view. `GET /api/service-calls` resolves the
  creator’s display name (`created_by_name`) via a `users` subquery, and
  `GET /api/service-calls/:id` returns `createdByName`. The existing **Reports →
  Team Workload** section (which groups calls by `created_by`) now populates
  because the column finally has data.
- **Retroactive backfill (Migration 36):** for any existing call with a NULL
  creator, recovers the creator from the audit log — the earliest
  `created_call` / `service_call` entry’s `user_id` (`audit_log_system`). Only
  fills NULL rows, never overwrites an existing value, and is idempotent (skips
  already-attributed rows on every boot). Calls created before audit logging
  existed remain NULL and surface gracefully as “Unknown.”
- **Manager reassignment:** `PATCH /api/service-calls/:id` accepts an explicit
  `createdBy` (numeric user id, or null to clear) so the detail page’s “Created
  By” editor keeps working even though `createdBy` is omitted from the insert
  schema.

No customer-facing data is exposed; creator is an internal team attribution
only. `npm run check` and `npm run build` pass.

## [2026-06-24] — Fix visit count + total hours on Service Call detail header

Deployed to production via PR #55 (merge commit `7970b4f`, fix commit
`eba52ae`). No schema change, no migration. Rollback anchor:
`known-good-2026-06-12` → `e28492b`.

### Fixed — Service Call detail header undercounted visits and hours

On the Service Call detail screen, the header **VISITS** KPI and the **Visits**
tab badge always read **1**, and **HOURS ON JOB** showed only the original
visit's hours, even when return visits existed. Reported on Call #65 (Visit 1 =
7h, return Visit 2 = 4h): header showed `1 visit / 7h` and the tab badge showed
`1` — all incorrect.

Root cause: the count was `(call.visits?.length || 0) + 1`, but
`GET /api/service-calls/:id` (`getServiceCallById`) never populates a `visits`
array on the call object (it returns only `photos`, `parts`, `activities`,
`products`), so the value was hardcoded to 1. The Hours KPI likewise read only
`call.hoursOnJob`, ignoring return-visit hours.

Fix (client-only, `client/src/pages/ServiceCallDetail.tsx`): compute both from
the already-loaded `visits` query array — `visitCount = visits.length + 1`
(return visits + the original Visit 1, which drives both the header KPI and the
tab badge) and `totalHoursOnJob = call.hoursOnJob + sum(visits[].hoursOnJob)`,
formatted to drop a trailing `.0`. Call #65 now correctly shows **2 visits**
and **11h**. Single-visit calls are unchanged; a scheduled return visit with no
logged hours counts toward visits but not hours. No backend or schema change.

## [2026-06-18] — Admin password reset button + manager-lockout recovery script

No schema change, no migration. Rollback anchor: `known-good-2026-06-12` →
`e28492b`.

### Added — Per-row "Reset Password" action (Team page)

- The Team / user-management screen now shows a dedicated **Reset Password**
  button on each active user row (managers only). It opens a focused reset-only
  dialog (new password + confirm, 8-char minimum, passwords-match validation)
  instead of requiring the manager to open the full Edit User dialog. On submit
  it reuses the existing `PATCH /api/users/:id` endpoint with a `password`
  field — no new backend route. The target user is forced to set a new password
  at next login (`must_change_password = 1`), and the change is recorded in the
  system audit log exactly as before. UI-only change; server logic unchanged.

### Added — `scripts/reset-password.mjs` (manager-lockout escape hatch)

- New repo-committed Node script for the case where **no working manager
  account** exists to reset a password from the app (admin lockout). Run from
  the Render Shell: `node scripts/reset-password.mjs <username> <newPassword>`.
  It reads the DB from `DB_PATH` (production `/var/data/warranty_tracker.db`),
  writes a timestamped safety backup beside it, hashes with the same `bcryptjs`
  cost factor (12) the app uses, re-activates the account, sets
  `must_change_password = 1`, and writes a `password_reset_cli` audit row.
  Validated locally against a throwaway DB (correct password verifies, old one
  rejected, unknown-username handled). Documented in `RECOVERY-INDEX.md`.

## [2026-06-15c] — Service Map zoom & out-of-region geocoding fix

Deployed to production via PR #50 (merge commit `26ba94a`); Migration 35 runs at
startup. Rollback anchor: `known-good-2026-06-12` → `e28492b`.

### Fixed — Service Map zoom & out-of-region geocoding

Follow-up to the 2026-06-15b Service Map work. After deploy, the map opened
zoomed out to the whole world and a stray pin appeared off the coast of India.
Root cause: the initial auto-fit extended the map bounds to **every** pin,
including one bad geocode in the ocean near India — so the fit spanned Utah to
India and zoomed all the way out. Three-part fix:

- **Client (`ServiceMap.tsx`):** initial auto-fit now extends bounds **only**
  with in-region pins (new `REGION_MAX_BOUNDS` = Utah + S. Idaho,
  `[[36.0,-115.5],[44.5,-108.0]]`, via `inRegion()` helper), so a single bad
  coordinate can never blow the fit out to the globe. Added `minZoom: 4`.
  Out-of-region pins are still rendered (no data hidden) but now carry a
  popup warning "⚠ Location looks out of service area — check address" and no
  longer drive the fit. "Fit to Utah" reset button and once-only fit behavior
  unchanged.
- **Server (`routes.ts`, `geocodeAddress`):** Nominatim query now constrained
  to the US + service region (`countrycodes=us`, bounded `viewbox`), plus a
  belt-and-suspenders US-box sanity check (lat 24..50, lng -125..-66) that
  rejects any match outside it. An ambiguous address can no longer match the
  other side of the planet.
- **Data — Migration 35** (`storage.ts`, guarded/idempotent): nulls `latitude`/
  `longitude` for any `coords_locked = 0` row whose stored coords fall outside
  the US box, so it returns to the needs-geocoding list and can be retried.
  **Never deletes a call; never touches manually-locked pins** (`coords_locked = 1`).
  Verified on a fresh boot: cleared 1 out-of-region row, preserved a good Utah
  row and a locked out-of-region row; idempotent on rerun.

No new dependencies. Stays on free OpenStreetMap/Nominatim.

## [2026-06-15b] — Service Map & geolocation improvements

Deployed to production via PR #48 (merge commit `a523ffe`); Migration 34 runs at
startup. Rollback anchor: `known-good-2026-06-12` → `e28492b`.

### Added — Service Map & geolocation improvements

Review-and-improve pass on the Service Map (3 phases).

- **Utah-first default view:** the map now opens framed on Utah (bounds `[[36.95,-114.10],[42.05,-109.00]]`) instead of a wide multi-state view. On first data load it fits the **union** of Utah with the actual pin bounds — never tighter than Utah, and auto-widens only if pins fall outside it (e.g. Southern Idaho), so future S. Idaho coverage just works. No hard `maxBounds` lock (panning to Idaho still allowed). New **"Fit to Utah"** reset button.
- **Marker clustering** via `leaflet.markercluster`: dense areas (SLC/Provo corridor) collapse into count bubbles that expand on zoom. Colored icons + escaped popups preserved.
- **Server-side status filter:** the status filter is now applied server-side so the pin count is accurate (previously client-only).
- **Re-geocode on address edit:** editing a call's job-site address now clears stale coordinates and re-geocodes in the background (skips manually-placed pins).
- **"Needs geocoding" panel:** new `GET /api/analytics/needs-geocoding` lists calls with an address but no coordinates; per-row **Retry** (`POST /api/service-calls/:id/geocode`) and a link to the call.
- **Background Geocode All:** `POST /api/geocode-all` now runs as a non-blocking background job (202/409) with `GET /api/geocode-all/status` for live `done/total` progress — no more gateway-timeout risk on large backfills. Keeps the 1.1s Nominatim throttle; skips locked pins.
- **Color-by-status toggle:** switch pin color between Manufacturer (default) and call Status; legend updates accordingly.
- **Heat-map toggle:** Pins (clustered) vs Heat density view via `leaflet.heat`.
- **Manual pin drag-to-correct:** editors can drag a misplaced pin; on confirm, `POST /api/service-calls/:id/coords` saves the location, sets `coords_locked = 1` (audit-logged `moved_pin`), and shows a "Manually placed" badge/note. Background re-geocode and Geocode All both skip locked pins.
- **Schema / Migration 34** (`columnExists`-guarded, additive, idempotent): adds `coords_locked INTEGER DEFAULT 0` to `service_calls`.
- **New deps (all free):** `leaflet.markercluster`, `leaflet.heat`, `@types/leaflet.markercluster`. Stays on free OpenStreetMap/Nominatim.

## [2026-06-15] — Multi-product service calls

Deployed to production via PR #46 (merge commit `e910fdc`); Migration 33 runs at
startup. Rollback anchor: `known-good-2026-06-12` → `e28492b`.

### Added — Multi-product service calls

A service call can now hold **multiple products** (e.g. a tech dispatched for one
water heater finds two on site). Previously a call held exactly one product as
flat columns on `service_calls`.

- **Schema / Migration 33** (`columnExists`/`hasTable`-guarded, additive,
  idempotent): new `service_call_products` table — one row per physical unit on
  a call, each with its own `manufacturer` / `manufacturer_other` /
  `product_model` / `product_serial` / `product_type` / `installation_date`,
  per-unit `issue_description` / `diagnosis` / `resolution`, per-unit warranty
  **claim** fields (`claim_status` / `claim_number` / `claim_notes` /
  `parts_cost` / `labor_cost` / `other_cost` / `claim_amount`),
  `discovered_visit_number` (which visit the unit was found on), a soft-delete
  `voided` flag, and `product_index` for ordering. Migration backfills a
  "Product 1" row for every existing call from the legacy single-product
  columns. **Legacy columns on `service_calls` are retained and kept in sync
  with Product 1** for backward-compat (reports/equipment search still read
  them); they can be retired in a later cleanup once every surface reads the
  new table.
- **Storage / API**: `getProductsByServiceCallId`, `createServiceCallProduct`
  (auto-assigns `product_index`, syncs legacy columns when index = 1),
  `updateServiceCallProduct`, `voidServiceCallProduct` (guarded so a call always
  keeps ≥1 active product). New routes mirror the parts/visits pattern
  (`requireEditor`, audit-logged): `GET/POST /api/service-calls/:id/products`,
  `PATCH/DELETE /api/products/:id`. `getServiceCallById` now returns a `products`
  array; `deleteServiceCall` cleans up product rows.
- **New Service Call form**: "Product Information" is now a products list
  (react-hook-form `useFieldArray`) with an **"Add another product"** button that
  pre-fills manufacturer/type from the previous product. Captures product
  identity per unit; diagnosis/claim are filled in later on the detail page.
- **Service Call Detail**: a **Products** section listing each active unit with
  a per-product warranty badge, per-unit diagnosis/resolution and claim summary,
  plus **Add Product** (tagged with the current visit number — works on visit 1
  and any later visit), **Edit**, and **Remove (void)**. A "N products" roll-up
  badge appears when a call has more than one active product.
- **Lists / dashboards**: "N products" badge on `ServiceCallList`, `Dashboard`,
  and `ManagerDashboard` (counts active products only; no double-counting).
- **Equipment search & PDFs**: serial lookup spans all product serials; the
  service-call PDF lists every active product with per-unit warranty/claim.
  Aggregate reports intentionally continue to read Product 1/legacy to avoid
  double-counting calls.

Verified locally: `npm run check` (tsc) and `npm run build` both pass; Migration
33 boots cleanly and backfills on a legacy-shaped DB; create-with-products,
add/edit/void, the last-product guard, per-unit warranty computation, and the
detail/new-call UIs were smoke-tested end-to-end.

## [2026-06-12] — Commercial hosting platform decision (Issue #27)

Phase 0 / Issue #27 (Review commercial hosting platform decision before
launch). Documentation/decision only — no application code or production change.

### Added

- **ADR `docs/adr/0001-commercial-hosting-platform.md`** — records the decision
  to launch DROVE's commercial SaaS on **Render (Express app) + Supabase
  (managed Postgres, RLS tenant isolation, Storage, Auth, mobile SDKs)**, with
  **AWS documented as the future scale-up target**. Compares Render, Railway,
  Fly.io, AWS, and Supabase across managed Postgres, PITR, object storage,
  multi-tenancy, mobile, compliance, uptime, pricing, and ops burden.
  Architecture boundary: **all business logic stays in Express on Render;
  Supabase is managed infrastructure only.** Notes that GitHub remains the
  source of truth (CI gate, branch protection, rollback tags unchanged) and
  ties the rollout to Issue #7 (SQLite → Postgres migration).

## [2026-06-12] — Rollback rehearsal + new known-good tag (Issue #6)

Phase 0 / Issue #6 (Rehearse rollback and create a current production rollback
tag). No application code or production change — production was not redeployed.

### Added

- **New rollback tag** `known-good-2026-06-12` → `e28492b` (current `master`
  after the CI gate landed) as the recommended Git rollback target.
- **`ROLLBACK.md` §0 — Known-good rollback targets** table listing both tags.
- **`ROLLBACK.md` §3 rewritten** to document **two rollback methods** with a
  decision guide: **Method 1** = Render native "Rollback to this deploy"
  (fastest, no rebuild) and **Method 2** = Git revert/tag + redeploy through a
  CI-gated PR (permanent fix). Notes that Method 1 alone is temporary because
  Render auto-deploys `master`.
- **`ROLLBACK.md` §5a — Rollback rehearsal log** documenting the 2026-06-12
  non-destructive code-rollback dry-run.

### Verified

- Rehearsed the Git-tag rollback path against `known-good-2026-06-05`
  (`44e91ce`): `npm run check` and `npm run build` both pass (exit 0). No
  database operations; live DB and backups untouched.

## [2026-06-12] — CI gate for check + build (Issue #5)

Phase 0 / Issue #5 (Add CI gate before production deploys). No application code
or production change — adds automated validation in GitHub.

### Added

- **CI workflow** `.github/workflows/ci.yml` (job `check-and-build`): runs
  `npm run check` (tsc) and `npm run build` on every **pull request to
  `master`** and on **pushes to `master`** (backstop). Node 20, `npm ci` with
  npm caching, 15-min timeout, concurrency cancellation.
- **Documented the CI/deploy relationship** in `RECOVERY-INDEX.md`: Render
  auto-deploys `master`, so the safety gate lives in GitHub — branch, PR, merge
  only after CI is green. Includes the one-time branch-protection step to make
  `check-and-build` a *required* status check that blocks merge.

## [2026-06-12] — Automated backups + disk sizing fix (Issue #4)

Phase 0 / Issue #4 (Define and test backup & restore procedure). Approved by
Kevin 2026-06-12. Config-as-code + Render dashboard changes only — no application
code changed. See `DEPLOYMENT-LOG.md` for the full record and `ROLLBACK.md` §6
for the documented backup/restore procedure.

### Added

- **Automated database backups.** Created a Render **Cron Job**
  (`fitzpatrick-service-tracker-backup`) that runs **every 12 hours**
  (`0 6,18 * * *` UTC = midnight/noon MDT) and POSTs to the app's `/api/backup`
  endpoint with the `x-backup-secret` header. Declared in `render.yaml`.
  Previously the backup endpoint existed but **nothing was calling it on a
  schedule** — backups were effectively manual and could silently stop.
- **Documented backup & restore procedure** in `ROLLBACK.md` §6: backup
  mechanism/frequency/retention/owner, how to check health, trigger an
  on-demand backup, non-destructively verify a backup is restorable, and the
  DESTRUCTIVE live-restore steps. Notes that code rollback does NOT undo data.

### Fixed

- **Persistent disk too small for backups (launch blocker).** The backup test
  caught that the 1 GB `/var/data` disk was **97% full** and a full backup pair
  (2 × ~464 MB) failed with HTTP 500. Retention keeps up to 9 copies (~4.6 GB),
  which never fit on 1 GB. Grew the disk **1 GB → 10 GB** (`render.yaml` +
  Render dashboard; resize in place, data preserved). Render disks grow only.

### Verified

- **Backup works end-to-end.** Post-grow, `POST /api/backup` returned
  `{"success":true}` writing `backup-pm.db` + `backup-fri.db` (each ~464 MB).
- **Backup is restorable.** Non-destructive restore test on the newest backup:
  `integrity_check: ok`, 61 `service_calls` rows; scratch copy deleted, live DB
  untouched. Disk after grow: 14% used (8.5 GB free).

## [2026-06-12] — Production database persistence verified (Issue #3)

Phase 0 / Issue #3 (Verify production database persistence on Render). Deployed
to production 2026-06-12 (commit `0d1f89b`, approved by Kevin); Render auto-deploy
on commit. Config-as-code change only — no application code changed. See
`DEPLOYMENT-LOG.md` for the deploy record, rollback point (`0f67980`), and the
disk/DB integrity + restart-survival results.

### Changed

- **Reconciled `render.yaml` with the live Render service.** The committed
  blueprint previously declared `plan: free` with no persistent disk and no
  `DB_PATH`, which did not match production and would have rebuilt the service on
  an ephemeral filesystem with an empty database. It now declares `plan: starter`,
  a 1 GB persistent disk mounted at `/var/data`,
  `DB_PATH=/var/data/warranty_tracker.db`, and `BACKUP_SECRET` (`sync: false`),
  so production config is reproducible from the repo.

### Verified

- **Database persistence on durable storage.** Read-only verification of the live
  Render service confirmed the app writes to the persistent disk:
  `DB_PATH=/var/data/warranty_tracker.db`, DB file on the `/var/data` 1 GB disk
  (~48% used), 7 daily snapshots (Jun 5–11).
- **Survives redeploy and restart.** Across the PR #37 redeploy the DB file was
  byte-identical to baseline (size `479436800`, md5
  `72f8c2be507a850c8caff0cf0a5c3065`, not recreated). A subsequent approved manual
  instance restart left the disk attached, usage unchanged, and the app healthy.
  Checklist §3 items closed accordingly.

## [2026-06-11] — Installation Review Notes

Released to production on 2026-06-11 (approved by Kevin, "Merge and deploy", 11:09
MDT). Merged `feature/installation-review-notes` into `master`; Render
auto-deploy on commit triggered the production deploy. See `DEPLOYMENT-LOG.md`
for the deploy record and rollback point (`8a6f7ac`).

### Added

- **Installation Review Notes** — a new internal narrative field on service
  calls. Lets a technician document installation issues, code issues,
  workmanship observations, or other installation/site conditions noticed
  during a service call. Available for both residential and commercial calls.
  - Schema: additive nullable `installation_review_notes` text column on
    `service_calls` (Migration 32, `columnExists`-guarded; existing rows
    unaffected).
  - Entry: appears alongside Issue Description, Diagnosis, Resolution, and Tech
    Notes on the New Service Call form and is editable on the service-call
    detail (internal) view.
  - Reports: **excluded from printed/emailed reports by default.** The PDF and
    Email actions on the detail page now open a report-options dialog with an
    opt-in "Include Installation Review Notes" toggle; the field is only added
    to the report when the user checks it. Behavior is identical for
    residential and commercial calls.
- Operational safety and documentation layer:
  - `CHANGELOG.md` to track notable changes over time.
  - `DEPLOYMENT-LOG.md` with a per-deployment record template.
  - `ROLLBACK.md` with a step-by-step rollback procedure for GitHub and the
    deployment provider.
  - `.github/ISSUE_TEMPLATE/bug_report.md` and
    `.github/ISSUE_TEMPLATE/feature_request.md` to standardize issue reporting.
  - **Future Work Protocol** in `RECOVERY-INDEX.md` defining the required
    process for all future changes to this business-critical app.
  - `COMMERCIAL-READINESS-CHECKLIST.md` capturing the verified baseline, Render
    verification still pending authenticated confirmation, data durability and
    deployment risks, QA/security gaps, and commercial launch decision gates.

### Changed

- Expanded `RECOVERY-INDEX.md` with the Future Work Protocol while preserving
  existing recovery content.
- Recorded the first confirmed production deployment (2026-06-11, PR #1 merge
  `8a6f7ac`) in `DEPLOYMENT-LOG.md`, and added confirmed production wiring
  (production URL, current deploy, Auto-Deploy = On Commit, rollback anchor) to
  `RECOVERY-INDEX.md`. Confirmed a Render persistent disk is attached
  (`/var/data`, 1 GB, snapshots visible). Remaining risk: verify the SQLite
  database file is actually stored under `/var/data`.
