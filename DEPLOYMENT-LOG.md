# Deployment Log — Fitzpatrick Warranty Service Tracker

This file records every deployment to a hosted environment. This is a
business-critical, daily-use application, so each meaningful deploy should be
logged here for traceability and fast recovery.

Add a new entry at the **top** of the log for each deployment, using the
template below. Keep entries concise and factual.

## Deployment Template

Copy this block for each new deployment:

```
### YYYY-MM-DD — <short summary>

- **Date:**            YYYY-MM-DD HH:MM (timezone)
- **Commit:**          <full or short commit hash>
- **Environment:**     production | staging | preview
- **Production URL:**  <URL if known, otherwise "unknown">
- **Deploy action:**   <e.g. auto-deploy on push to master / manual redeploy / rollback>
- **Checks run:**      <e.g. npm run check (tsc), npm run build, manual smoke test>
- **Rollback point:**  <last known-good commit hash or tag to revert to>
- **Notes:**           <migrations, env var changes, risks, follow-ups>
```

## Environment Reference

| Field             | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Provider          | Render (see `render.yaml`)                                     |
| Service name      | `fitzpatrick-service-tracker`                                  |
| Runtime           | Node                                                           |
| Build command     | `npm install && npm run build`                                 |
| Start command     | `NODE_ENV=production node dist/index.cjs`                      |
| Default branch    | `master`                                                       |
| Production URL    | https://warranty.fitzpatricksalescrm.com/#/ (confirmed 2026-06-11) |
| Auto-Deploy       | On Commit (confirmed by Kevin 2026-06-11)                      |
| Plan              | Starter (confirmed by Kevin 2026-06-11; `render.yaml` still says `free`) |
| Persistent disk   | Confirmed: `/var/data`, 1 GB, snapshots visible (2026-06-11)   |
| Internal address  | `fitzpatrick-service-tracker:10000`                            |

## Deployment History

<!-- Newest entries first. -->

### 2026-06-11 — Installation Review Notes feature (NO PRODUCTION DEPLOY)

- **Date:**            2026-06-11 (MDT)
- **Commit:**          on feature branch `feature/installation-review-notes` (not merged)
- **Environment:**     none — **no production deploy was performed**
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/ (unchanged; not redeployed)
- **Deploy action:**   **None.** Feature implemented on a branch only. Not merged to
                       `master`, so the Render auto-deploy-on-commit was NOT triggered.
- **Checks run:**      `npm run check` (tsc) — PASS; `npm run build` — PASS.
- **Rollback point:**  N/A (no deploy). Pre-existing known-good remains
                       `44e91ce` / current production `8a6f7ac`.
- **Notes:**           Adds an additive nullable `installation_review_notes` column
                       (Migration 32, idempotent `columnExists` guard). On the next
                       deploy the migration runs at startup; existing rows are
                       unaffected. Installation Review Notes are excluded from
                       printed/emailed reports by default with an opt-in toggle.
                       **Awaiting Kevin review before any merge/deploy.** No secrets
                       or customer data recorded here.

### 2026-06-11 — First confirmed production deployment (PR #1 / commercial-readiness)

- **Date:**            2026-06-11 08:50 (MDT)
- **Commit:**          8a6f7ac7782e0c00270b1f4b0b490b80094f90f5 (merge of PR #1)
- **Environment:**     production
- **Production URL:**  https://warranty.fitzpatricksalescrm.com/#/ (confirmed reachable)
- **Deploy action:**   Manual Render deployment, confirmed by Kevin via authenticated
                       Render dashboard. **Result: succeeded.**
- **Auto-Deploy:**     On Commit (enabled) — pushes/merges to `master` will trigger
                       a Render deploy automatically.
- **Plan:**            Starter (note: `render.yaml` still declares `plan: free`; the
                       live service is on Starter per Kevin — reconcile separately).
- **Checks run:**      Docs-only record. No build/check run for this log entry.
                       Application code was deployed as merged in PR #1.
- **Rollback point:**  known-good-2026-06-05 → 44e91ce6b267c119290a5998455877e426a33008
- **Source PR:**       https://github.com/FitzWarranty26/fitzpatrick-service-tracker/pull/1
- **Persistent disk:** Confirmed via Render screenshot (2026-06-11): a persistent
                       disk is attached to web service `fitzpatrick-service-tracker`,
                       mount path `/var/data`, size 1 GB (usage 1 GB), with a
                       snapshot visible dated 2026-06-10 18:16. Service shown as
                       Node Starter, repo FitzWarranty26/fitzpatrick-service-tracker
                       on `master`, domain warranty.fitzpatricksalescrm.com, internal
                       address `fitzpatrick-service-tracker:10000`.
- **Notes:**           **Remaining risk:** a disk being attached does not guarantee
                       SQLite is using it — verify the application database file is
                       actually stored under `/var/data` (not on the ephemeral
                       filesystem). See `COMMERCIAL-READINESS-CHECKLIST.md` §3. No
                       secrets or customer data recorded here.

### YYYY-MM-DD — (template — replace with first logged deployment)

- **Date:**            YYYY-MM-DD HH:MM (timezone)
- **Commit:**          <commit hash>
- **Environment:**     production
- **Production URL:**  unknown
- **Deploy action:**   auto-deploy on push to master
- **Checks run:**      npm run check, npm run build
- **Rollback point:**  <last known-good commit hash>
- **Notes:**           Initial logged deployment.
