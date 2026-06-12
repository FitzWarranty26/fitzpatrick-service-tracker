# Changelog

All notable changes to the Fitzpatrick Warranty Service Tracker are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Reconciled `render.yaml` with the live Render service (Issue #3, Phase 0).**
  The committed blueprint previously declared `plan: free` with no persistent
  disk and no `DB_PATH`, which did not match production and would have rebuilt
  the service on an ephemeral filesystem with an empty database. It now declares
  `plan: starter`, a 1 GB persistent disk mounted at `/var/data`,
  `DB_PATH=/var/data/warranty_tracker.db`, and `BACKUP_SECRET` (`sync: false`),
  so production config is reproducible from the repo. No application code or
  runtime behavior changed; no deploy performed by this change.

### Verified

- **Production database persistence (Issue #3).** Read-only verification of the
  live Render service (2026-06-12) confirmed the app writes to a persistent disk:
  `DB_PATH=/var/data/warranty_tracker.db`, the DB file lives on the `/var/data`
  1 GB disk (~48% used), and 7 daily snapshots exist (Jun 5–11). Findings
  recorded in `DEPLOYMENT-LOG.md` and `RECOVERY-INDEX.md`; checklist §3 updated.

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
