# Changelog

All notable changes to the Fitzpatrick Warranty Service Tracker are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Service Map & geolocation improvements (branch `feature/map-improvements`)

Review-and-improve pass on the Service Map. **Built on branch — awaiting Kevin's review/approval; not yet deployed.**

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
