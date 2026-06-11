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
- [x] Render service name (from `render.yaml` / docs):
      `fitzpatrick-service-tracker` (plan: `free`).
- [x] Build / type-check commands defined: `npm run check`, `npm run build`.
- [ ] Confirm the public URL above is served by the **same** Render service and
      commit recorded here. **(needs Kevin / authenticated Render access)**

---

## 2. Render verification required

The Render dashboard could not be inspected during review — the cloud browser
saw only the **Sign In to Render** page, and a local browser bridge was
unavailable. **All items in this section require an authenticated Render
session.**

- [ ] Confirm the live service name matches `fitzpatrick-service-tracker`.
      **(needs Kevin / authenticated Render access)**
- [ ] Confirm the current deployed commit hash matches the intended baseline.
      **(needs Kevin / authenticated Render access)**
- [ ] Confirm the production URL bound to the service and that
      `https://warranty.fitzpatricksalescrm.com/` resolves to it (custom domain
      mapping + TLS certificate status). **(needs Kevin / authenticated Render access)**
- [ ] Confirm service plan and whether free-tier sleep / cold-start applies.
      **(needs Kevin / authenticated Render access)**
- [ ] Confirm whether **auto-deploy on push to `master`** is enabled.
      **(needs Kevin / authenticated Render access)**
- [ ] Capture environment variables configured in Render (names only — **no
      secret values** in this repo). **(needs Kevin / authenticated Render access)**
- [ ] Record the confirmed production URL in `DEPLOYMENT-LOG.md`
      (currently listed as `unknown`).

---

## 3. Data persistence / durability

The app uses SQLite via `better-sqlite3`. On Render's free tier **without a
persistent disk, the local filesystem is ephemeral** — data written to a local
SQLite file can be lost on restart, redeploy, or instance recycle. This is the
single highest commercial risk.

- [ ] Confirm where the SQLite database file is stored at runtime.
      **(needs Kevin / authenticated Render access)**
- [ ] Confirm whether a Render **persistent disk** is attached and mounted at
      the database path. **(needs Kevin / authenticated Render access)**
- [ ] If no persistent disk: treat all production data as **at risk of loss**
      until remediated. Do not onboard paying customers before this is resolved.
- [ ] Decide on the durable storage path:
      - attach a persistent disk and point SQLite at it, **or**
      - migrate to a managed database (e.g. hosted Postgres) — note the project
        already uses `drizzle.config.ts`, easing a future migration.
- [ ] Define and test an automated **backup** procedure for the database.
- [ ] Document and test a **restore-from-backup** procedure.
- [ ] Verify data survives a redeploy and a manual instance restart.

---

## 4. Deployment controls

- [ ] Confirm the deploy trigger (auto-deploy on `master` vs. manual).
      **(needs Kevin / authenticated Render access)**
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
- [ ] Record the confirmed production URL in `DEPLOYMENT-LOG.md` once verified.
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

1. **Data durability (highest):** SQLite on Render free tier without a confirmed
   persistent disk risks data loss on restart/redeploy. Unverified.
2. **Unconfirmed production wiring:** Render service ↔ public URL ↔ deployed
   commit not yet confirmed via authenticated access.
3. **No automated tests or lint:** regressions can ship undetected.
4. **Free-tier limits:** possible sleep/cold-start and resource constraints for
   a daily-use commercial app.
5. **Possible auto-deploy on `master`:** a push could deploy unintentionally;
   trigger must be confirmed.

_Last reviewed: 2026-06-11. Items marked **(needs Kevin / authenticated Render
access)** are blocked pending an authenticated Render session._
