# Commercial Readiness Checklist — Fitzpatrick Warranty Service Tracker

This checklist captures the steps required to bring the Warranty Service Tracker
to a commercially supportable, durable, and recoverable state. It is a working
document: check items off as they are verified, and record dates and owners.

This is a business-critical, daily-use application. Treat unverified items as
risks, not assumptions.

> **Status legend:** `[ ]` not started · `[~]` in progress · `[x]` verified
>
> **Authenticated confirmation still required:** Several items below depend on
> the Render dashboard, which could not be inspected during review (it requires
> an authenticated login session). **Kevin (or another account holder) must log
> in to Render and confirm these manually.** Items needing this are marked
> **(needs Kevin / authenticated Render access)**.

---

## 1. Current verified baseline

What is known-good and confirmed as of this review.

- [x] GitHub repository access confirmed.
- [x] Default branch: `master`.
- [x] Known-good rollback tag: `known-good-2026-06-05`
      → commit `44e91ce6b267c119290a5998455877e426a33008`.
- [x] Open issues / open PRs at review time: **0**.
- [x] Public app URL reachable: `https://warranty.fitzpatricksalescrm.com/`
      serves the Warranty Service Tracker sign-in page.
- [x] Render service name: `fitzpatrick-service-tracker`. Plan confirmed
      **Starter** via Render screenshot (2026-06-11); note `render.yaml` still
      declares `plan: free` — reconcile separately.
- [x] Build / type-check commands defined: `npm run check`, `npm run build`.
- [ ] Confirm the public URL above is served by the **same** Render service and
      commit recorded here. **(needs Kevin / authenticated Render access)**

---

## 2. Render verification required

The Render dashboard could not be inspected during review — the cloud browser
saw only the **Sign In to Render** page, and a local browser bridge was
unavailable. **All items in this section require an authenticated Render
session.**

- [x] Confirm the live service name matches `fitzpatrick-service-tracker`.
      Confirmed via Render screenshot (2026-06-11).
- [ ] Confirm the current deployed commit hash matches the intended baseline.
      **(needs Kevin / authenticated Render access)**
- [x] Confirm the production URL bound to the service and that
      `https://warranty.fitzpatricksalescrm.com/` resolves to it. Screenshot
      shows domain `warranty.fitzpatricksalescrm.com` bound to the service
      (2026-06-11). TLS certificate status not separately captured.
- [x] Confirm service plan and whether free-tier sleep / cold-start applies.
      Plan confirmed **Starter** via screenshot (2026-06-11); Starter is a paid
      plan, so free-tier sleep does not apply.
- [x] Confirm whether **auto-deploy on push to `master`** is enabled. Confirmed
      by Kevin (2026-06-11): Auto-Deploy = **On Commit**.
- [x] Capture environment variables configured in Render (names only — **no
      secret values** in this repo). Verified 2026-06-12: `NODE_ENV`, `DB_PATH`,
      `BACKUP_SECRET` (set; value not recorded). No `DATABASE_URL`/`DATA_DIR`.
- [x] Record the confirmed production URL in `DEPLOYMENT-LOG.md`
      (recorded 2026-06-11: `https://warranty.fitzpatricksalescrm.com/#/`).

---

## 3. Data persistence / durability

The app uses SQLite via `better-sqlite3`. On Render's free tier **without a
persistent disk, the local filesystem is ephemeral** — data written to a local
SQLite file can be lost on restart, redeploy, or instance recycle. This is the
single highest commercial risk.

- [x] Confirm where the SQLite database file is stored at runtime. Verified live
      2026-06-12 (Render shell): `DB_PATH=/var/data/warranty_tracker.db` and
      `ls -la /var/data` shows `warranty_tracker.db` (~457 MB, modified same day)
      on the persistent disk — **not** the ephemeral filesystem.
- [x] Confirm whether a Render **persistent disk** is attached and mounted at
      the database path. Verified live 2026-06-12: disk mounted at `/var/data`,
      1 GB provisioned (~48% used, `/dev/nvme1n1`), with 7 daily snapshots
      (Jun 5–11, 2026).
- [x] If no persistent disk: treat all production data as at risk of loss.
      N/A — persistent disk is attached and SQLite is confirmed writing to it.
- [x] Decide on the durable storage path:
      Current decision: persistent disk + SQLite at `/var/data/warranty_tracker.db`
      (now declared in `render.yaml`). A future migration to managed Postgres
      remains an option (`drizzle.config.ts` already present) but is not required
      for launch.
- [~] Define and test an automated **backup** procedure for the database.
      In place: `/api/backup` writes AM/PM + day-of-week snapshots to `/var/data`,
      and Render takes 7 daily disk snapshots. Still to do: confirm the backup
      cron is scheduled and exercise it end-to-end (tracked by Issue #4).
- [ ] Document and test a **restore-from-backup** procedure (Issue #4).
- [x] Verify data survives a redeploy and a manual instance restart. Confirmed
      2026-06-12: after the PR #37 production **redeploy**, the DB file was
      byte-identical to baseline (size `479436800`, md5
      `72f8c2be507a850c8caff0cf0a5c3065`, not recreated). A subsequent approved
      **manual instance restart** (09:14 MDT) left the disk attached, usage
      unchanged (48%), `DB_PATH` unchanged, and the app healthy. Data survives
      both redeploy and restart. See `DEPLOYMENT-LOG.md` (2026-06-12 entries).

---

## 4. Deployment controls

- [x] Confirm the deploy trigger (auto-deploy on `master` vs. manual). Confirmed
      (2026-06-11): Auto-Deploy = **On Commit** — merges to `master` deploy
      automatically.
- [ ] Document the intended release flow (e.g. work on a branch → PR → review →
      merge to `master` → deploy) in line with the Future Work Protocol in
      `RECOVERY-INDEX.md`.
- [ ] Ensure every production deploy is recorded in `DEPLOYMENT-LOG.md`.
- [ ] Confirm the rollback procedure in `ROLLBACK.md` is current and that the
      recorded rollback point matches the verified baseline.
- [ ] Verify a rollback can be executed end-to-end (dry-run / rehearsal).
- [ ] Establish a tagging convention for known-good releases (a
      `known-good-YYYY-MM-DD` tag already exists as a precedent).

---

## 5. QA / testing

- [ ] **No automated test suite exists** — add at least smoke tests for the
      critical flows (sign-in, create/edit a warranty/service record, list view).
- [ ] **No lint script is defined** in `package.json` — add a linter and a
      `lint` script.
- [ ] Wire `npm run check` (tsc) and `npm run build` into a CI workflow so they
      run on every PR.
- [ ] Define a manual smoke-test checklist to run after each production deploy.
- [ ] Add CI status gating before merge to `master`.

---

## 6. Security / privacy / customer data

- [ ] Confirm authentication on the sign-in flow is enforced server-side (not
      only client-side).
- [ ] Confirm no secrets are committed to the repo; secrets live only in the
      provider's environment configuration. **(needs Kevin / authenticated Render access)** for the Render side.
- [ ] Confirm transport security (HTTPS / valid TLS certificate) on the custom
      domain.
- [ ] Document what customer data is stored and where, and confirm it is covered
      by the backup/restore plan in section 3.
- [ ] Define a data-retention and deletion policy appropriate for customer data.
- [ ] Review access control: who can view/modify records, and how accounts are
      provisioned and de-provisioned.
- [ ] Establish an incident/breach response note (who to contact, how to revoke
      access). **Do not store customer data or credentials in this repo.**

---

## 7. Documentation updates

- [x] `CHANGELOG.md` exists and tracks notable changes.
- [x] `DEPLOYMENT-LOG.md` exists with a per-deploy template.
- [x] `ROLLBACK.md` exists with a rollback procedure.
- [x] `RECOVERY-INDEX.md` exists with the Future Work Protocol.
- [x] Record the confirmed production URL in `DEPLOYMENT-LOG.md` once verified.
      Recorded 2026-06-11: `https://warranty.fitzpatricksalescrm.com/#/`.
- [ ] Add a short operator runbook (how to deploy, roll back, back up, restore).
- [ ] Keep this checklist updated as items are verified, with date and owner.

---

## 8. Commercial launch decision gates

All gates must be **green** before onboarding paying customers.

- [ ] **Data durability gate:** persistent storage confirmed and backup/restore
      tested (section 3). _Blocker._
- [ ] **Deploy & rollback gate:** deploy trigger known, rollback rehearsed, log
      in place (section 4).
- [ ] **Render confirmation gate:** service, commit, URL, env, and plan
      confirmed by Kevin via authenticated access (section 2).
- [ ] **Quality gate:** smoke tests + CI checks running on PRs (section 5).
- [ ] **Security/privacy gate:** auth enforced, TLS valid, data policy defined,
      no secrets in repo (section 6).
- [ ] **Go / no-go decision** recorded with date, decision owner, and rationale.

---

## 9. Handoff checklist

For handing operational ownership to Kevin (or the responsible operator).

- [ ] Render account access confirmed and owner identified.
      **(needs Kevin / authenticated Render access)**
- [ ] Custom domain / DNS ownership and renewal responsibility documented.
- [ ] GitHub repository access and required permissions confirmed for the owner.
- [ ] Operator runbook (deploy / rollback / backup / restore) reviewed with the
      owner.
- [ ] Backup location and restore steps shared with the owner.
- [ ] Escalation/contact path documented for outages and data issues.
- [ ] This checklist reviewed and remaining open items assigned with due dates.

---

## Open risks summary

1. **Data durability (highest):** A Render persistent disk is now confirmed
   attached at `/var/data` (1 GB, snapshots visible, 2026-06-11). **Residual
   risk:** it is not yet verified that the SQLite database file is actually
   stored under `/var/data` — a disk being attached does not guarantee SQLite is
   using it. Until that is confirmed, data could still be on the ephemeral
   filesystem and at risk on restart/redeploy.
2. **Production wiring (mostly confirmed):** service `fitzpatrick-service-tracker`,
   domain `warranty.fitzpatricksalescrm.com`, and Starter plan confirmed via
   screenshot (2026-06-11). **Still unconfirmed:** that the deployed commit hash
   matches the intended baseline, and the env-var inventory.
3. **No automated tests or lint:** regressions can ship undetected.
4. **Plan is Starter (paid), not free:** free-tier sleep/cold-start does not
   apply; note `render.yaml` still declares `plan: free` and should be reconciled.
5. **Auto-deploy on `master` (On Commit):** confirmed enabled — any push/merge to
   `master` deploys automatically, so merges must be treated as deploys.

_Last reviewed: 2026-06-11. Persistent disk, service name, domain, plan, and
auto-deploy trigger confirmed via Render screenshot. Remaining
**(needs Kevin / authenticated Render access)** items (deployed-commit match,
env-var inventory) are still blocked pending an authenticated Render session._
