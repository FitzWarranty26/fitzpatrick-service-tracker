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
| Current deploy  | `e28492b` — Issue #5 CI gate (PR #42) on production 2026-06-12. Prior `32d7f0b` (Issue #4 disk grow + backup cron), `0d1f89b` (Issue #3 render.yaml reconcile). |
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

| Date       | Branch                                   | Summary                                                                                                                                                                                                                                                                                 | State                                                                 |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 2026-06-15 | `feature/multi-product-service-calls`    | **Multi-product service calls** (Migration 33). New `service_call_products` table lets one call hold multiple units, each with its own manufacturer/model/serial/type/install date, warranty, diagnosis/resolution, and claim+cost fields. Backfills Product 1 from legacy columns; legacy columns retained and synced to Product 1. New-call form gains "Add another product"; detail page gains a Products section with Add/Edit/Remove per visit. Branched from `master` `ae88d02`. | **Built on branch — NOT deployed. Awaiting Kevin's review/approval.** `npm run check` + `npm run build` pass; Migration 33 + CRUD + UI smoke-tested. See `CHANGELOG.md` `[Unreleased]`. |

## Recently Deployed

| Date       | Branch                              | Summary                                                                                                                            | State                                                  |
| ---------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-06-11 | `feature/installation-review-notes` | Adds internal "Installation Review Notes" field (Migration 32). Excluded from printed/emailed reports by default with opt-in toggle. Residential + commercial. | **Approved by Kevin & merged to `master` 2026-06-11** — Render auto-deploy triggered on commit |

> Deploy approved by Kevin ("Merge and deploy", 2026-06-11 11:09 MDT) and merged
> to `master` (fast-forward). Render Auto-Deploy = On Commit, so the push to
> `master` triggers an automatic production deploy. The additive nullable
> `installation_review_notes` column migration (Migration 32) runs at startup on
> deploy and does not affect existing rows. See `CHANGELOG.md` and
> `DEPLOYMENT-LOG.md` for the full deploy record and rollback point.

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
