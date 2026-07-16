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
| Current deploy  | `69dae783` — harden legacy sync: non-destructive fill-only merge (PR #65, fix commit `0eb67775`) on production 2026-07-16; server-only hardening to `syncLegacyFromProduct` (`server/storage.ts`), no schema/migration — the sync now never overwrites a populated field with an empty/undefined/whitespace value (all 16 synced fields), plus 4 regression tests (`server/storage.test.ts`) and a `test` npm script. Permanent/class-kill fix following the same-day hotfix PR #61; full re-architecture tracked in issue #64. Checks: test 4/4, check, build all PASS; post-deploy app confirmed up (sign-in serving). Prior `87463c0` — fix: service call description wiped on create (PR #61, fix commit `3e292c2b`) on production 2026-07-16; server-only fix to `POST /api/service-calls`, no schema/migration — the multi-product `products[]` create path was blanking `issue_description`/diagnosis/resolution/claim via `syncLegacyFromProduct`. Data cleanup pending: real calls #41, #85, #86 have blank descriptions (unrecoverable, manual re-entry). Prior `5fbdf88` — assign-technician feature (PR #59, feature commit `36bffcb`) on production 2026-06-24; Migration 37 = additive nullable `assigned_technician_id` column (no backfill); adds Assign Technician dropdown on New Service Call, editable on detail, prominent Technician KPI cell, and list Tech column now COALESCEs assigned tech → visit tech. Prior `4ec990d` — service call creator attribution (PR #57, feature commit `24416b6`) on production 2026-06-24; Migration 36 = idempotent data-only backfill of `created_by` (no schema change). Prior `7970b4f` — visit-count + total-hours header fix (PR #55, fix commit `eba52ae`) on production 2026-06-24; client-only, no schema/migration. Prior `97b7b2b` (admin password reset + recovery script, PR #52, 2026-06-18), `26ba94a` (Service Map zoom/geocode fix, PR #50, Migration 35), `e28492b` (Issue #5 CI gate, PR #42, rollback anchor `known-good-2026-06-12`). |
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
