# Changelog

All notable changes to the Fitzpatrick Warranty Service Tracker are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

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
